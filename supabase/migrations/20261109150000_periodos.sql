-- =====================================================================================
-- SGI Di Égida · Consulta bloque 2: real vs. teórico por período cerrado (09/11/2026)
-- Especificación de Anthony (06/11/2026):
--   CMV real     = inventario inicial + recepciones + traslados entrantes − traslados salientes − inventario final
--   CMV teórico  = Σ unidades vendidas en Odoo × costo de ficha del período
--   Pérdidas     = bajas, daños, mermas, cortesías, mal hechos (las bajas del kardex)
--   No explicado = CMV real − teórico − pérdidas      → teórico + pérdidas + no explicado = real, exacto
--   Semáforo de la variación real − teórico: verde ≤ 1 punto, amarillo ≤ 3, rojo > 3 (configurable).
--   El costo de ficha de cada período es una foto guardada al cerrar: un cierre no cambia si
--   después cambian los precios. La merma de proceso ya está dentro del costo de las MPI.
-- Decisiones (07/11): el jefe de bar hace el conteo de cierre; administración cierra el período.
--
-- Cómo se valora el inventario: con el kardex. El valor en libros de un área a una fecha es la
-- suma del valor de sus movimientos hasta esa fecha (fecha operativa). Así la identidad
-- inventario inicial + entradas − salidas = inventario final se cumple exacta.
-- Los traslados entre zonas de la misma área no cuentan (se anulan); solo los que cruzan de área.
-- El consumo real de cada insumo es lo que el conteo encontró de menos (ajustes de conteo).
-- =====================================================================================

insert into public.parametros (clave, valor, descripcion) values
  ('VAR_VERDE_PP', '1', 'Real vs. teórico: hasta estos puntos de diferencia el período queda en verde.'),
  ('VAR_AMARILLO_PP', '3', 'Real vs. teórico: hasta estos puntos queda en amarillo; más, en rojo.')
on conflict do nothing;

-- ---------------------------------------------------------------- tablas (nada se edita después del cierre)
create table if not exists public.periodos (
  id          uuid primary key default gen_random_uuid(),
  area        public.area_app not null,
  desde       date not null,
  hasta       date not null,
  resumen     jsonb not null,            -- las cifras del cierre, congeladas
  nota        text,
  forzado     boolean not null default false,
  motivo_forzado text,
  cerrado_por uuid default auth.uid(),
  cerrado_en  timestamptz not null default now(),
  check (hasta >= desde),
  unique (area, desde)
);

create table if not exists public.periodo_fichas (
  periodo_id    uuid not null references public.periodos (id),
  generico_id   uuid not null references public.genericos (id),
  ficha_id      uuid references public.fichas (id),
  ficha_version integer,
  unidades      numeric not null,
  costo         numeric,               -- costo de la ficha al cerrar (null: incompleta)
  precio        numeric,               -- precio de carta con impuesto al cerrar
  completa      boolean not null,
  lineas        jsonb not null,        -- [{generico_id, nombre, cantidad_base, costo_unitario, costo}]
  primary key (periodo_id, generico_id)
);

create table if not exists public.periodo_insumos (
  periodo_id     uuid not null references public.periodos (id),
  generico_id    uuid not null references public.genericos (id),
  nombre         text not null,
  unidad_base    text not null,
  teorico_q      numeric not null,
  real_q         numeric not null,
  teorico_valor  numeric not null,
  real_valor     numeric not null,
  dif_valor      numeric not null,
  primary key (periodo_id, generico_id)
);

