-- =====================================================================================
-- SGI Di Égida · Producción · 4 · Lotes y trazabilidad (Anthony, 05/11/2026)
-- El kardex lleva saldos por producto y zona; para seguir un lote hace falta saber de QUÉ
-- entrada salió cada consumo. Aquí:
--   · public.partidas: cada entrada al inventario nace como una partida con su origen
--     (recepción y su línea, lote de producción, conteo inicial o ajuste) y su vencimiento.
--     Un traslado parte la partida: la de destino es hija de la de origen y conserva su origen.
--   · public.partida_consumos: cada salida queda repartida entre partidas. Por defecto, la que
--     vence primero (y entre iguales, la más vieja); si quien produce escaneó un lote, sale de
--     ese primero (sgi.origen_preferido). Lo que no alcanza a cubrir ninguna partida queda
--     «sin partida» y se ve como tal.
--   · Una reversa devuelve a las mismas partidas (salida) o consume la partida que había creado
--     (entrada). Nada se borra.
-- Todo lo arma un disparador sobre public.movimientos: ningún documento cambia su forma de
-- registrar. Los movimientos que ya existían se reparten al instalar, en orden de registro.
-- =====================================================================================

create table public.partidas (
  id             uuid primary key default gen_random_uuid(),
  producto_id    uuid not null references public.productos (id),
  ubicacion      text not null references public.ubicaciones (codigo),
  origen_tipo    text not null check (origen_tipo in ('RECEPCION', 'LOTE', 'SALDO_INICIAL', 'AJUSTE', 'TRASLADO', 'OTRO')),
  origen_doc     uuid,                    -- recepción, lote, conteo o traslado
  origen_linea   uuid,                    -- línea de la recepción
  movimiento_id  bigint not null references public.movimientos (id),   -- la entrada que la creó
  padre_id       uuid references public.partidas (id),                  -- traslado: de qué partida viene
  fecha          date not null,
  vence          date,
  cantidad       numeric not null check (cantidad > 0),                  -- unidad base
  creado_en      timestamptz not null default now()
);
create index partidas_producto_idx on public.partidas (producto_id, ubicacion);
create index partidas_origen_idx on public.partidas (origen_tipo, origen_doc);
create index partidas_movimiento_idx on public.partidas (movimiento_id);

create table public.partida_consumos (
  id             bigint generated always as identity primary key,
  partida_id     uuid references public.partidas (id),                  -- null = no había partida que cubriera
  movimiento_id  bigint not null references public.movimientos (id),   -- la salida (o la reversa)
  producto_id    uuid not null references public.productos (id),
  ubicacion      text not null,
  cantidad       numeric not null check (cantidad <> 0),               -- > 0 sale de la partida; < 0 vuelve (reversa)
  creado_en      timestamptz not null default now()
);
create index partida_consumos_partida_idx on public.partida_consumos (partida_id);
create index partida_consumos_movimiento_idx on public.partida_consumos (movimiento_id);

comment on table public.partidas is 'Cada entrada al inventario con su origen: de aquí sale la trazabilidad hacia atrás y la existencia por lote.';
comment on table public.partida_consumos is 'Reparto de cada salida del kardex entre partidas (vence primero, o el lote escaneado).';

