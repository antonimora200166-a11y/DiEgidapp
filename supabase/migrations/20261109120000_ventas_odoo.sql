-- =====================================================================================
-- SGI Di Égida · Ventas de Odoo y Consulta (bloques 0 y 1) · 08/11/2026
-- Decisiones de Anthony (06–07/11/2026):
--   · Cada lunes sube el reporte de ventas de Odoo y la app lo lee sola. La app no escribe en Odoo.
--   · Formato semanal: la tabla dinámica «Análisis del TPV» (productos × días). Una vez, el PDF
--     «Detalles de ventas» del 01/01 al 06/11/2026 como histórico (sin día por línea).
--   · Lo vendido se empareja con la carta por el código de Odoo o, si no trae, por el nombre. Lo
--     que no tiene equivalencia se reporta aparte.
--   · Menús Yuga = combos fijos: cuentan en el teórico como la suma de sus platos y bebidas, con
--     venta $0. Platos «gs»: no se tienen en cuenta. Propinas: no son venta.
--   · Todo esto lo ve y lo maneja solo administración.
-- El costo es el de la ficha vigente (costo de hoy) hasta que existan los cierres de período, que
-- congelan el costo de cada ficha (bloque 2).
-- =====================================================================================

-- ---------------------------------------------------------------- tablas
create table if not exists public.ventas_cargas (
  id            uuid primary key default gen_random_uuid(),
  formato       text not null check (formato in ('TABLA_DINAMICA', 'DETALLE_PDF')),
  archivo       text,
  huella        text not null unique,              -- sha-256 del archivo: no se carga dos veces
  desde         date not null,
  hasta         date not null,
  por_dia       boolean not null,                  -- false: el PDF trae el total del rango, sin día
  lineas        integer not null,
  unidades      numeric not null,
  total_odoo    numeric not null,                  -- total que trae el reporte (para el cuadre)
  neto_estimado boolean not null default false,    -- true: el reporte traía el precio con impuesto
  cargado_por   uuid default auth.uid(),
  cargado_en    timestamptz not null default now(),
  nota          text,
  check (hasta >= desde)
);

create table if not exists public.ventas_lineas (
  id           bigint generated always as identity primary key,
  carga_id     uuid not null references public.ventas_cargas (id),
  fecha        date,                               -- null: todo el rango de la carga (PDF)
  categoria    text,
  codigo_odoo  text,
  nombre_odoo  text not null,
  clave        text not null,                      -- código de Odoo o «N:» + nombre normalizado
  cantidad     numeric not null,
  valor_neto   numeric not null                    -- sin impuesto
);
create index if not exists ventas_lineas_clave_idx on public.ventas_lineas (clave);
create index if not exists ventas_lineas_carga_idx on public.ventas_lineas (carga_id, fecha);

create table if not exists public.equivalencias_odoo (
  clave        text primary key,
  nombre_odoo  text not null,
  tipo         text not null check (tipo in ('PRODUCTO', 'COMBO', 'PROPINA', 'PROMOCION', 'IGNORAR')),
  nota         text,
  decidido_por uuid default auth.uid(),
  decidido_en  timestamptz not null default now()
);

create table if not exists public.equivalencia_partes (
  clave        text not null references public.equivalencias_odoo (clave) on delete cascade,
  generico_id  uuid not null references public.genericos (id),
  cantidad     numeric not null default 1 check (cantidad > 0),
  primary key (clave, generico_id)
);

-- Las ventas cargadas no se editan ni se borran.
create trigger ventas_cargas_inmutables before update or delete on public.ventas_cargas
  for each row execute function privado.bloquear_cambios();
create trigger ventas_lineas_inmutables before update or delete on public.ventas_lineas
  for each row execute function privado.bloquear_cambios();

alter table public.ventas_cargas enable row level security;
alter table public.ventas_lineas enable row level security;
alter table public.equivalencias_odoo enable row level security;
alter table public.equivalencia_partes enable row level security;
create policy ventas_cargas_leer on public.ventas_cargas for select to authenticated using (privado.ve_precios());
create policy ventas_lineas_leer on public.ventas_lineas for select to authenticated using (privado.ve_precios());
create policy equivalencias_leer on public.equivalencias_odoo for select to authenticated using (privado.ve_precios());
create policy equivalencia_partes_leer on public.equivalencia_partes for select to authenticated using (privado.ve_precios());
revoke insert, update, delete on public.ventas_cargas, public.ventas_lineas, public.equivalencias_odoo, public.equivalencia_partes
  from authenticated, anon;