do $$
declare v_t text;
begin
  foreach v_t in array array['periodos', 'periodo_fichas', 'periodo_insumos'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function privado.bloquear_cambios()', v_t || '_inmutables', v_t);
    execute format('alter table public.%I enable row level security', v_t);
    execute format('create policy %I on public.%I for select to authenticated using (privado.ve_precios())', v_t || '_leer', v_t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', v_t);
  end loop;
end
$$;

-- ---------------------------------------------------------------- semáforo de la variación
create or replace function privado.semaforo_variacion(p_pp numeric)
returns text
language sql stable security definer set search_path = ''
as $$
  select case when p_pp is null then null
              when p_pp <= privado.parametro_num('VAR_VERDE_PP', 1) then 'VERDE'
              when p_pp <= privado.parametro_num('VAR_AMARILLO_PP', 3) then 'AMARILLO'
              else 'ROJO' end
$$;

-- ---------------------------------------------------------------- cálculo de un período (en vivo)
-- Devuelve {resumen, fichas, insumos}. Con los costos de hoy: al cerrar se guarda tal cual.
create or replace function privado.periodo_calcular(p_area public.area_app, p_desde date, p_hasta date)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with ub as (select codigo from public.ubicaciones where area = p_area),
  m as (
    select mv.id, mv.fecha, mv.producto_id, mv.cantidad, coalesce(mv.costo_total, 0) as valor,
           coalesce(o.tipo, mv.tipo) as tipo_ef, coalesce(o.documento_id, mv.documento_id) as doc
      from public.movimientos mv left join public.movimientos o on o.id = mv.reversa_de
     where mv.ubicacion in (select codigo from ub) and mv.fecha <= p_hasta),
  per as (select * from m where fecha >= p_desde),
  tr as (
    select per.*, case when per.tipo_ef = 'TRASLADO_ENTRADA' then uo.area else ud.area end as otra_area
      from per join public.traslados t on t.id = per.doc
      join public.ubicaciones uo on uo.codigo = t.origen join public.ubicaciones ud on ud.codigo = t.destino
     where per.tipo_ef in ('TRASLADO_ENTRADA', 'TRASLADO_SALIDA')),
  r as (
    select
      coalesce((select sum(valor) from m where fecha < p_desde), 0)
        + coalesce((select sum(valor) from per where tipo_ef = 'SALDO_INICIAL'), 0)                          as inv_inicial,
      coalesce((select sum(valor) from per where tipo_ef in ('ENTRADA_COMPRA', 'DEVOLUCION_PROVEEDOR')), 0) as compras,
      coalesce((select sum(valor) from tr where tipo_ef = 'TRASLADO_ENTRADA' and otra_area <> p_area), 0) as traslados_entrada,
      coalesce((select -sum(valor) from tr where tipo_ef = 'TRASLADO_SALIDA' and otra_area <> p_area), 0) as traslados_salida,
      coalesce((select sum(valor) from m), 0)                                                              as inv_final),
  perd as (
    select coalesce(b.causa, 'OTRO') as causa, -sum(per.valor) as valor
      from per left join public.bajas b on b.id = per.doc
     where per.tipo_ef = 'SALIDA_BAJA' group by 1),
  -- teórico: lo vendido en Odoo × costo de la ficha
  v as (select vp.* from privado.ventas_periodo(p_desde, p_hasta) vp join public.genericos g on g.id = vp.generico_id and g.area = p_area),
  f as (
    select v.generico_id, v.unidades, v.valor_neto, fi.id as ficha_id, fi.version,
           (select x.precio_con_impuesto from public.precios_venta x where x.generico_id = v.generico_id and x.vigente_desde <= p_hasta
             order by x.vigente_desde desc limit 1) as precio,
           c.lineas, c.costo, c.completa
      from v
      left join public.fichas fi on fi.id = privado.ficha_vigente(v.generico_id)
      left join lateral (
        select coalesce(jsonb_agg(jsonb_build_object('generico_id', cf.generico_id, 'nombre', cf.generico, 'cantidad_base', cf.cantidad_base,
                                                     'costo_unitario', cf.costo_unitario, 'costo', cf.costo) order by cf.linea), '[]') as lineas,
               sum(cf.costo) as costo, count(*) > 0 and count(*) = count(*) filter (where cf.falta is null) as completa
          from privado.costo_ficha_completo(fi.id) cf) c on true),
  teo as (select coalesce(sum(unidades * costo) filter (where completa), 0) as cmv,
                 coalesce(sum(valor_neto), 0) as ventas, coalesce(sum(valor_neto) filter (where completa), 0) as ventas_completas from f),
  -- detalle por insumo: teórico de las fichas contra lo que el conteo encontró de menos
  ins_teo as (
    select (l ->> 'generico_id')::uuid as generico_id, sum(f.unidades * (l ->> 'cantidad_base')::numeric) as q,
           sum(f.unidades * coalesce((l ->> 'costo')::numeric, 0)) as valor
      from f cross join lateral jsonb_array_elements(f.lineas) l
     where f.completa group by 1),
  ins_real as (
    select p.generico_id, -sum(per.cantidad) as q, -sum(per.valor) as valor
      from per join public.productos p on p.id = per.producto_id
     where per.tipo_ef in ('AJUSTE_CONTEO_NEGATIVO', 'AJUSTE_CONTEO_POSITIVO', 'SALIDA_VENTA') group by 1),
  ins as (
    select g.id as generico_id, g.nombre, g.unidad_base::text as unidad_base,
           round(coalesce(t.q, 0), 2) as teorico_q, round(coalesce(rr.q, 0), 2) as real_q,
           round(coalesce(t.valor, 0)) as teorico_valor, round(coalesce(rr.valor, 0)) as real_valor,
           round(coalesce(rr.valor, 0) - coalesce(t.valor, 0)) as dif_valor
      from (select generico_id from ins_teo union select generico_id from ins_real) k
      join public.genericos g on g.id = k.generico_id
      left join ins_teo t on t.generico_id = k.generico_id left join ins_real rr on rr.generico_id = k.generico_id
     where g.tipo <> 'SIN_COSTO'),
  tot as (
    select r.*, r.inv_inicial + r.compras + r.traslados_entrada - r.traslados_salida - r.inv_final as cmv_real,
           teo.cmv as cmv_teorico, teo.ventas, teo.ventas_completas,
           coalesce((select sum(valor) from perd), 0) as perdidas
      from r, teo)
  select jsonb_build_object(
    'resumen', jsonb_build_object(
      'area', p_area, 'desde', p_desde, 'hasta', p_hasta,
      'ventas_netas', round(t.ventas), 'ventas_con_ficha', round(t.ventas_completas),
      'inv_inicial', round(t.inv_inicial), 'compras', round(t.compras),
      'traslados_entrada', round(t.traslados_entrada), 'traslados_salida', round(t.traslados_salida),
      'inv_final', round(t.inv_final),
      'cmv_real', round(t.cmv_real), 'cmv_teorico', round(t.cmv_teorico), 'perdidas', round(t.perdidas),
      'no_explicado', round(t.cmv_real) - round(t.cmv_teorico) - round(t.perdidas),
      'perdidas_por_causa', coalesce((select jsonb_object_agg(causa, round(valor)) from perd), '{}'),
      'pct_teorico', case when t.ventas > 0 then round(t.cmv_teorico / t.ventas * 100, 1) end,
      'pct_real', case when t.ventas > 0 then round(t.cmv_real / t.ventas * 100, 1) end,
      'variacion_pp', case when t.ventas > 0 then round((t.cmv_real - t.cmv_teorico) / t.ventas * 100, 1) end,
      'semaforo', privado.semaforo_variacion(case when t.ventas > 0 then round((t.cmv_real - t.cmv_teorico) / t.ventas * 100, 1) end),
      'fichas_incompletas', (select count(*) from f where not coalesce(completa, false))),
    'fichas', coalesce((select jsonb_agg(jsonb_build_object('generico_id', generico_id, 'ficha_id', ficha_id, 'ficha_version', version,
                         'unidades', unidades, 'costo', costo, 'precio', precio, 'completa', coalesce(completa, false), 'lineas', coalesce(lineas, '[]'::jsonb))) from f), '[]'),
    'insumos', coalesce((select jsonb_agg(to_jsonb(ins) order by abs(dif_valor) desc, nombre) from ins), '[]'))
    from tot t
$$;

-- ---------------------------------------------------------------- cerrar un período
-- p: {area, desde, hasta, nota, forzar, motivo}
create or replace function public.cerrar_periodo(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_area public.area_app := (p ->> 'area')::public.area_app; v_desde date := (p ->> 'desde')::date; v_hasta date := (p ->> 'hasta')::date;
  v_ultimo date; v_faltan text[]; v_forzar boolean := coalesce((p ->> 'forzar')::boolean, false); v_calc jsonb; v_id uuid;
begin
  if not privado.ve_precios() then
    raise exception 'Sin permiso: los períodos los cierra administración.' using errcode = '42501';
  end if;
  if v_area is null or v_desde is null or v_hasta is null or v_hasta < v_desde then
    return jsonb_build_object('ok', false, 'error', 'Falta el área o las fechas del período.');
  end if;
  if v_hasta > privado.hoy() then
    return jsonb_build_object('ok', false, 'error', 'Un período se cierra cuando termina: la fecha final no puede ser futura.');
  end if;
  select max(hasta) into v_ultimo from public.periodos where area = v_area;
  if v_ultimo is not null and v_desde <> v_ultimo + 1 then
    return jsonb_build_object('ok', false, 'error',
      format('El período debe empezar el %s, el día siguiente al último cierre.', to_char(v_ultimo + 1, 'DD/MM/YYYY')));
  end if;
  -- zonas con existencias sin conteo en la fecha de cierre (± 1 día)
  select array_agg(u.nombre order by u.nombre) into v_faltan
    from public.ubicaciones u
   where u.area = v_area and u.activo
     and exists (select 1 from public.existencias e where e.ubicacion = u.codigo and e.cantidad <> 0)
     and not exists (select 1 from public.conteos c where c.ubicacion = u.codigo and c.fecha between v_hasta - 1 and v_hasta + 1);
  if v_faltan is not null and not v_forzar then
    return jsonb_build_object('ok', false, 'error', 'Faltan zonas por contar en la fecha de cierre.', 'faltan', to_jsonb(v_faltan));
  end if;
  if v_forzar and v_faltan is not null and nullif(trim(coalesce(p ->> 'motivo', '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'Para cerrar sin el conteo completo escribe el motivo.', 'faltan', to_jsonb(v_faltan));
  end if;

  v_calc := privado.periodo_calcular(v_area, v_desde, v_hasta);
  insert into public.periodos (area, desde, hasta, resumen, nota, forzado, motivo_forzado)
  values (v_area, v_desde, v_hasta, v_calc -> 'resumen', p ->> 'nota', v_faltan is not null, case when v_faltan is not null then p ->> 'motivo' end)
  returning id into v_id;
  insert into public.periodo_fichas (periodo_id, generico_id, ficha_id, ficha_version, unidades, costo, precio, completa, lineas)
  select v_id, (x ->> 'generico_id')::uuid, (x ->> 'ficha_id')::uuid, (x ->> 'ficha_version')::int, (x ->> 'unidades')::numeric,
         (x ->> 'costo')::numeric, (x ->> 'precio')::numeric, (x ->> 'completa')::boolean, x -> 'lineas'
    from jsonb_array_elements(v_calc -> 'fichas') x;
  insert into public.periodo_insumos (periodo_id, generico_id, nombre, unidad_base, teorico_q, real_q, teorico_valor, real_valor, dif_valor)
  select v_id, (x ->> 'generico_id')::uuid, x ->> 'nombre', x ->> 'unidad_base', (x ->> 'teorico_q')::numeric, (x ->> 'real_q')::numeric,
         (x ->> 'teorico_valor')::numeric, (x ->> 'real_valor')::numeric, (x ->> 'dif_valor')::numeric
    from jsonb_array_elements(v_calc -> 'insumos') x;
  perform privado.bitacora('PERÍODO CERRADO', 'periodos', format('%s %s → %s', v_area, v_desde, v_hasta),
                           v_calc -> 'resumen', case when v_faltan is not null then p ->> 'motivo' end);
  return jsonb_build_object('ok', true, 'id', v_id, 'resumen', v_calc -> 'resumen');
end
$$;

-- ---------------------------------------------------------------- lo que lee Consulta
-- Períodos cerrados del área (o de las dos), el abierto en vivo y el detalle de uno.
create or replace function public.consulta_periodos(p_area public.area_app default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_abiertos jsonb := '[]'; v_a public.area_app; v_desde date;
begin
  if not privado.ve_precios() then
    raise exception 'Sin permiso: Consulta es de administración.' using errcode = '42501';
  end if;
  foreach v_a in array case when p_area is null then array['BAR', 'COCINA']::public.area_app[] else array[p_area] end loop
    select max(hasta) + 1 into v_desde from public.periodos where area = v_a;
    if v_desde is null then
      select min(fecha) into v_desde from public.movimientos mv join public.ubicaciones u on u.codigo = mv.ubicacion where u.area = v_a;
    end if;
    if v_desde is not null and v_desde <= privado.hoy() then
      v_abiertos := v_abiertos || jsonb_build_array(privado.periodo_calcular(v_a, v_desde, privado.hoy()) -> 'resumen');
    end if;
  end loop;
  return jsonb_build_object(
    'cerrados', coalesce((select jsonb_agg(p.resumen || jsonb_build_object('id', p.id, 'cerrado_en', p.cerrado_en, 'forzado', p.forzado,
                                                                          'nota', p.nota) order by p.hasta desc)
                            from public.periodos p where p_area is null or p.area = p_area), '[]'),
    'abiertos', v_abiertos);
end
$$;

create or replace function public.periodo_detalle(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.ve_precios() then
    raise exception 'Sin permiso: Consulta es de administración.' using errcode = '42501';
  end if;
  return (select p.resumen || jsonb_build_object('id', p.id, 'cerrado_en', p.cerrado_en, 'forzado', p.forzado, 'motivo_forzado', p.motivo_forzado,
            'insumos', coalesce((select jsonb_agg(to_jsonb(i) - 'periodo_id' order by abs(i.dif_valor) desc, i.nombre) from public.periodo_insumos i where i.periodo_id = p.id), '[]'))
            from public.periodos p where p.id = p_id);
end
$$;

-- detalle del período abierto (en vivo), con el mismo formato
create or replace function public.periodo_vivo(p_area public.area_app, p_desde date, p_hasta date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  if not privado.ve_precios() then
    raise exception 'Sin permiso: Consulta es de administración.' using errcode = '42501';
  end if;
  v := privado.periodo_calcular(p_area, p_desde, p_hasta);
  return (v -> 'resumen') || jsonb_build_object('insumos', v -> 'insumos');
end
$$;

revoke execute on function public.cerrar_periodo(jsonb), public.consulta_periodos(public.area_app), public.periodo_detalle(uuid),
                           public.periodo_vivo(public.area_app, date, date) from public, anon;
grant execute on function public.cerrar_periodo(jsonb), public.consulta_periodos(public.area_app), public.periodo_detalle(uuid),
                          public.periodo_vivo(public.area_app, date, date) to authenticated;