do $$
declare t text;
begin
  foreach t in array array['partidas', 'partida_consumos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (privado.ve_costos())', t || '_leer', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function privado.bloquear_cambios()', t || '_inmutable', t);
  end loop;
end
$$;

create or replace function privado.restante_partida(p_partida uuid)
returns numeric language sql stable security definer set search_path = ''
as $$
  select p.cantidad - coalesce((select sum(c.cantidad) from public.partida_consumos c where c.partida_id = p.id), 0)
    from public.partidas p where p.id = p_partida
$$;

-- ---------------------------------------------------------------- repartir un movimiento
create or replace function privado.trazar(m public.movimientos)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o         public.movimientos;
  v_pend    numeric;
  v_toma    numeric;
  v_pref    uuid := privado.uuid_o_null(nullif(current_setting('sgi.origen_preferido', true), ''));
  v_tipo    text;
  v_vence   date;
  s         public.movimientos;
  r         record;
begin
  if m.tipo = 'REVERSA' then
    select * into o from public.movimientos where id = m.reversa_de;
    if o.cantidad < 0 then
      -- deshacer una salida: lo que salió vuelve a las mismas partidas
      insert into public.partida_consumos (partida_id, movimiento_id, producto_id, ubicacion, cantidad)
      select c.partida_id, m.id, c.producto_id, c.ubicacion, -c.cantidad from public.partida_consumos c where c.movimiento_id = o.id;
    else
      -- deshacer una entrada: sus partidas se consumen por completo
      insert into public.partida_consumos (partida_id, movimiento_id, producto_id, ubicacion, cantidad)
      select p.id, m.id, p.producto_id, p.ubicacion, p.cantidad from public.partidas p where p.movimiento_id = o.id;
    end if;
    return;
  end if;

  if m.cantidad > 0 then
    if m.tipo = 'TRASLADO_ENTRADA' then
      -- la salida del mismo traslado: sus partidas pasan a la zona de destino como hijas
      select * into s from public.movimientos x
       where x.tipo = 'TRASLADO_SALIDA' and x.documento_id = m.documento_id and x.producto_id = m.producto_id
         and x.cantidad = -m.cantidad and x.id < m.id
       order by x.id desc limit 1;   -- registrar_traslado anota la salida y enseguida su entrada
      if s.id is not null then
        for r in select c.partida_id, c.cantidad, p.origen_tipo, p.origen_doc, p.origen_linea, p.fecha, p.vence
                   from public.partida_consumos c left join public.partidas p on p.id = c.partida_id
                  where c.movimiento_id = s.id and c.cantidad > 0 order by c.id loop
          insert into public.partidas (producto_id, ubicacion, origen_tipo, origen_doc, origen_linea, movimiento_id, padre_id, fecha, vence, cantidad)
          values (m.producto_id, m.ubicacion, coalesce(r.origen_tipo, 'TRASLADO'), coalesce(r.origen_doc, m.documento_id), r.origen_linea,
                  m.id, r.partida_id, coalesce(r.fecha, m.fecha), r.vence, r.cantidad);
        end loop;
        return;
      end if;
    end if;
    v_tipo := case m.tipo when 'ENTRADA_COMPRA' then 'RECEPCION' when 'ENTRADA_PRODUCCION' then 'LOTE'
                          when 'SALDO_INICIAL' then 'SALDO_INICIAL' when 'AJUSTE_CONTEO_POSITIVO' then 'AJUSTE'
                          when 'TRASLADO_ENTRADA' then 'TRASLADO' else 'OTRO' end;
    v_vence := case v_tipo
                 when 'RECEPCION' then (select rl.vencimiento from public.recepcion_lineas rl where rl.id = m.linea_id)
                 when 'LOTE' then (select l.vence from public.lotes_produccion l where l.id = m.documento_id) end;
    insert into public.partidas (producto_id, ubicacion, origen_tipo, origen_doc, origen_linea, movimiento_id, fecha, vence, cantidad)
    values (m.producto_id, m.ubicacion, v_tipo, m.documento_id, m.linea_id, m.id, m.fecha, v_vence, m.cantidad);
    return;
  end if;

  -- salida: primero el origen escaneado, luego lo que vence primero, luego lo más viejo
  v_pend := -m.cantidad;
  for r in
    select p.id, privado.restante_partida(p.id) as resto
      from public.partidas p
     where p.producto_id = m.producto_id and p.ubicacion = m.ubicacion
     order by (v_pref is not null and p.origen_doc = v_pref) desc, p.vence nulls last, p.fecha, p.creado_en, p.id
  loop
    exit when v_pend <= 0;
    continue when r.resto <= 0;
    v_toma := least(r.resto, v_pend);
    insert into public.partida_consumos (partida_id, movimiento_id, producto_id, ubicacion, cantidad)
    values (r.id, m.id, m.producto_id, m.ubicacion, v_toma);
    v_pend := v_pend - v_toma;
  end loop;
  if v_pend > 0 then
    insert into public.partida_consumos (partida_id, movimiento_id, producto_id, ubicacion, cantidad)
    values (null, m.id, m.producto_id, m.ubicacion, v_pend);
  end if;
end
$$;
revoke execute on function privado.trazar(public.movimientos), privado.restante_partida(uuid) from public;

create or replace function privado.trazar_disparador()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform privado.trazar(new);
  return new;
end
$$;

-- los movimientos que ya existen, en orden de registro
do $$
declare m public.movimientos;
begin
  for m in select * from public.movimientos order by id loop
    perform privado.trazar(m);
  end loop;
end
$$;

create trigger movimientos_trazar after insert on public.movimientos
  for each row execute function privado.trazar_disparador();

insert into public.parametros (clave, valor, descripcion)
select v.clave, v.valor, v.descripcion from (values
  ('LOTE_POR_VENCER_DIAS', '2', 'Un lote activo sale «por vencer» si vence dentro de estos días.')
) as v (clave, valor, descripcion)
where not exists (select 1 from public.parametros p where p.clave = v.clave);

-- ---------------------------------------------------------------- estado y existencia de un lote
-- existencia restante: Σ de sus partidas (las hijas de traslado conservan su origen)
create or replace function privado.restante_lote(p_lote uuid)
returns numeric language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(p.cantidad), 0)
       - coalesce((select sum(c.cantidad) from public.partida_consumos c join public.partidas q on q.id = c.partida_id
                    where q.origen_tipo = 'LOTE' and q.origen_doc = p_lote), 0)
    from public.partidas p where p.origen_tipo = 'LOTE' and p.origen_doc = p_lote
$$;