create or replace function privado.clave_odoo(p_codigo text, p_nombre text)
returns text
language sql immutable
as $$
  select coalesce(nullif(trim(p_codigo), ''), 'N:' || privado.normalizar(p_nombre))
$$;

-- ---------------------------------------------------------------- cargar un reporte
-- p: {formato, archivo, huella, desde, hasta, por_dia, total_odoo, neto_estimado, nota,
--     lineas: [{fecha, categoria, codigo, nombre, cantidad, valor_neto}]}
-- · La suma de las líneas debe dar el total que trae Odoo (±1 peso por redondeo).
-- · Los días que ya están en otra carga se omiten (y se dice cuáles): no se cuenta dos veces.
create or replace function public.cargar_ventas(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid; v_desde date := (p ->> 'desde')::date; v_hasta date := (p ->> 'hasta')::date;
  v_por_dia boolean := coalesce((p ->> 'por_dia')::boolean, false);
  v_suma numeric; v_total numeric := (p ->> 'total_odoo')::numeric; v_omitidos date[]; v_n int; v_und numeric;
begin
  if not privado.ve_precios() then
    raise exception 'Sin permiso: las ventas las carga administración.' using errcode = '42501';
  end if;
  if v_desde is null or v_hasta is null or v_hasta < v_desde then
    return jsonb_build_object('ok', false, 'error', 'El reporte no trae un rango de fechas válido.');
  end if;
  if exists (select 1 from public.ventas_cargas c where c.huella = p ->> 'huella') then
    return jsonb_build_object('ok', false, 'error', 'Este mismo archivo ya se cargó.');
  end if;
  if jsonb_array_length(coalesce(p -> 'lineas', '[]')) = 0 then
    return jsonb_build_object('ok', false, 'error', 'El reporte no trae líneas de venta.');
  end if;
  select coalesce(sum((l ->> 'valor_neto')::numeric), 0) into v_suma from jsonb_array_elements(p -> 'lineas') l;
  if v_total is not null and not coalesce((p ->> 'neto_estimado')::boolean, false) and abs(v_suma - v_total) > 1 then
    return jsonb_build_object('ok', false, 'error',
      format('Las líneas suman %s y el total del reporte es %s: el archivo no se leyó completo.', round(v_suma), round(v_total)));
  end if;
  if not v_por_dia and exists (select 1 from public.ventas_cargas c where c.desde <= v_hasta and c.hasta >= v_desde) then
    return jsonb_build_object('ok', false, 'error', 'Ya hay ventas cargadas en esas fechas.');
  end if;

  -- días ya cubiertos por otra carga
  select array_agg(distinct d order by d) into v_omitidos
    from (select (l ->> 'fecha')::date d from jsonb_array_elements(p -> 'lineas') l) x
   where exists (select 1 from public.ventas_cargas c where x.d between c.desde and c.hasta);

  select count(*), coalesce(sum((l ->> 'cantidad')::numeric), 0) into v_n, v_und
    from jsonb_array_elements(p -> 'lineas') l
   where not (v_por_dia and (l ->> 'fecha')::date = any (coalesce(v_omitidos, '{}')));
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'Todos los días del reporte ya estaban cargados.', 'omitidos', to_jsonb(v_omitidos));
  end if;

  insert into public.ventas_cargas (formato, archivo, huella, desde, hasta, por_dia, lineas, unidades, total_odoo, neto_estimado, nota)
  values (p ->> 'formato', p ->> 'archivo', p ->> 'huella', v_desde, v_hasta, v_por_dia, v_n, v_und, coalesce(v_total, v_suma),
          coalesce((p ->> 'neto_estimado')::boolean, false), p ->> 'nota')
  returning id into v_id;

  insert into public.ventas_lineas (carga_id, fecha, categoria, codigo_odoo, nombre_odoo, clave, cantidad, valor_neto)
  select v_id, case when v_por_dia then (l ->> 'fecha')::date end, l ->> 'categoria', nullif(l ->> 'codigo', ''), l ->> 'nombre',
         privado.clave_odoo(l ->> 'codigo', l ->> 'nombre'), (l ->> 'cantidad')::numeric, (l ->> 'valor_neto')::numeric
    from jsonb_array_elements(p -> 'lineas') l
   where not (v_por_dia and (l ->> 'fecha')::date = any (coalesce(v_omitidos, '{}')));

  perform privado.bitacora('VENTAS CARGADAS', 'ventas_cargas', coalesce(p ->> 'archivo', v_id::text),
                           jsonb_build_object('desde', v_desde, 'hasta', v_hasta, 'lineas', v_n, 'omitidos', v_omitidos));
  return jsonb_build_object('ok', true, 'carga_id', v_id, 'lineas', v_n, 'omitidos', coalesce(to_jsonb(v_omitidos), '[]'::jsonb),
    'sin_equivalencia', (select count(distinct l.clave) from public.ventas_lineas l
                          where l.carga_id = v_id and not exists (select 1 from public.equivalencias_odoo e where e.clave = l.clave)));
