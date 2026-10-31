-- =====================================================================================
-- SGI Di Égida · Producción: lotes históricos, merma por insumo y lotes sin costo completo
-- · lotes_historicos + lote_historico_consumos: BD_PRODUCCION y BD_CONSUMOS del libro
--   SGI-COSTOS (supabase/datos/lotes_historicos_bar.sql). Solo referencia: no son movimientos;
--   el kardex nace con el conteo inicial. El último lote con costo completo de cada MPI da su
--   costo de referencia para valorizar ese conteo.
-- · Merma por insumo en el lote (lo que se bota al pelar, colar, limpiar): informativa, no
--   cambia lo que sale del kardex (la cantidad usada ya incluye la merma).
-- · public.lotes_sin_costo: los lotes de la app y los históricos que no tienen costo completo,
--   con el motivo de cada insumo que falta.
-- =====================================================================================

insert into public.parametros (clave, valor, descripcion)
select v.clave, v.valor, v.descripcion from (values
  ('DESVIO_REND_AVISO_PCT', '15', 'Avisa si el rendimiento del lote se aparta de la ficha más de este %.')
) as v (clave, valor, descripcion)
where not exists (select 1 from public.parametros p where p.clave = v.clave);

-- ---------------------------------------------------------------- lotes históricos
create table public.lotes_historicos (
  id                 uuid primary key,                  -- determinístico: regenerar no duplica
  codigo             text not null unique,              -- PRO-2026-001 del .gs
  fecha              date not null,
  sesion             text,
  generico_id        uuid not null references public.genericos (id),   -- el MPI producido
  nombre_original    text,
  tecnica            text,
  tiempo_min         numeric,
  entrada_g          numeric,                           -- el .gs pesaba todo en gramos
  neto_g             numeric,
  unidades           numeric,
  empaque            text,
  vida_util_dias     numeric,
  conservacion       text,
  rendimiento        numeric,
  rendimiento_ficha  numeric,
  costo_total        numeric,
  costo_g            numeric,
  estado_costo       text not null check (estado_costo in ('COMPLETO', 'PARCIAL', 'SIN COSTO', 'SIN NETO', 'SIN INGREDIENTES')),
  estado_lote        text not null check (estado_lote in ('ACTIVA', 'REVISAR', 'ANULADA')),
  hallazgos          text[] not null default '{}',
  lineas_sin_precio  integer not null default 0,
  observaciones      text
);

create table public.lote_historico_consumos (
  id               uuid primary key,
  lote_id          uuid not null references public.lotes_historicos (id),
  linea            integer not null,
  generico_id      uuid not null references public.genericos (id),
  tipo             text,
  nombre_original  text,
  cantidad         numeric,
  unidad           text not null,
  merma            numeric,
  lote_origen      text,
  costo_unitario   numeric,
  costo            numeric,
  fuente_costo     text,
  hallazgos        text[] not null default '{}'
);
create index lote_historico_consumos_lote_idx on public.lote_historico_consumos (lote_id);

comment on table public.lotes_historicos is
  'BD_PRODUCCION del libro SGI-COSTOS (antes de la app). Referencia de costo y rendimiento: no son movimientos.';