create or replace function privado.estado_lote(p_lote uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select case
    when exists (select 1 from public.anulaciones a where a.documento_tipo = 'LOTE' and a.documento_id = l.id) then 'REVERSADO'
    when privado.restante_lote(l.id) <= 0.0001 then
      case when exists (select 1 from public.partida_consumos c join public.partidas p on p.id = c.partida_id
                          join public.movimientos x on x.id = c.movimiento_id
                         where p.origen_tipo = 'LOTE' and p.origen_doc = l.id and x.tipo = 'SALIDA_BAJA')
            and not exists (select 1 from public.partida_consumos c join public.partidas p on p.id = c.partida_id
                              join public.movimientos x on x.id = c.movimiento_id
                             where p.origen_tipo = 'LOTE' and p.origen_doc = l.id and c.cantidad > 0
                               and x.tipo not in ('SALIDA_BAJA', 'TRASLADO_SALIDA', 'REVERSA'))
           then 'DADO_DE_BAJA' else 'CONSUMIDO' end
    when l.vence < privado.hoy() then 'VENCIDO'
    when l.vence <= privado.hoy() + privado.parametro_num('LOTE_POR_VENCER_DIAS', 2)::int then 'POR_VENCER'
    else 'ACTIVO' end
  from public.lotes_produccion l where l.id = p_lote
$$;
revoke execute on function privado.restante_lote(uuid), privado.estado_lote(uuid) from public;

-- ---------------------------------------------------------------- lista de lotes (app + históricos)
create or replace function public.lotes_lista(p_area public.area_app)
returns table (id uuid, codigo text, fecha date, registrado_en timestamptz, generico_id uuid, mpi text, unidad_base text, area text,
               responsable text, entrada_g numeric, neto_g numeric, merma_g numeric, rendimiento numeric, desvio_pp numeric,
               costo_total numeric, costo_gramo numeric, estado_costo text, vence date, conservacion text, restante numeric, estado text, origen text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.ve_area(p_area) then
    raise exception 'Sin permiso para ver los lotes de %.', p_area using errcode = '42501';
  end if;
  return query
  select l.id, l.codigo, l.fecha, l.registrado_en, g.id, g.nombre, g.unidad_base::text, l.area::text, pe.nombre,
         coalesce(l.entrada_g, l.entrada_base), coalesce(l.neto_g, l.neto_base), coalesce(l.merma_g, l.entrada_base - l.neto_base),
         l.rendimiento,
         coalesce(l.desvio_pp, case when l.rendimiento_ficha > 0 and l.rendimiento is not null then round((l.rendimiento - l.rendimiento_ficha) * 100, 2) end),
         l.costo_total, case when l.estado_costo = 'COMPLETO' then round(l.costo_total / coalesce(l.neto_g, l.neto_base), 6) end, l.estado_costo,
         l.vence, l.conservacion, privado.restante_lote(l.id), privado.estado_lote(l.id), 'APP'::text
    from public.lotes_produccion l
    join public.productos p on p.id = l.producto_id
    join public.genericos g on g.id = p.generico_id
    join public.perfiles pe on pe.id = l.responsable_id
   where l.area = p_area
  union all
  select h.id, h.codigo, h.fecha, null::timestamptz, g.id, g.nombre, g.unidad_base::text, g.area::text, null::text,
         h.entrada_g, h.neto_g, h.entrada_g - h.neto_g, h.rendimiento,
         case when h.rendimiento_ficha > 0 and h.rendimiento is not null then round((h.rendimiento - h.rendimiento_ficha) * 100, 2) end,
         h.costo_total, h.costo_g, h.estado_costo,
         case when h.vida_util_dias is not null then h.fecha + h.vida_util_dias::int end, h.conservacion, null::numeric, 'HISTORICO'::text, 'SGI-COSTOS'::text
    from public.lotes_historicos h join public.genericos g on g.id = h.generico_id
   where g.area = p_area
   order by 3 desc, 2 desc;
end
$$;

-- ---------------------------------------------------------------- cadena de un lote
-- hacia atrás: cada insumo del lote, de qué partidas salió y, si fue otra MPI, su propia cadena
create or replace function privado.traza_atras(p_lote uuid, p_nivel integer)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'linea', lc.linea, 'producto', g.nombre, 'presentacion', concat_ws(' · ', nullif(pr.marca, ''), nullif(pr.presentacion, '')),
           'tipo', g.tipo, 'unidad_base', g.unidad_base, 'cantidad_base', lc.cantidad_base, 'gramos', lc.gramos, 'costo', lc.costo,
           'costo_unitario', lc.costo_unitario, 'zona', u.nombre,
           'origenes', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'cantidad', c.cantidad, 'tipo', p.origen_tipo, 'fecha', p.fecha, 'vence', p.vence,
                      'documento_id', p.origen_doc,
                      'codigo', case p.origen_tipo when 'RECEPCION' then rc.codigo when 'LOTE' then lo.codigo
                                                   when 'SALDO_INICIAL' then co.codigo when 'AJUSTE' then co.codigo end,
                      'proveedor', pv.nombre, 'documento', rc.documento, 'lote_proveedor', rl.lote_proveedor,
                      'mpi', (select g2.nombre from public.productos p2 join public.genericos g2 on g2.id = p2.generico_id where p2.id = lo.producto_id),
                      'cadena', case when p.origen_tipo = 'LOTE' and p_nivel < 6 then privado.traza_atras(lo.id, p_nivel + 1) end)
                    order by c.id)
               from public.partida_consumos c
               left join public.partidas p on p.id = c.partida_id
               left join public.recepciones rc on p.origen_tipo = 'RECEPCION' and rc.id = p.origen_doc
               left join public.recepcion_lineas rl on rl.id = p.origen_linea
               left join public.proveedores pv on pv.id = rc.proveedor_id
               left join public.lotes_produccion lo on p.origen_tipo = 'LOTE' and lo.id = p.origen_doc
               left join public.conteos co on p.origen_tipo in ('SALDO_INICIAL', 'AJUSTE') and co.id = p.origen_doc
              where c.movimiento_id = lc.movimiento_id and c.cantidad > 0), '[]'))
         order by lc.linea), '[]')
    from public.lote_consumos lc
    join public.productos pr on pr.id = lc.producto_id
    join public.genericos g on g.id = pr.generico_id
    left join public.ubicaciones u on u.codigo = lc.ubicacion
   where lc.lote_id = p_lote
