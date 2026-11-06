-- =====================================================================================
-- SGI Di Égida · Producción · 3 · Producir un lote (rediseño, Anthony 05/11/2026)
-- Reglas acordadas:
--   · Todo se pesa en GRAMOS. Cada ingrediente trae su peso real; si el insumo se lleva en ml,
--     el kardex lo descuenta con su conversión g→ml (la persona la declara la primera vez).
--   · Si la existencia de la zona no alcanza, el lote NO se guarda (ya no se fuerza con motivo):
--     primero se registra la recepción o el traslado.
--   · Responsable, neto y pesos reales son obligatorios.
--   · entrada = Σ pesos (g) · merma = entrada − neto · rendimiento = neto / entrada
--     desvío (pp) = (rendimiento − rendimiento de la ficha) × 100, aviso sobre DESVIO_REND_AVISO_PP
--     costo = Σ salidas del kardex al promedio vigente · $/g = costo / neto
--     vence = fecha + vida útil del almacenamiento elegido (ficha_almacenamientos)
--   · Código PRO-<ÁREA>-<AÑO>-0001 (los históricos de SGI-COSTOS son PRO-2026-001…077).
-- La transacción sigue siendo una sola: SALIDA_A_PRODUCCION por ingrediente (en pantalla
-- «Consumo de producción»), ENTRADA_PRODUCCION del MPI con su costo y el lote.
-- =====================================================================================

insert into public.parametros (clave, valor, descripcion)
select v.clave, v.valor, v.descripcion from (values
  ('DESVIO_REND_AVISO_PP', '5', 'Avisa si el rendimiento del lote se aparta de la ficha más de estos puntos porcentuales.')
) as v (clave, valor, descripcion)
where not exists (select 1 from public.parametros p where p.clave = v.clave);

alter table public.lotes_produccion
  add column entrada_g     numeric check (entrada_g > 0),     -- Σ pesos reales
  add column neto_g        numeric check (neto_g > 0),        -- peso neto obtenido
  add column merma_g       numeric generated always as (entrada_g - neto_g) stored,
  add column desvio_pp     numeric,                           -- rendimiento real − ficha, en puntos
  add column tandas        numeric check (tandas > 0),
  add column conservacion  text check (conservacion in ('Ambiente', 'Refrigerado', 'Congelado')),
  add column vence         date;
comment on column public.lotes_produccion.entrada_g is 'Suma de los pesos reales (g) de los ingredientes. Antes de 07/11/2026: null (se usaba entrada_base).';

alter table public.lote_consumos add column gramos numeric check (gramos > 0);
comment on column public.lote_consumos.gramos is 'Peso real usado (g). cantidad_base es lo que salió del kardex en la unidad base del insumo.';

-- ---------------------------------------------------------------- registrar un lote (v4)
-- p: {area, fecha, producto_id, ficha_id?, responsable_id, ubicacion_destino, conservacion?, tandas?,
--     neto_g, unidades?, neto_factor? (1 g = x de la unidad base del MPI, si es ml),
--     tiempo_min?, observaciones?, motivo_forzado?,
--     consumos: [{producto_id, gramos, unidades? (si el insumo se cuenta), factor? (1 g = x ml),
--                 ubicacion, merma?, nota?}]}
-- Compatibilidad: un consumo sin «gramos» con {cantidad, unidad} se toma como antes.
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
    v_mov := privado.registrar_movimiento('SALIDA_A_PRODUCCION', (v_l ->> 'producto_id')::uuid, v_l ->> 'ubic',
                                          (v_l ->> 'base')::numeric, v_fecha, null, 'LOTE', v_id);
    if v_mov.costo_total is null then v_sin_costo := v_sin_costo + 1;
    else v_total := v_total - v_mov.costo_total; end if;
    v_lineas := (select jsonb_agg(case when (x ->> 'n')::int = (v_l ->> 'n')::int
                                       then x || jsonb_build_object('mov', v_mov.id, 'cu', v_mov.costo_unitario, 'costo', -v_mov.costo_total)
                                       else x end order by (x ->> 'n')::int)
                   from jsonb_array_elements(v_lineas) x);
  end loop;

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