do $$
declare t text;
begin
  foreach t in array array['lotes_historicos', 'lote_historico_consumos'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function privado.bloquear_cambios()', t || '_inmutable', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (privado.ve_costos() and privado.ve_area(''BAR''))', t || '_leer', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------- merma por insumo
alter table public.lote_consumos
  add column merma      numeric check (merma >= 0),        -- en la unidad en que se escribió la cantidad
  add column merma_base numeric check (merma_base >= 0);   -- en unidad base del insumo

comment on column public.lote_consumos.merma is
  'Lo que se botó de esta cantidad (cáscara, semillas, colado). Informativa: la salida del kardex es la cantidad completa.';

-- =====================================================================================
-- RPC · LOTE DE PRODUCCIÓN v2: igual que v1 y además guarda la merma de cada insumo.
-- consumos: [{producto_id, cantidad, unidad?, merma?, nota}]
-- =====================================================================================
create or replace function public.registrar_lote(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_area     public.area_app;
  v_fecha    date := privado.fecha_o_null(p ->> 'fecha');
  v_ubic     text := p ->> 'ubicacion';
  v_resp     uuid := privado.uuid_o_null(p ->> 'responsable_id');
  v_mpi      uuid := privado.uuid_o_null(p ->> 'producto_id');
  v_ficha    uuid := privado.uuid_o_null(p ->> 'ficha_id');
  v_neto     numeric := privado.num_o_null(p ->> 'neto');
  v_motivo   text := nullif(trim(p ->> 'motivo_forzado'), '');
  f text[] := '{}'; b text[] := '{}'; a text[] := '{}';
  v_rechazo  jsonb;
  v_id       uuid := gen_random_uuid();
  v_codigo   text;
  v_mpi_rec  record;
  v_c        jsonb;
  v_n        integer;
  v_ref      text;
  v_prod     record;
  v_cant     numeric; v_unidad text; v_base numeric; v_merma numeric; v_merma_total numeric := 0;
  v_entrada  numeric := 0;
  v_saldo    numeric;
  v_lineas   jsonb := '[]';
  v_l        jsonb;
  v_mov      public.movimientos;
  v_total    numeric := 0;
  v_sin_costo integer := 0;
  v_rend     numeric; v_rend_ficha numeric; v_neto_ficha numeric; v_suma_ficha numeric;
  v_cu       numeric;
  v_estado   text;
begin
  begin v_area := (p ->> 'area')::public.area_app;
  exception when others then raise exception 'Área no válida: %', p ->> 'area'; end;
  if not privado.puede_operar(v_area) then
    raise exception 'Sin permiso para registrar producción en %.', v_area using errcode = '42501';
  end if;

  select * into f, a from privado.validar_fecha(v_fecha, p ->> 'fecha', f, a);
  if v_resp is null or not exists (select 1 from public.perfiles pe where pe.id = v_resp and pe.activo) then
    f := f || 'F2 · Falta el responsable.'::text;
  end if;
  if not exists (select 1 from public.ubicaciones u where u.codigo = v_ubic and u.area = v_area and u.activo) then
    f := f || ('F1 · La ubicación «' || coalesce(v_ubic, '') || '» no existe en ' || v_area || '.');
  end if;
  select pr.id, g.id as generico_id, g.nombre, g.tipo, g.unidad_base, pr.activo and g.activo as activo
    into v_mpi_rec
    from public.productos pr join public.genericos g on g.id = pr.generico_id where pr.id = v_mpi;
  if v_mpi_rec.id is null or v_mpi_rec.tipo <> 'MPI' or not v_mpi_rec.activo then
    f := f || 'F3 · El producto a producir no es un MPI activo del catálogo.'::text;
  end if;
  if v_ficha is not null and not exists (select 1 from public.fichas fi where fi.id = v_ficha and fi.generico_id = v_mpi_rec.generico_id) then
    f := f || 'F3 · La ficha no corresponde al MPI elegido.'::text;
  end if;
  if jsonb_typeof(p -> 'consumos') <> 'array' or jsonb_array_length(p -> 'consumos') = 0 then
    f := f || 'F4 · No hay ningún ingrediente con cantidad.'::text;
  end if;
  if v_neto is null or v_neto <= 0 then f := f || 'F7 · Falta el PESO NETO FINAL.'::text; end if;

  for v_c, v_n in select e.value, e.ordinality from jsonb_array_elements(coalesce(p -> 'consumos', '[]')) with ordinality e
  loop
    select pr.id, pr.activo and g.activo as activo, g.id as generico_id, g.nombre, g.tipo, g.unidad_base
      into v_prod
      from public.productos pr join public.genericos g on g.id = pr.generico_id
     where pr.id = privado.uuid_o_null(v_c ->> 'producto_id');
    v_ref := 'Línea ' || v_n || ' (' || coalesce(v_prod.nombre, 'insumo desconocido') || ')';
    if v_prod.id is null or not v_prod.activo then
      f := f || ('F5 · ' || v_ref || ': no está en el catálogo o está dado de baja.'); continue;
    end if;
    if v_prod.tipo in ('BEBIDA', 'PLATO') then
      f := f || ('F5 · ' || v_ref || ': una bebida o plato no es ingrediente de producción.'); continue;
    end if;
    if v_prod.id = v_mpi then f := f || ('F5 · ' || v_ref || ': un lote no se consume a sí mismo.'); continue; end if;
    v_cant := privado.num_o_null(v_c ->> 'cantidad');
    v_unidad := coalesce(nullif(lower(v_c ->> 'unidad'), ''), v_prod.unidad_base::text);
    if v_cant is null or v_cant <= 0 then f := f || ('F6 · ' || v_ref || ': cantidad no válida.'); continue; end if;
    v_base := privado.a_base(v_prod.generico_id, v_cant, v_unidad);
    if v_base is null then
      f := f || ('F8 · ' || v_ref || ': falta la conversión ' || v_unidad || '→' || v_prod.unidad_base
                 || '. Mídela y regístrala en conversiones.');
      continue;
    end if;
    v_merma := privado.num_o_null(v_c ->> 'merma');
    if v_merma is not null and (v_merma < 0 or v_merma > v_cant) then
      f := f || ('F6 · ' || v_ref || ': la merma no puede ser negativa ni mayor que la cantidad usada.'); continue;
    end if;
    if v_merma > 0 then v_merma_total := v_merma_total + v_base * v_merma / v_cant; end if;
    if v_base > privado.parametro_num('MAX_CANTIDAD_LINEA', 50000) then
      b := b || ('B1 · ' || v_ref || ': ' || v_base || ' ' || v_prod.unidad_base || ' — ¿sobra un dígito?');
    end if;
    if v_prod.tipo <> 'SIN_COSTO' then
      select coalesce(sum(e.cantidad), 0) into v_saldo from public.existencias e
       where e.producto_id = v_prod.id and e.ubicacion = v_ubic;
      -- el mismo insumo puede venir en varias líneas
      v_saldo := v_saldo - coalesce((select sum((l ->> 'base')::numeric) from jsonb_array_elements(v_lineas) l
                                      where (l ->> 'producto_id')::uuid = v_prod.id), 0);
      if v_saldo < v_base then
        b := b || ('B3 · ' || v_ref || ': el kardex tiene ' || round(v_saldo, 2) || ' ' || v_prod.unidad_base
                   || ' en ' || v_ubic || ' y se usan ' || round(v_base, 2) || '. ¿Falta registrar una recepción o un traslado?');
      end if;
    end if;
    v_entrada := v_entrada + v_base;
    v_lineas := v_lineas || jsonb_build_object('n', v_n, 'producto_id', v_prod.id, 'tipo', v_prod.tipo,
                                               'cantidad', v_cant, 'unidad', v_unidad, 'base', v_base,
                                               'nota', v_c ->> 'nota', 'merma', v_merma,
                                               'merma_base', case when v_merma is not null then round(v_base * v_merma / v_cant, 4) end);
  end loop;

  if v_neto > 0 and v_entrada > 0 and v_neto > v_entrada * 1.10 then
    b := b || ('B2 · El neto (' || v_neto || ') supera la entrada (' || round(v_entrada) || ') en más de 10 %.');
  end if;

  v_rechazo := privado.rechazo('lotes_produccion', f, b, a, v_motivo);
  if v_rechazo is not null then return v_rechazo; end if;

  -- salidas a producción al promedio vigente
  for v_l in select value from jsonb_array_elements(v_lineas)
  loop
    if v_l ->> 'tipo' = 'SIN_COSTO' then continue; end if;
    v_mov := privado.registrar_movimiento('SALIDA_A_PRODUCCION', (v_l ->> 'producto_id')::uuid, v_ubic,
                                          (v_l ->> 'base')::numeric, v_fecha, null, 'LOTE', v_id);
    if v_mov.costo_total is null then v_sin_costo := v_sin_costo + 1;
    else v_total := v_total - v_mov.costo_total; end if;
    v_lineas := (select jsonb_agg(case when (x ->> 'n')::int = (v_l ->> 'n')::int
                                       then x || jsonb_build_object('mov', v_mov.id, 'cu', v_mov.costo_unitario,
                                                                    'costo', -v_mov.costo_total)
                                       else x end order by (x ->> 'n')::int)
                   from jsonb_array_elements(v_lineas) x);
  end loop;

  v_estado := case when v_sin_costo > 0 then 'PARCIAL' else 'COMPLETO' end;
  v_cu := case when v_estado = 'COMPLETO' then round(v_total / v_neto, 6) end;
  if v_sin_costo > 0 then
    a := a || (v_sin_costo || ' insumo(s) sin costo en el kardex: el lote queda PARCIAL y entra al promedio vigente del MPI.');
  end if;

  -- rendimiento contra la ficha (solo avisa)
  v_rend := case when v_entrada > 0 then v_neto / v_entrada end;
  if v_ficha is not null then
    select fi.neto_esperado into v_neto_ficha from public.fichas fi where fi.id = v_ficha;
    select case when count(*) = count(c.cantidad_base) then sum(c.cantidad_base) end into v_suma_ficha
      from public.costo_ficha(v_ficha) c;
    v_rend_ficha := case when v_neto_ficha > 0 and v_suma_ficha > 0 then v_neto_ficha / v_suma_ficha end;
    if v_rend_ficha > 0 and abs(v_rend - v_rend_ficha) / v_rend_ficha * 100 > privado.parametro_num('DESVIO_REND_AVISO_PCT', 15) then
      a := a || ('Rendimiento ' || round(v_rend * 100, 1) || ' % vs ficha ' || round(v_rend_ficha * 100, 1) || ' %.');
    end if;
  end if;

  v_codigo := privado.siguiente_codigo('PRO-' || v_area || '-' || to_char(v_fecha, 'YYYY'));
  insert into public.lotes_produccion (id, codigo, area, ubicacion, fecha, producto_id, ficha_id, responsable_id,
                                       tiempo_min, unidades, entrada_base, neto_base, rendimiento, rendimiento_ficha,
                                       costo_total, costo_unitario, estado_costo, observaciones, forzado,
                                       motivo_forzado, avisos)
  values (v_id, v_codigo, v_area, v_ubic, v_fecha, v_mpi, v_ficha, v_resp,
          privado.num_o_null(p ->> 'tiempo_min'), privado.num_o_null(p ->> 'unidades'),
          v_entrada, v_neto, v_rend, v_rend_ficha, v_total, v_cu, v_estado,
          nullif(trim(p ->> 'observaciones'), ''), cardinality(b) > 0,
          case when cardinality(b) > 0 then v_motivo end, a);

  insert into public.lote_consumos (lote_id, linea, producto_id, cantidad, unidad, cantidad_base,
                                    costo_unitario, costo, movimiento_id, nota, merma, merma_base)
  select v_id, (x ->> 'n')::int, (x ->> 'producto_id')::uuid, (x ->> 'cantidad')::numeric, x ->> 'unidad',
         (x ->> 'base')::numeric,
         case when x ->> 'tipo' = 'SIN_COSTO' then 0 else (x ->> 'cu')::numeric end,
         case when x ->> 'tipo' = 'SIN_COSTO' then 0 else (x ->> 'costo')::numeric end,
         (x ->> 'mov')::bigint, nullif(x ->> 'nota', ''), (x ->> 'merma')::numeric, (x ->> 'merma_base')::numeric
    from jsonb_array_elements(v_lineas) x;

  perform privado.registrar_movimiento('ENTRADA_PRODUCCION', v_mpi, v_ubic, v_neto, v_fecha, v_cu, 'LOTE', v_id);

  perform privado.bitacora('LOTE GUARDADO', 'lotes_produccion', v_codigo,
                           jsonb_build_object('neto', v_neto, 'costo_total', v_total, 'costo_unitario', v_cu,
                                              'estado_costo', v_estado, 'bloqueos', to_jsonb(b)),
                           case when cardinality(b) > 0 then v_motivo end);
  return privado.resultado(true, v_id, v_codigo, f, b, a) || jsonb_build_object(
    'costo_total', v_total, 'costo_unitario', v_cu, 'estado_costo', v_estado, 'rendimiento', v_rend,
    'merma_base', round(v_merma_total, 2));
end
$$;

-- =====================================================================================
-- Lotes sin costo completo (app e históricos) y por qué.
-- =====================================================================================
create or replace function public.lotes_sin_costo(p_area public.area_app)
returns table (origen text, id uuid, codigo text, fecha date, mpi text, unidad text, neto numeric,
               costo_total numeric, estado_costo text, estado_lote text, motivos text[])
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (privado.ve_costos() and privado.ve_area(p_area)) then
    raise exception 'Sin permiso para ver los costos de %.', p_area using errcode = '42501';
  end if;
  return query
  select 'APP'::text, l.id, l.codigo, l.fecha, g.nombre, g.unidad_base::text, l.neto_base, l.costo_total, l.estado_costo,
         case when exists (select 1 from public.anulaciones an where an.documento_tipo = 'LOTE' and an.documento_id = l.id)
              then 'ANULADA' else 'ACTIVA' end,
         coalesce((select array_agg(gi.nombre || ': sin costo en el kardex al producir (falta el conteo inicial o una compra).' order by c.linea)
                     from public.lote_consumos c
                     join public.productos pi on pi.id = c.producto_id
                     join public.genericos gi on gi.id = pi.generico_id
                    where c.lote_id = l.id and c.movimiento_id is not null and c.costo_unitario is null), '{}'::text[])
    from public.lotes_produccion l
    join public.productos p on p.id = l.producto_id
    join public.genericos g on g.id = p.generico_id
   where l.area = p_area and l.estado_costo <> 'COMPLETO'
  union all
  select 'HISTÓRICO'::text, h.id, h.codigo, h.fecha, g.nombre, 'g'::text, h.neto_g, h.costo_total, h.estado_costo, h.estado_lote,
         array_remove(array[
           case when 'SIN_NETO' = any (h.hallazgos) or coalesce(h.neto_g, 0) <= 0 then 'El lote no tiene peso neto final: no se puede sacar el costo por gramo.' end,
           case when 'SIN_INGREDIENTES' = any (h.hallazgos) or not exists (select 1 from public.lote_historico_consumos c where c.lote_id = h.id)
                then 'No tiene ingredientes registrados.' end,
           case when 'LINEA_REVISAR' = any (h.hallazgos) then 'El .gs marcó líneas por revisar en este lote.' end
         ], null)
         || coalesce((select array_agg(coalesce(gi.nombre, c.nombre_original) || ': ' || upper(left(coalesce(c.fuente_costo, 'sin costo'), 1)) || lower(substr(coalesce(c.fuente_costo, 'sin costo'), 2)) || '.' order by c.linea)
                       from public.lote_historico_consumos c
                       join public.genericos gi on gi.id = c.generico_id
                      where c.lote_id = h.id and c.costo_unitario is null and coalesce(c.tipo, '') <> 'SIN_COSTO'), '{}'::text[])
    from public.lotes_historicos h
    join public.genericos g on g.id = h.generico_id
   where p_area = 'BAR' and h.estado_costo <> 'COMPLETO'
   order by 4 desc, 3 desc;
end
$$;

revoke execute on function public.lotes_sin_costo(public.area_app) from public, anon;
grant execute on function public.lotes_sin_costo(public.area_app) to authenticated;
