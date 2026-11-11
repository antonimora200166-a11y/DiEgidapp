-- =====================================================================================
-- SGI Di Égida · Consulta: el costo de lo que sale a $0 va aparte (09/11/2026)
-- En el histórico de Odoo los menús Yuga suman 1.194 menús a $0 (800 Kali Yuga). Contados como
-- combos consumen platos y bebidas sin venta en Odoo y suben el % teórico (los mocktails pasan
-- de ~45 % a ~99 %). Consulta muestra los dos números:
--   · pct_teorico: todo lo consumido por ventas, también lo que salió a $0 (menús, cortesías)
--   · pct_teorico_con_venta: solo lo que se cobró (sin las unidades a $0)
--   · costo_sin_venta: cuánto costó lo que salió a $0
-- =====================================================================================

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
           case when coalesce(lineas, 0) > 0 and lineas = con_costo then costo * unidades_sin_valor end as costo_sin_venta,
           case when coalesce(lineas, 0) > 0 and lineas = con_costo and neto_carta > 0 then costo / neto_carta * 100 end as pct_carta,
           case when coalesce(lineas, 0) > 0 and lineas = con_costo then neto_carta - costo end as margen_unit
      from prod),
  tot as (
    select coalesce(sum(valor_neto), 0) as ventas, coalesce(sum(valor_neto) filter (where completa), 0) as ventas_completas,
           coalesce(sum(costo_total), 0) as costo_teorico, coalesce(sum(costo_sin_venta), 0) as costo_sin_venta,
           coalesce(sum(unidades), 0) as unidades, coalesce(sum(unidades_sin_valor), 0) as unidades_sin_valor
      from p2),
  sin_eq as (
    select count(distinct clave) as productos, coalesce(sum(valor_neto), 0) as valor, coalesce(sum(cantidad), 0) as unidades
      from l where l.tipo is null and p_area is null),
  otros as (
    select coalesce(sum(valor_neto) filter (where tipo = 'PROPINA'), 0) as propinas,
           coalesce(sum(valor_neto) filter (where tipo = 'PROMOCION'), 0) as promociones,
           coalesce(sum(valor_neto) filter (where tipo = 'IGNORAR'), 0) as ignorado,
           coalesce(sum(cantidad) filter (where tipo = 'COMBO' and valor_neto = 0), 0) as combos_sin_venta
      from l),
  sec as (
    select seccion, area, count(*) as productos, round(avg(pct_carta), 1) as pct_carta,
           case when sum(valor_neto) filter (where completa) > 0
                then round(sum(costo_total) / sum(valor_neto) filter (where completa) * 100, 1) end as pct_teorico,
           case when sum(valor_neto) filter (where completa) > 0
                then round((sum(costo_total) - coalesce(sum(costo_sin_venta), 0)) / sum(valor_neto) filter (where completa) * 100, 1) end as pct_teorico_con_venta,
           max(meta_pct) as meta_pct, round(sum(valor_neto)) as ventas, round(sum(unidades)) as unidades,
           round(sum(unidades_sin_valor)) as unidades_sin_valor, round(sum(costo_sin_venta)) as costo_sin_venta,
           round(sum(valor_neto) filter (where completa) - sum(costo_total)) as margen,
           count(*) filter (where not completa) as sin_ficha_completa
      from p2 group by seccion, area)
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta, 'area', p_area,
    'ventas_netas', round(t.ventas), 'unidades', t.unidades, 'unidades_sin_valor', t.unidades_sin_valor,
    'costo_teorico', round(t.costo_teorico), 'costo_sin_venta', round(t.costo_sin_venta),
    'pct_teorico', case when t.ventas_completas > 0 then round(t.costo_teorico / t.ventas_completas * 100, 1) end,
    'pct_teorico_con_venta', case when t.ventas_completas > 0 then round((t.costo_teorico - t.costo_sin_venta) / t.ventas_completas * 100, 1) end,
    'cobertura_pct', case when t.ventas + s.valor > 0 then round(t.ventas_completas / (t.ventas + s.valor) * 100, 1) end,
    'sin_equivalencia', jsonb_build_object('productos', s.productos, 'valor', round(s.valor), 'unidades', s.unidades),
    'propinas', round(o.propinas), 'promociones', round(o.promociones), 'ignorado', round(o.ignorado),
    'combos_sin_venta', o.combos_sin_venta,
    'secciones', coalesce((select jsonb_agg(to_jsonb(sec) order by sec.area, sec.ventas desc nulls last) from sec), '[]'),
    'productos', coalesce((select jsonb_agg(jsonb_build_object(
        'generico_id', id, 'codigo', codigo, 'nombre', nombre, 'area', area, 'seccion', seccion,
        'unidades', unidades, 'unidades_sin_valor', unidades_sin_valor, 'valor_neto', round(valor_neto),
        'completa', completa, 'costo_unit', round(costo), 'costo_total', round(costo_total), 'costo_sin_venta', round(costo_sin_venta),
        'precio', precio, 'neto_carta', round(neto_carta), 'pct_carta', round(pct_carta, 1),
        'margen_unit', round(margen_unit), 'meta_pct', meta_pct, 'banda_pp', banda_pp) order by valor_neto desc) from p2), '[]'))
    from tot t, sin_eq s, otros o
$$;