-- ---------------------------------------------------------------- lo que necesita la pantalla Producir
create or replace function public.datos_produccion(p_area public.area_app)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v jsonb;
begin
  if not privado.puede_operar(p_area) then
    raise exception 'Sin permiso para producir en %.', p_area using errcode = '42501';
  end if;

  select jsonb_build_object(
    'umbral_pp', privado.parametro_num('DESVIO_REND_AVISO_PP', 5),
    'mpis', coalesce((
      select jsonb_agg(jsonb_build_object(
               'producto_id', p.id, 'codigo', p.codigo, 'generico_id', g.id, 'generico', g.nombre, 'marca', p.marca,
               'presentacion', p.presentacion, 'unidad_base', g.unidad_base, 'costo_promedio', cp.costo_promedio,
               'factor_g', privado.a_base(g.id, 1, 'g'), 'densidad', privado.densidad_estimada(g.nombre),
               'ficha_id', privado.ficha_vigente(g.id), 'ficha_codigo', (select f.codigo from public.fichas f where f.id = privado.ficha_vigente(g.id)),
               'ultimo_lote', (select max(l.fecha) from public.lotes_produccion l where l.producto_id = p.id))
             order by g.nombre, p.marca)
        from public.productos p
        join public.genericos g on g.id = p.generico_id
        left join public.costos_producto cp on cp.producto_id = p.id
       where p.activo and g.activo and g.area = p_area and g.tipo = 'MPI'), '[]'),
    'fichas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'codigo', f.codigo, 'version', f.version, 'neto_esperado', f.neto_esperado, 'nota', f.nota,
               'alergenos', to_jsonb(f.alergenos), 'empaque', f.empaque, 'tiempo_min', f.tiempo_min,
               'puntos', coalesce((select jsonb_agg(jsonb_build_object('tipo', pc.tipo, 'texto', pc.texto) order by pc.orden)
                                     from public.ficha_puntos_criticos pc where pc.ficha_id = f.id), '[]'),
               'almacenamientos', coalesce((select jsonb_agg(jsonb_build_object('conservacion', fa.conservacion, 'vida_util_dias', fa.vida_util_dias, 'nota', fa.nota))
                                              from public.ficha_almacenamientos fa where fa.ficha_id = f.id), '[]'),
               'lineas', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'linea', l.linea, 'generico_id', g2.id, 'generico', g2.nombre, 'tipo', g2.tipo,
                          'unidad_base', g2.unidad_base, 'cantidad', l.cantidad, 'unidad', l.unidad, 'nota', l.nota,
                          'base', privado.a_base(g2.id, l.cantidad, l.unidad), 'factor', privado.a_base(g2.id, 1, l.unidad))
                        order by l.linea)
                   from public.ficha_lineas l join public.genericos g2 on g2.id = l.generico_id
                  where l.ficha_id = f.id), '[]')))
        from public.genericos g join public.fichas f on f.id = privado.ficha_vigente(g.id)
       where g.area = p_area and g.tipo = 'MPI' and g.activo), '[]'),
    'insumos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'producto_id', p.id, 'codigo', p.codigo, 'generico_id', g.id, 'generico', g.nombre, 'marca', p.marca,
               'presentacion', p.presentacion, 'tipo', g.tipo, 'unidad_base', g.unidad_base,
               'costo_promedio', cp.costo_promedio, 'factor_g', privado.a_base(g.id, 1, 'g'),
               'densidad', case when g.unidad_base = 'ml' then privado.densidad_estimada(g.nombre) end)
             order by g.nombre, p.marca, p.presentacion)
        from public.productos p
        join public.genericos g on g.id = p.generico_id
        left join public.costos_producto cp on cp.producto_id = p.id
       where p.activo and g.activo and g.area = p_area and g.tipo in ('MPe', 'MPI', 'SIN_COSTO')), '[]'),
    'saldos', coalesce((
      select jsonb_agg(jsonb_build_object('producto_id', e.producto_id, 'ubicacion', e.ubicacion, 'cantidad', e.cantidad))
        from public.existencias e join public.ubicaciones u on u.codigo = e.ubicacion
       where u.area = p_area and e.cantidad <> 0), '[]'),
    'responsables', coalesce((
      select jsonb_agg(jsonb_build_object('id', pe.id, 'nombre', pe.nombre, 'rol', pe.rol) order by pe.nombre)
        from public.perfiles pe
       where pe.activo and pe.rol in ('admin', 'jefe_bar', 'aux_bar', 'chef', 'sous_chef', 'aux_cocina')
         and (pe.rol = 'admin' or p_area = any (pe.areas))), '[]'))
  into v;
  return v;
end
$$;

-- ---------------------------------------------------------------- etiqueta: vence y almacenamiento del lote
create or replace function public.lote_etiqueta(p_codigo text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb; v_area public.area_app;
begin
  select l.area into v_area from public.lotes_produccion l where l.codigo = trim(p_codigo);
  if v_area is null then return null; end if;
  if not (privado.opera_en(v_area) or privado.tiene_rol('admin', 'auditor')) then
    raise exception 'Sin permiso para ver lotes de %.', v_area using errcode = '42501';
  end if;
  select jsonb_build_object(
           'id', l.id, 'codigo', l.codigo, 'area', l.area, 'fecha', l.fecha, 'producto_id', l.producto_id,
           'mpi', g.nombre, 'unidad', g.unidad_base, 'neto', l.neto_base, 'neto_g', l.neto_g, 'unidades', l.unidades,
           'vence', coalesce(l.vence, case when l.conservacion is null and g.vida_util_dias is not null then l.fecha + g.vida_util_dias end),
           'conservacion', coalesce(l.conservacion, g.conservacion),
           'nota_conservacion', (select fa.nota from public.ficha_almacenamientos fa where fa.ficha_id = l.ficha_id and fa.conservacion = l.conservacion),
           'empaque', (select f.empaque from public.fichas f where f.id = l.ficha_id),
           'zona', u.nombre, 'responsable', pe.nombre,
           'costo_unitario', case when privado.ve_costos() then l.costo_unitario end, 'estado_costo', l.estado_costo,
           'anulado', exists (select 1 from public.anulaciones an where an.documento_tipo = 'LOTE' and an.documento_id = l.id))
    into v
    from public.lotes_produccion l
    join public.productos p on p.id = l.producto_id
    join public.genericos g on g.id = p.generico_id
    join public.ubicaciones u on u.codigo = l.ubicacion
    join public.perfiles pe on pe.id = l.responsable_id
   where l.codigo = trim(p_codigo);
  return v;
end
$$;