$$;

-- hacia adelante: en qué salió lo producido (otras producciones, bajas, ajustes, traslados, ventas)
create or replace function privado.traza_adelante(p_lote uuid, p_nivel integer)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', x.tipo, 'fecha', x.fecha, 'cantidad', c.cantidad, 'zona', u.nombre, 'documento_tipo', x.documento_tipo, 'documento_id', x.documento_id,
           'codigo', case x.documento_tipo when 'LOTE' then lo.codigo when 'BAJA' then (select b.codigo from public.bajas b where b.id = x.documento_id)
                                           when 'TRASLADO' then (select t.codigo from public.traslados t where t.id = x.documento_id)
                                           when 'CONTEO' then (select k.codigo from public.conteos k where k.id = x.documento_id) end,
           'detalle', case x.documento_tipo
                        when 'LOTE' then (select g2.nombre from public.productos p2 join public.genericos g2 on g2.id = p2.generico_id where p2.id = lo.producto_id)
                        when 'BAJA' then (select b.causa from public.bajas b where b.id = x.documento_id)
                        when 'TRASLADO' then (select uo.nombre || ' → ' || ud.nombre from public.traslados t join public.ubicaciones uo on uo.codigo = t.origen
                                                                                    join public.ubicaciones ud on ud.codigo = t.destino where t.id = x.documento_id) end,
           'reversado', exists (select 1 from public.movimientos rv where rv.reversa_de = x.id),
           'cadena', case when x.documento_tipo = 'LOTE' and x.tipo = 'SALIDA_A_PRODUCCION' and p_nivel < 6 then privado.traza_adelante(lo.id, p_nivel + 1) end)
         order by x.id), '[]')
    from public.partida_consumos c
    join public.partidas p on p.id = c.partida_id
    join public.movimientos x on x.id = c.movimiento_id
    left join public.ubicaciones u on u.codigo = x.ubicacion
    left join public.lotes_produccion lo on x.documento_tipo = 'LOTE' and lo.id = x.documento_id
   where p.origen_tipo = 'LOTE' and p.origen_doc = p_lote and c.cantidad > 0 and x.tipo <> 'REVERSA'
$$;
revoke execute on function privado.traza_atras(uuid, integer), privado.traza_adelante(uuid, integer) from public;