end
$$;

-- ---------------------------------------------------------------- equivalencias
create or replace function public.ventas_sin_equivalencia()
returns table (clave text, codigo_odoo text, nombre_odoo text, categoria text, unidades numeric, valor_neto numeric,
               sugerido_id uuid, sugerido text, sugerido_codigo text, parecido numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.ve_precios() then
    raise exception 'Sin permiso: las ventas las ve administración.' using errcode = '42501';
  end if;
  return query
  with p as (
    select l.clave, max(l.codigo_odoo) as codigo_odoo, max(l.nombre_odoo) as nombre_odoo, max(l.categoria) as categoria,
           sum(l.cantidad) as unidades, sum(l.valor_neto) as valor_neto
      from public.ventas_lineas l
     where not exists (select 1 from public.equivalencias_odoo e where e.clave = l.clave)
     group by l.clave)
  select p.clave, p.codigo_odoo, p.nombre_odoo, p.categoria, p.unidades, round(p.valor_neto),
         s.id, s.nombre, s.codigo, round(s.sim::numeric, 2)
    from p
    left join lateral (
      select g.id, g.nombre, g.codigo, extensions.similarity(g.nombre_norm, privado.normalizar(p.nombre_odoo)) as sim
        from public.genericos g
       where g.activo and g.tipo in ('BEBIDA', 'PLATO')
       order by sim desc limit 1) s on s.sim >= 0.3
   order by p.valor_neto desc;
end
$$;

-- p: {clave, nombre_odoo, tipo, nota, partes: [{generico_id, cantidad}]}
create or replace function public.fijar_equivalencia(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_tipo text := p ->> 'tipo'; v_clave text := p ->> 'clave'; v_n int;
begin
  if not privado.ve_precios() then
    raise exception 'Sin permiso: las equivalencias las decide administración.' using errcode = '42501';
  end if;
  if v_clave is null or v_tipo not in ('PRODUCTO', 'COMBO', 'PROPINA', 'PROMOCION', 'IGNORAR') then
    return jsonb_build_object('ok', false, 'error', 'Falta el producto de Odoo o el tipo de equivalencia.');
  end if;
  v_n := jsonb_array_length(coalesce(p -> 'partes', '[]'));
  if v_tipo = 'PRODUCTO' and v_n <> 1 or v_tipo = 'COMBO' and v_n < 1 then
    return jsonb_build_object('ok', false, 'error', 'Un producto lleva un producto de la carta; un combo, uno o más.');
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p -> 'partes', '[]')) x
              left join public.genericos g on g.id = (x ->> 'generico_id')::uuid
             where g.id is null or g.tipo not in ('BEBIDA', 'PLATO')) then
    return jsonb_build_object('ok', false, 'error', 'Las partes deben ser productos de la carta.');
  end if;
  insert into public.equivalencias_odoo (clave, nombre_odoo, tipo, nota)
  values (v_clave, coalesce(p ->> 'nombre_odoo', v_clave), v_tipo, p ->> 'nota')
  on conflict (clave) do update set tipo = excluded.tipo, nota = excluded.nota, nombre_odoo = excluded.nombre_odoo,
                                    decidido_por = auth.uid(), decidido_en = now();
  delete from public.equivalencia_partes where clave = v_clave;
  insert into public.equivalencia_partes (clave, generico_id, cantidad)
  select v_clave, (x ->> 'generico_id')::uuid, coalesce((x ->> 'cantidad')::numeric, 1)
    from jsonb_array_elements(coalesce(p -> 'partes', '[]')) x;
  perform privado.bitacora('EQUIVALENCIA ODOO', 'equivalencias_odoo', coalesce(p ->> 'nombre_odoo', v_clave),
                           jsonb_build_object('tipo', v_tipo, 'partes', p -> 'partes'));
  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------- ventas de un período por producto de carta
-- Las líneas sin día (PDF) entran solo si el rango de su carga cabe entero en el período.
-- Un combo reparte sus unidades en sus partes; su valor (casi siempre $0) se reparte en
-- proporción al precio de carta de cada parte.
create or replace function privado.ventas_periodo(p_desde date, p_hasta date)
returns table (generico_id uuid, unidades numeric, unidades_sin_valor numeric, valor_neto numeric)
language sql stable security definer set search_path = ''
as $$
  with l as (
    select vl.* from public.ventas_lineas vl join public.ventas_cargas c on c.id = vl.carga_id
     where (vl.fecha is not null and vl.fecha between p_desde and p_hasta)
        or (vl.fecha is null and c.desde >= p_desde and c.hasta <= p_hasta)),
  partes as (
    select e.clave, e.tipo, ep.generico_id, ep.cantidad,
           coalesce((select v.precio_con_impuesto from public.precios_venta v where v.generico_id = ep.generico_id
                      order by v.vigente_desde desc limit 1), 1) * ep.cantidad as peso
      from public.equivalencias_odoo e join public.equivalencia_partes ep on ep.clave = e.clave
     where e.tipo in ('PRODUCTO', 'COMBO')),
  repartido as (
    select pt.generico_id, l.cantidad * pt.cantidad as und,
           case when l.valor_neto = 0 then l.cantidad * pt.cantidad else 0 end as und0,
           l.valor_neto * pt.peso / sum(pt.peso) over (partition by l.id) as valor
      from l join partes pt on pt.clave = l.clave)
  select generico_id, sum(und), sum(und0), sum(valor) from repartido group by generico_id
$$;

-- ---------------------------------------------------------------- Consulta: bloques 0 y 1
create or replace function privado.consulta_ventas_calculo(p_desde date, p_hasta date, p_area public.area_app)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with v as (select * from privado.ventas_periodo(p_desde, p_hasta)),
  l as (
    select vl.*, e.tipo from public.ventas_lineas vl join public.ventas_cargas c on c.id = vl.carga_id
      left join public.equivalencias_odoo e on e.clave = vl.clave
     where (vl.fecha is not null and vl.fecha between p_desde and p_hasta)
        or (vl.fecha is null and c.desde >= p_desde and c.hasta <= p_hasta)),
  prod as (
    select g.id, g.codigo, g.nombre, g.area, privado.seccion_carta(g.seccion_carta, g.nota) as seccion,
           v.unidades, v.unidades_sin_valor, v.valor_neto, c.costo, c.lineas, c.con_costo, pv.precio,
           pv.precio / (1 + privado.parametro_num('IMPOCONSUMO_PCT', 8) / 100) as neto_carta,
           m.meta_pct, m.banda_pp
      from v join public.genericos g on g.id = v.generico_id
      left join lateral (
        select sum(cf.costo) as costo, count(*) as lineas, count(*) filter (where cf.falta is null) as con_costo
          from privado.costo_ficha_completo(privado.ficha_vigente(g.id)) cf) c on true
      left join lateral (select x.precio_con_impuesto as precio from public.precios_venta x
                          where x.generico_id = g.id and x.vigente_desde <= privado.hoy() order by x.vigente_desde desc limit 1) pv on true
      cross join lateral privado.meta_costo(g.area, privado.seccion_carta(g.seccion_carta, g.nota)) m
     where p_area is null or g.area = p_area),
  p2 as (
    select prod.*, coalesce(lineas, 0) > 0 and lineas = con_costo as completa,
           case when coalesce(lineas, 0) > 0 and lineas = con_costo then costo * unidades end as costo_total,
           case when coalesce(lineas, 0) > 0 and lineas = con_costo and neto_carta > 0 then costo / neto_carta * 100 end as pct_carta,
           case when coalesce(lineas, 0) > 0 and lineas = con_costo then neto_carta - costo end as margen_unit
      from prod),
  tot as (
    select coalesce(sum(valor_neto), 0) as ventas, coalesce(sum(valor_neto) filter (where completa), 0) as ventas_completas,
           coalesce(sum(costo_total), 0) as costo_teorico, coalesce(sum(valor_neto) filter (where completa), 0) as base_teorico,
           coalesce(sum(unidades), 0) as unidades
      from p2),
  sin_eq as (
    select count(distinct clave) as productos, coalesce(sum(valor_neto), 0) as valor, coalesce(sum(cantidad), 0) as unidades
      from l where l.tipo is null and p_area is null),
  otros as (
    select coalesce(sum(valor_neto) filter (where tipo = 'PROPINA'), 0) as propinas,
           coalesce(sum(valor_neto) filter (where tipo = 'PROMOCION'), 0) as promociones,
           coalesce(sum(valor_neto) filter (where tipo = 'IGNORAR'), 0) as ignorado
      from l),
  sec as (
    select seccion, area, count(*) as productos, round(avg(pct_carta), 1) as pct_carta,
           case when sum(valor_neto) filter (where completa) > 0
                then round(sum(costo_total) / sum(valor_neto) filter (where completa) * 100, 1) end as pct_teorico,
           max(meta_pct) as meta_pct, round(sum(valor_neto)) as ventas, round(sum(unidades)) as unidades,
           round(sum(valor_neto) filter (where completa) - sum(costo_total)) as margen
      from p2 group by seccion, area)
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta, 'area', p_area,
    'ventas_netas', round(t.ventas), 'unidades', t.unidades,
    'costo_teorico', round(t.costo_teorico),
    'pct_teorico', case when t.base_teorico > 0 then round(t.costo_teorico / t.base_teorico * 100, 1) end,
    'cobertura_pct', case when t.ventas + s.valor > 0 then round(t.ventas_completas / (t.ventas + s.valor) * 100, 1) end,
    'sin_equivalencia', jsonb_build_object('productos', s.productos, 'valor', round(s.valor), 'unidades', s.unidades),
    'propinas', round(o.propinas), 'promociones', round(o.promociones), 'ignorado', round(o.ignorado),
    'secciones', coalesce((select jsonb_agg(to_jsonb(sec) order by sec.area, sec.ventas desc nulls last) from sec), '[]'),
    'productos', coalesce((select jsonb_agg(jsonb_build_object(
        'generico_id', id, 'codigo', codigo, 'nombre', nombre, 'area', area, 'seccion', seccion,
        'unidades', unidades, 'unidades_sin_valor', unidades_sin_valor, 'valor_neto', round(valor_neto),
        'completa', completa, 'costo_unit', round(costo), 'costo_total', round(costo_total),
        'precio', precio, 'neto_carta', round(neto_carta), 'pct_carta', round(pct_carta, 1),
        'margen_unit', round(margen_unit), 'meta_pct', meta_pct, 'banda_pp', banda_pp) order by valor_neto desc) from p2), '[]'))
    from tot t, sin_eq s, otros o