create or replace function public.traza_lote(p_codigo text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  l  public.lotes_produccion%rowtype;
  h  public.lotes_historicos%rowtype;
  v_area public.area_app;
begin
  select * into l from public.lotes_produccion where codigo = trim(p_codigo);
  if l.id is not null then
    if not privado.ve_area(l.area) then raise exception 'Sin permiso para ver lotes de %.', l.area using errcode = '42501'; end if;
    return jsonb_build_object(
      'origen', 'APP',
      'lote', (select jsonb_build_object(
                 'id', l.id, 'codigo', l.codigo, 'area', l.area, 'fecha', l.fecha, 'registrado_en', l.registrado_en,
                 'mpi', g.nombre, 'generico_id', g.id, 'unidad_base', g.unidad_base, 'zona', u.nombre,
                 'responsable', pe.nombre, 'usuario', (select x.nombre from public.perfiles x where x.id = l.usuario_id),
                 'ficha_id', l.ficha_id, 'ficha', (select f.codigo || ' v' || f.version from public.fichas f where f.id = l.ficha_id),
                 'entrada_g', coalesce(l.entrada_g, l.entrada_base), 'neto_g', coalesce(l.neto_g, l.neto_base), 'neto_base', l.neto_base,
                 'merma_g', coalesce(l.merma_g, l.entrada_base - l.neto_base), 'rendimiento', l.rendimiento, 'rendimiento_ficha', l.rendimiento_ficha,
                 'desvio_pp', l.desvio_pp, 'costo_total', l.costo_total, 'costo_unitario', l.costo_unitario, 'estado_costo', l.estado_costo,
                 'vence', l.vence, 'conservacion', l.conservacion, 'tiempo_min', l.tiempo_min, 'tandas', l.tandas,
                 'observaciones', l.observaciones, 'avisos', to_jsonb(l.avisos), 'forzado', l.forzado, 'motivo_forzado', l.motivo_forzado,
                 'restante', privado.restante_lote(l.id), 'estado', privado.estado_lote(l.id))
               from public.productos p join public.genericos g on g.id = p.generico_id
               join public.ubicaciones u on u.codigo = l.ubicacion join public.perfiles pe on pe.id = l.responsable_id
              where p.id = l.producto_id),
      'atras', privado.traza_atras(l.id, 1),
      'adelante', privado.traza_adelante(l.id, 1),
      'sin_partida', (select coalesce(sum(c.cantidad), 0) from public.partida_consumos c join public.lote_consumos lc on lc.movimiento_id = c.movimiento_id
                       where lc.lote_id = l.id and c.partida_id is null));
  end if;

  -- lote histórico de SGI-COSTOS: su cadena viaja por el código escrito en «lote de origen»
  select * into h from public.lotes_historicos where codigo = trim(p_codigo);
  if h.id is null then return null; end if;
  select g.area into v_area from public.genericos g where g.id = h.generico_id;
  if not privado.ve_area(v_area) then raise exception 'Sin permiso para ver lotes de %.', v_area using errcode = '42501'; end if;
  return jsonb_build_object(
    'origen', 'SGI-COSTOS',
    'lote', (select jsonb_build_object('id', h.id, 'codigo', h.codigo, 'area', v_area, 'fecha', h.fecha, 'mpi', g.nombre, 'generico_id', g.id,
                                       'unidad_base', g.unidad_base, 'entrada_g', h.entrada_g, 'neto_g', h.neto_g, 'merma_g', h.entrada_g - h.neto_g,
                                       'rendimiento', h.rendimiento, 'rendimiento_ficha', h.rendimiento_ficha,
                                       'desvio_pp', case when h.rendimiento_ficha > 0 then round((h.rendimiento - h.rendimiento_ficha) * 100, 2) end,
                                       'costo_total', h.costo_total, 'costo_unitario', h.costo_g, 'estado_costo', h.estado_costo,
                                       'vence', case when h.vida_util_dias is not null then h.fecha + h.vida_util_dias::int end,
                                       'conservacion', h.conservacion, 'empaque', h.empaque, 'tecnica', h.tecnica, 'tiempo_min', h.tiempo_min,
                                       'observaciones', h.observaciones, 'estado', 'HISTORICO')
               from public.genericos g where g.id = h.generico_id),
    'atras', coalesce((select jsonb_agg(jsonb_build_object('linea', c.linea, 'producto', coalesce(g.nombre, c.nombre_original), 'tipo', c.tipo,
                                                           'cantidad', c.cantidad, 'unidad', c.unidad, 'merma', c.merma, 'costo', c.costo,
                                                           'costo_unitario', c.costo_unitario, 'fuente_costo', c.fuente_costo, 'lote_origen', c.lote_origen)
                                        order by c.linea)
                         from public.lote_historico_consumos c left join public.genericos g on g.id = c.generico_id where c.lote_id = h.id), '[]'),
    'adelante', coalesce((select jsonb_agg(jsonb_build_object('codigo', o.codigo, 'fecha', o.fecha, 'mpi', g.nombre, 'cantidad', c.cantidad, 'unidad', c.unidad)
                                           order by o.fecha)
                            from public.lote_historico_consumos c join public.lotes_historicos o on o.id = c.lote_id
                            join public.genericos g on g.id = o.generico_id where c.lote_origen = h.codigo), '[]'));
end
$$;

revoke execute on function public.lotes_lista(public.area_app), public.traza_lote(text) from public, anon;
grant execute on function public.lotes_lista(public.area_app), public.traza_lote(text) to authenticated;

-- ---------------------------------------------------------------- registrar un lote (v5)
-- Igual que la v4 (20261107150000) y además: consumos[].lote_origen (id del lote escaneado) sale primero.
create or replace function public.registrar_lote(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_area     public.area_app;
  v_fecha    date := privado.fecha_o_null(p ->> 'fecha');
  v_ubic     text := coalesce(nullif(p ->> 'ubicacion_destino', ''), p ->> 'ubicacion');
  v_ulin     text; v_unom text;
  v_resp     uuid := privado.uuid_o_null(p ->> 'responsable_id');
  v_mpi      uuid := privado.uuid_o_null(p ->> 'producto_id');
  v_ficha    uuid := privado.uuid_o_null(p ->> 'ficha_id');
  v_neto_g   numeric := coalesce(privado.num_o_null(p ->> 'neto_g'), privado.num_o_null(p ->> 'neto'));
  v_und      numeric := privado.num_o_null(p ->> 'unidades');
  v_nfactor  numeric := privado.num_o_null(p ->> 'neto_factor');
  v_neto     numeric;            -- neto en la unidad base del MPI (lo que entra al kardex)
  v_cons     text := nullif(p ->> 'conservacion', '');
  v_motivo   text := nullif(trim(p ->> 'motivo_forzado'), '');
  f text[] := '{}'; b text[] := '{}'; a text[] := '{}';
  v_rechazo  jsonb;
  v_id       uuid := gen_random_uuid();
  v_codigo   text;
  v_mpi_rec  record;
  v_c        jsonb; v_n integer; v_ref text; v_prod record;
  v_gr       numeric; v_cant numeric; v_unidad text; v_base numeric; v_factor numeric; v_merma numeric; v_merma_total numeric := 0;
  v_entrada_g numeric := 0;
  v_saldo    numeric;
  v_lineas   jsonb := '[]';
  v_l        jsonb;
  v_mov      public.movimientos;
  v_total    numeric := 0;
  v_sin_costo integer := 0;
  v_rend     numeric; v_rend_ficha numeric; v_neto_ficha numeric; v_suma_ficha numeric; v_desvio numeric;
  v_cu       numeric;
  v_estado   text;
  v_vida     integer;
  v_vence    date;
  v_conv     jsonb := '[]';      -- conversiones g → unidad base declaradas en este lote
begin
  begin v_area := (p ->> 'area')::public.area_app;
  exception when others then raise exception 'Área no válida: %', p ->> 'area'; end;
  if not privado.puede_operar(v_area) then
    raise exception 'Sin permiso para registrar producción en %.', v_area using errcode = '42501';
  end if;

  select * into f, a from privado.validar_fecha(v_fecha, p ->> 'fecha', f, a);
  if v_resp is null or not exists (select 1 from public.perfiles pe where pe.id = v_resp and pe.activo) then
    f := f || 'F2 · Falta el responsable del lote.'::text;
  end if;
  if not exists (select 1 from public.ubicaciones u where u.codigo = v_ubic and u.area = v_area and u.activo) then
    f := f || (case when coalesce(v_ubic, '') = '' then 'F1 · Falta la zona donde quedó guardado el lote.'
                    else 'F1 · La zona «' || v_ubic || '» donde se guarda el lote no existe en ' || v_area || '.' end);
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
  if jsonb_typeof(p -> 'consumos') is distinct from 'array' or jsonb_array_length(p -> 'consumos') = 0 then
    f := f || 'F4 · No hay ningún ingrediente con su peso.'::text;
  end if;

  -- neto: pesado en gramos; entra al kardex en la unidad base del MPI
  if v_neto_g is null or v_neto_g <= 0 then
    f := f || 'F7 · Falta el PESO NETO obtenido (g).'::text;
  elsif v_mpi_rec.id is not null then
    if v_mpi_rec.unidad_base = 'und' then
      if v_und is null or v_und <= 0 then f := f || ('F7 · ' || v_mpi_rec.nombre || ' se cuenta por unidades: escribe cuántas salieron.'); end if;
      v_neto := v_und;
    else
      v_neto := coalesce(privado.a_base(v_mpi_rec.generico_id, v_neto_g, 'g'), case when v_nfactor > 0 then v_neto_g * v_nfactor end);
      if v_neto is null then
        f := f || ('F8 · ' || v_mpi_rec.nombre || ' se lleva en ' || v_mpi_rec.unidad_base || ': falta cuántos ' || v_mpi_rec.unidad_base || ' son 1 g.');
      elsif privado.a_base(v_mpi_rec.generico_id, 1, 'g') is null then
        v_conv := v_conv || jsonb_build_object('generico_id', v_mpi_rec.generico_id, 'factor', v_nfactor);
      end if;
    end if;
  end if;

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

    -- peso real (g) y lo que sale del kardex en la unidad base
    v_gr := privado.num_o_null(v_c ->> 'gramos');
    v_factor := privado.num_o_null(v_c ->> 'factor');
    if v_gr is not null then
      if v_gr <= 0 then f := f || ('F6 · ' || v_ref || ': el peso debe ser mayor que cero.'); continue; end if;
      v_cant := v_gr; v_unidad := 'g';
      if v_prod.unidad_base = 'und' then
        v_base := privado.num_o_null(v_c ->> 'unidades');
        if v_base is null or v_base <= 0 then f := f || ('F6 · ' || v_ref || ': se cuenta por unidades; escribe cuántas usaste además del peso.'); continue; end if;
      else
        v_base := coalesce(privado.a_base(v_prod.generico_id, v_gr, 'g'), case when v_factor > 0 then v_gr * v_factor end);
        if v_base is null then
          f := f || ('F8 · ' || v_ref || ': se lleva en ' || v_prod.unidad_base || '; falta cuántos ' || v_prod.unidad_base || ' son 1 g.'); continue;
        end if;
        if privado.a_base(v_prod.generico_id, 1, 'g') is null then
          v_conv := v_conv || jsonb_build_object('generico_id', v_prod.generico_id, 'factor', v_factor);
        end if;
      end if;
    else
      -- formato anterior: {cantidad, unidad}
      v_cant := privado.num_o_null(v_c ->> 'cantidad');
      v_unidad := coalesce(nullif(lower(v_c ->> 'unidad'), ''), v_prod.unidad_base::text);
      if v_cant is null or v_cant <= 0 then f := f || ('F6 · ' || v_ref || ': falta el peso real usado.'); continue; end if;
      v_base := privado.a_base(v_prod.generico_id, v_cant, v_unidad);
      if v_base is null then
        f := f || ('F8 · ' || v_ref || ': falta la conversión ' || v_unidad || '→' || v_prod.unidad_base || '.'); continue;
      end if;
      v_gr := case when v_unidad = 'g' then v_cant when v_prod.unidad_base in ('g', 'ml') then v_base end;
    end if;

    v_merma := privado.num_o_null(v_c ->> 'merma');
    if v_merma is not null and (v_merma < 0 or v_merma > v_cant) then
      f := f || ('F6 · ' || v_ref || ': la merma no puede ser negativa ni mayor que el peso usado.'); continue;
    end if;
    if v_merma > 0 then v_merma_total := v_merma_total + v_base * v_merma / v_cant; end if;
    if v_base > privado.parametro_num('MAX_CANTIDAD_LINEA', 50000) then
      b := b || ('B1 · ' || v_ref || ': ' || round(v_base) || ' ' || v_prod.unidad_base || ' — ¿sobra un dígito?');
    end if;

    -- existencia: si no alcanza en la zona, no se produce
    v_ulin := null;
    if v_prod.tipo <> 'SIN_COSTO' then
      v_ulin := coalesce(nullif(v_c ->> 'ubicacion', ''), v_ubic);
      v_unom := null;
      select u.nombre into v_unom from public.ubicaciones u where u.codigo = v_ulin and u.area = v_area and u.activo;
      if v_unom is null then
        f := f || ('F1 · ' || v_ref || ': falta la zona de donde se cogió, o no es una zona de ' || v_area || '.'); continue;
      end if;
      select coalesce(sum(e.cantidad), 0) into v_saldo from public.existencias e
       where e.producto_id = v_prod.id and e.ubicacion = v_ulin;
      v_saldo := v_saldo - coalesce((select sum((l ->> 'base')::numeric) from jsonb_array_elements(v_lineas) l
                                      where (l ->> 'producto_id')::uuid = v_prod.id and l ->> 'ubic' = v_ulin), 0);
      if v_saldo < v_base then
        f := f || ('F9 · ' || v_ref || ': en ' || v_unom || ' hay ' || round(greatest(v_saldo, 0), 2) || ' ' || v_prod.unidad_base
                   || ' y se necesitan ' || round(v_base, 2) || '. Registra primero la recepción o el traslado.');
      end if;
    end if;
    if v_gr is not null then v_entrada_g := v_entrada_g + v_gr; end if;
    v_lineas := v_lineas || jsonb_build_object('n', v_n, 'producto_id', v_prod.id, 'tipo', v_prod.tipo,
                                               'cantidad', v_cant, 'unidad', v_unidad, 'base', v_base, 'gramos', v_gr,
                                               'nota', v_c ->> 'nota', 'merma', v_merma, 'ubic', v_ulin,
                                               'origen', privado.uuid_o_null(v_c ->> 'lote_origen'),
                                               'merma_base', case when v_merma is not null and v_cant > 0 then round(v_base * v_merma / v_cant, 4) end);
  end loop;

  if v_neto_g > 0 and v_entrada_g > 0 and v_neto_g > v_entrada_g * 1.10 then
    b := b || ('B2 · El neto (' || v_neto_g || ' g) supera lo que entró (' || round(v_entrada_g) || ' g) en más de 10 %.');
  end if;

  -- almacenamiento y vencimiento según la ficha
  if v_cons is not null and v_cons not in ('Ambiente', 'Refrigerado', 'Congelado') then
    f := f || 'F1 · Almacenamiento no válido: ambiente, refrigerado o congelado.'::text;
  end if;
  if v_ficha is not null then
    if v_cons is null and (select count(*) from public.ficha_almacenamientos fa where fa.ficha_id = v_ficha) = 1 then
      select fa.conservacion into v_cons from public.ficha_almacenamientos fa where fa.ficha_id = v_ficha;
    end if;
    select fa.vida_util_dias into v_vida from public.ficha_almacenamientos fa where fa.ficha_id = v_ficha and fa.conservacion = v_cons;
  end if;
  if v_vida is not null and v_fecha is not null then v_vence := v_fecha + v_vida; end if;
  -- solo se avisa si la ficha sí tiene vida útil (la lista de fichas ya dice cuáles no la tienen)
  if v_vence is null and exists (select 1 from public.ficha_almacenamientos fa where fa.ficha_id = v_ficha) then
    a := a || (case when v_cons is null then 'Sin almacenamiento elegido: el lote queda sin fecha de vencimiento.'
                    else 'La ficha no tiene vida útil en ' || lower(v_cons) || ': el lote queda sin fecha de vencimiento.' end);
  end if;

  v_rechazo := privado.rechazo('lotes_produccion', f, b, a, v_motivo);
  if v_rechazo is not null then return v_rechazo; end if;

  -- conversiones g → unidad base que se declararon al pesar
  insert into public.conversiones (generico_id, unidad, factor_a_base, estado, nota)
  select distinct on ((x ->> 'generico_id')::uuid) (x ->> 'generico_id')::uuid, 'g', (x ->> 'factor')::numeric, 'DECLARADO', 'Declarada al producir'
    from jsonb_array_elements(v_conv) x
   where (x ->> 'factor')::numeric > 0
  on conflict (generico_id, unidad) do nothing;

  -- consumos de producción al promedio vigente
  for v_l in select value from jsonb_array_elements(v_lineas)
  loop
    if v_l ->> 'tipo' = 'SIN_COSTO' then continue; end if;
    -- el lote o la recepción que se escaneó sale primero (privado.trazar)
    perform set_config('sgi.origen_preferido', coalesce(v_l ->> 'origen', ''), true);
    v_mov := privado.registrar_movimiento('SALIDA_A_PRODUCCION', (v_l ->> 'producto_id')::uuid, v_l ->> 'ubic',
                                          (v_l ->> 'base')::numeric, v_fecha, null, 'LOTE', v_id);
    if v_mov.costo_total is null then v_sin_costo := v_sin_costo + 1;
    else v_total := v_total - v_mov.costo_total; end if;
    v_lineas := (select jsonb_agg(case when (x ->> 'n')::int = (v_l ->> 'n')::int
                                       then x || jsonb_build_object('mov', v_mov.id, 'cu', v_mov.costo_unitario, 'costo', -v_mov.costo_total)
                                       else x end order by (x ->> 'n')::int)
                   from jsonb_array_elements(v_lineas) x);
  end loop;

  perform set_config('sgi.origen_preferido', '', true);
  v_estado := case when v_sin_costo > 0 then 'PARCIAL' else 'COMPLETO' end;
  v_cu := case when v_estado = 'COMPLETO' then round(v_total / v_neto, 6) end;
  if v_sin_costo > 0 then
    a := a || (v_sin_costo || ' insumo(s) sin costo en el kardex: el lote queda PARCIAL y entra al promedio vigente del MPI.');
  end if;

  -- rendimiento contra la ficha, en puntos
  v_rend := case when v_entrada_g > 0 then v_neto_g / v_entrada_g end;
  if v_ficha is not null then
    select fi.neto_esperado into v_neto_ficha from public.fichas fi where fi.id = v_ficha;
    select case when count(*) = count(c.cantidad_base) then sum(c.cantidad_base) end into v_suma_ficha
      from public.costo_ficha(v_ficha) c;
    v_rend_ficha := case when v_neto_ficha > 0 and v_suma_ficha > 0 then v_neto_ficha / v_suma_ficha end;
    if v_rend_ficha > 0 and v_rend is not null then
      v_desvio := round((v_rend - v_rend_ficha) * 100, 2);
      if abs(v_desvio) > privado.parametro_num('DESVIO_REND_AVISO_PP', 5) then
        a := a || ('Rendimiento ' || round(v_rend * 100, 1) || ' % vs ficha ' || round(v_rend_ficha * 100, 1) || ' %: '
                   || case when v_desvio > 0 then '+' else '' end || v_desvio || ' puntos.');
      end if;
    end if;
  end if;

  v_codigo := privado.siguiente_codigo('PRO-' || v_area || '-' || to_char(v_fecha, 'YYYY'), 4);
  insert into public.lotes_produccion (id, codigo, area, ubicacion, fecha, producto_id, ficha_id, responsable_id,
                                       tiempo_min, unidades, entrada_base, neto_base, rendimiento, rendimiento_ficha,
                                       costo_total, costo_unitario, estado_costo, observaciones, forzado, motivo_forzado, avisos,
                                       entrada_g, neto_g, desvio_pp, tandas, conservacion, vence)
  values (v_id, v_codigo, v_area, v_ubic, v_fecha, v_mpi, v_ficha, v_resp,
          privado.num_o_null(p ->> 'tiempo_min'), v_und,
          coalesce((select sum((x ->> 'base')::numeric) from jsonb_array_elements(v_lineas) x), 0), v_neto, v_rend, v_rend_ficha,
          v_total, v_cu, v_estado, nullif(trim(p ->> 'observaciones'), ''), cardinality(b) > 0,
          case when cardinality(b) > 0 then v_motivo end, a,
          nullif(v_entrada_g, 0), v_neto_g, v_desvio, privado.num_o_null(p ->> 'tandas'), v_cons, v_vence);

  insert into public.lote_consumos (lote_id, linea, producto_id, cantidad, unidad, cantidad_base, gramos,
                                    costo_unitario, costo, movimiento_id, nota, merma, merma_base, ubicacion)
  select v_id, (x ->> 'n')::int, (x ->> 'producto_id')::uuid, (x ->> 'cantidad')::numeric, x ->> 'unidad',
         (x ->> 'base')::numeric, (x ->> 'gramos')::numeric,
         case when x ->> 'tipo' = 'SIN_COSTO' then 0 else (x ->> 'cu')::numeric end,
         case when x ->> 'tipo' = 'SIN_COSTO' then 0 else (x ->> 'costo')::numeric end,
         (x ->> 'mov')::bigint, nullif(x ->> 'nota', ''), (x ->> 'merma')::numeric, (x ->> 'merma_base')::numeric,
         x ->> 'ubic'
    from jsonb_array_elements(v_lineas) x;

  perform privado.registrar_movimiento('ENTRADA_PRODUCCION', v_mpi, v_ubic, v_neto, v_fecha, v_cu, 'LOTE', v_id);

  perform privado.bitacora('LOTE GUARDADO', 'lotes_produccion', v_codigo,
                           jsonb_build_object('neto_g', v_neto_g, 'entrada_g', v_entrada_g, 'costo_total', v_total, 'costo_unitario', v_cu,
                                              'estado_costo', v_estado, 'desvio_pp', v_desvio, 'vence', v_vence, 'bloqueos', to_jsonb(b)),
                           case when cardinality(b) > 0 then v_motivo end);
  return privado.resultado(true, v_id, v_codigo, f, b, a) || jsonb_build_object(
    'costo_total', v_total, 'costo_unitario', v_cu, 'estado_costo', v_estado, 'rendimiento', v_rend,
    'entrada_g', v_entrada_g, 'neto_g', v_neto_g, 'merma_g', v_entrada_g - v_neto_g, 'desvio_pp', v_desvio,
    'costo_gramo', case when v_estado = 'COMPLETO' then round(v_total / v_neto_g, 6) end,
    'vence', v_vence, 'conservacion', v_cons, 'merma_base', round(v_merma_total, 2));
end
$$;