$$;

create or replace function public.consulta_ventas(p_desde date, p_hasta date, p_area public.area_app default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_dias int := p_hasta - p_desde + 1; v_ant jsonb; v_act jsonb;
begin
  if not privado.ve_precios() then
    raise exception 'Sin permiso: Consulta es de administración.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Período no válido.';
  end if;
  v_act := privado.consulta_ventas_calculo(p_desde, p_hasta, p_area);
  v_ant := privado.consulta_ventas_calculo(p_desde - v_dias, p_desde - 1, p_area);
  return v_act || jsonb_build_object(
    'anterior', jsonb_build_object('desde', p_desde - v_dias, 'hasta', p_desde - 1,
                                   'ventas_netas', v_ant -> 'ventas_netas', 'pct_teorico', v_ant -> 'pct_teorico',
                                   'cobertura_pct', v_ant -> 'cobertura_pct'),
    'cargas', coalesce((select jsonb_agg(jsonb_build_object('desde', c.desde, 'hasta', c.hasta, 'formato', c.formato, 'por_dia', c.por_dia,
                                                            'archivo', c.archivo, 'cargado_en', c.cargado_en) order by c.desde)
                          from public.ventas_cargas c), '[]'),
    'meses', coalesce((
      select jsonb_agg(jsonb_build_object('mes', m.mes, 'ventas', m.ventas) order by m.mes)
        from (select to_char(date_trunc('month', vl.fecha), 'YYYY-MM') as mes, round(sum(vl.valor_neto)) as ventas
                from public.ventas_lineas vl join public.equivalencias_odoo e on e.clave = vl.clave and e.tipo in ('PRODUCTO', 'COMBO')
               where vl.fecha is not null group by 1) m), '[]'));
end
$$;

revoke execute on function public.cargar_ventas(jsonb), public.ventas_sin_equivalencia(), public.fijar_equivalencia(jsonb),
                           public.consulta_ventas(date, date, public.area_app) from public, anon;
grant execute on function public.cargar_ventas(jsonb), public.ventas_sin_equivalencia(), public.fijar_equivalencia(jsonb),
                          public.consulta_ventas(date, date, public.area_app) to authenticated;
