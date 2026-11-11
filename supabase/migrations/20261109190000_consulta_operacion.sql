-- =====================================================================================
-- SGI Di Égida · Consulta, bloques 3 a 6: inventario, compras, producción y pérdidas (09/11/2026)
-- Especificación de Anthony (06/11/2026). Todo solo para administración (pesos).
--   3 · Inventario: valor por área, categoría y zona; rotación y días de inventario por categoría;
--       bajo mínimo; sin movimiento en 30 días ($ inmovilizado); MPI por vencer; diferencias de
--       los últimos conteos.
--   4 · Compras: por proveedor y categoría; variación de precio por insumo contra el período
--       anterior con su impacto sobre el costo de lo vendido; pedido contra recibido; recepciones
--       con alertas.
--   5 · Producción: lotes por MPI, rendimiento real contra ficha, $/g en el tiempo, responsables
--       con más desvíos, lotes vencidos sin consumir.
--   6 · Pérdidas: bajas en pesos por causa, responsable y producto, y la tendencia.
-- Compras históricas de los Sheets y lotes históricos entran junto con los de la app.
-- =====================================================================================

-- consumo de inventario (lo que sale y no vuelve): producción, ventas, bajas y ajustes de conteo
create or replace function privado.es_consumo(p_tipo public.tipo_movimiento)
returns boolean
language sql immutable
as $$
  select p_tipo in ('SALIDA_A_PRODUCCION', 'SALIDA_VENTA', 'SALIDA_BAJA', 'AJUSTE_CONTEO_NEGATIVO', 'AJUSTE_CONTEO_POSITIVO')
$$;

create or replace function privado.solo_admin()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.ve_precios() then
    raise exception 'Sin permiso: Consulta es de administración.' using errcode = '42501';
  end if;
end
$$;

-- ---------------------------------------------------------------- 3 · inventario
create or replace function public.consulta_inventario(p_area public.area_app, p_desde date, p_hasta date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_res jsonb; v_dias int := p_hasta - p_desde + 1;
begin
  perform privado.solo_admin();
  with e as (
    select ex.producto_id, ex.ubicacion, ex.cantidad, u.nombre as zona, u.area, p.codigo, g.nombre, g.unidad_base::text as ub,
           coalesce(ca.nombre, 'Sin categoría') as categoria, coalesce(c.costo_promedio, 0) as cu,
           ex.cantidad * coalesce(c.costo_promedio, 0) as valor, p.stock_minimo, p.contenido_base, p.unidad_compra
      from public.existencias ex join public.ubicaciones u on u.codigo = ex.ubicacion
      join public.productos p on p.id = ex.producto_id join public.genericos g on g.id = p.generico_id
      left join public.costos_producto c on c.producto_id = ex.producto_id left join public.categorias ca on ca.codigo = g.categoria
     where ex.cantidad <> 0 and (p_area is null or u.area = p_area)),
  m as (
    select mv.producto_id, mv.fecha, coalesce(o.tipo, mv.tipo) as tipo_ef, coalesce(mv.costo_total, 0) as valor
      from public.movimientos mv join public.ubicaciones u on u.codigo = mv.ubicacion left join public.movimientos o on o.id = mv.reversa_de
     where p_area is null or u.area = p_area),
  consumo as (
    select g.categoria, -sum(m.valor) as valor from m join public.productos p on p.id = m.producto_id join public.genericos g on g.id = p.generico_id
     where privado.es_consumo(m.tipo_ef) and m.fecha between p_desde and p_hasta group by 1),
  ultimo as (select producto_id, max(fecha) as fecha from m group by 1),
  prod as (select producto_id, codigo, nombre, ub, categoria, unidad_compra, max(stock_minimo) as minimo, max(contenido_base) as contenido,
                  sum(cantidad) as cantidad, sum(valor) as valor from e group by 1, 2, 3, 4, 5, 6),
  cat as (
    select coalesce(ca.nombre, 'Sin categoría') as categoria, sum(e.valor) as valor
      from e left join public.categorias ca on ca.nombre = e.categoria group by 1),
  cat2 as (
    select cat.categoria, cat.valor, coalesce(cs.valor, 0) as consumo
      from cat left join public.categorias ca on ca.nombre = cat.categoria left join consumo cs on cs.categoria = ca.codigo)
  select jsonb_build_object(
    'valor_total', round(coalesce((select sum(valor) from e), 0)),
    'por_area', coalesce((select jsonb_agg(jsonb_build_object('area', area, 'valor', round(v))) from (select area, sum(valor) v from e group by 1) x), '[]'),
    'por_zona', coalesce((select jsonb_agg(jsonb_build_object('zona', zona, 'area', area, 'valor', round(v), 'productos', n) order by v desc)
                            from (select zona, area, sum(valor) v, count(distinct producto_id) n from e group by 1, 2) x), '[]'),
    'por_categoria', coalesce((select jsonb_agg(jsonb_build_object('categoria', categoria, 'valor', round(valor), 'consumo', round(consumo),
                                 'rotacion', case when valor > 0 then round(consumo / valor, 2) end,
                                 'dias', case when consumo > 0 then round(valor / (consumo / v_dias)) end) order by valor desc) from cat2), '[]'),
    'bajo_minimo', coalesce((select jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', nombre, 'unidad', unidad_compra,
                                'saldo', round(cantidad / nullif(contenido, 0), 1), 'minimo', minimo) order by nombre)
                               from prod where minimo is not null and contenido > 0 and cantidad / contenido <= minimo), '[]'),
    'sin_movimiento', coalesce((select jsonb_agg(jsonb_build_object('codigo', p.codigo, 'nombre', p.nombre, 'valor', round(p.valor), 'ultimo', u.fecha) order by p.valor desc)
                                  from prod p left join ultimo u on u.producto_id = p.producto_id
                                 where p.cantidad > 0 and (u.fecha is null or u.fecha < p_hasta - 30)), '[]'),
    'inmovilizado', round(coalesce((select sum(p.valor) from prod p left join ultimo u on u.producto_id = p.producto_id
                                     where p.cantidad > 0 and (u.fecha is null or u.fecha < p_hasta - 30)), 0)),
    'por_vencer', coalesce((select jsonb_agg(jsonb_build_object('codigo', l.codigo, 'mpi', l.mpi, 'vence', l.vence, 'restante', l.restante, 'unidad', l.unidad_base) order by l.vence)
                              from (select * from privado.lotes_lista_completo('BAR') union all select * from privado.lotes_lista_completo('COCINA')) l
                             where (p_area is null or l.area = p_area::text) and l.origen = 'APP' and coalesce(l.restante, 0) > 0
                               and l.vence is not null and l.vence <= privado.hoy() + privado.parametro_num('LOTE_POR_VENCER_DIAS', 2)::int), '[]'),
    'diferencias_conteo', coalesce((
      select jsonb_agg(jsonb_build_object('fecha', c.fecha, 'zona', u.nombre, 'nombre', g.nombre, 'unidad', g.unidad_base, 'diferencia', cl.diferencia,
                                          'valor', round(mv.costo_total), 'conteo', c.codigo) order by abs(coalesce(mv.costo_total, 0)) desc)
        from public.conteo_lineas cl join public.conteos c on c.id = cl.conteo_id join public.ubicaciones u on u.codigo = c.ubicacion
        join public.productos p on p.id = cl.producto_id join public.genericos g on g.id = p.generico_id
        left join public.movimientos mv on mv.id = cl.movimiento_id
       where cl.diferencia <> 0 and c.fecha between p_desde and p_hasta and (p_area is null or u.area = p_area)), '[]'))
  into v_res;
  return v_res;
end
$$;

-- ---------------------------------------------------------------- 4 · compras
create or replace function privado.compras_rango(p_area public.area_app, p_desde date, p_hasta date)
returns table (fecha date, proveedor text, generico_id uuid, categoria text, area public.area_app, cantidad numeric, valor numeric,
               origen text, recepcion_id uuid, recepcion text, pedida numeric, recibida numeric, hallazgos text[], producto text)
language sql stable security definer set search_path = ''
as $$
  select rc.fecha, coalesce(pv.nombre, 'Sin proveedor'), p.generico_id, coalesce(ca.nombre, 'Sin categoría'), g.area, rl.cantidad_base, rl.valor_total,
         'APP', rc.id, rc.codigo, rl.cantidad_pedida, rl.cantidad_recibida, rl.hallazgos, g.nombre
    from public.recepcion_lineas rl join public.recepciones rc on rc.id = rl.recepcion_id
    join public.productos p on p.id = rl.producto_id join public.genericos g on g.id = p.generico_id
    left join public.categorias ca on ca.codigo = g.categoria left join public.proveedores pv on pv.id = rc.proveedor_id
   where rc.fecha between p_desde and p_hasta and (p_area is null or g.area = p_area)
     and not exists (select 1 from public.anulaciones an where an.documento_tipo = 'RECEPCION' and an.documento_id = rc.id
                                                           and (an.linea_id is null or an.linea_id = rl.id))
  union all
  select ch.fecha, coalesce(nullif(trim(ch.proveedor), ''), 'Sin proveedor'), ch.generico_id, coalesce(ca.nombre, 'Sin categoría'), g.area,
         ch.cantidad_base, ch.valor_total, 'HISTORICO', null, null, null, null, null, g.nombre
    from public.compras_historicas ch join public.genericos g on g.id = ch.generico_id left join public.categorias ca on ca.codigo = g.categoria
   where ch.computable and ch.fecha between p_desde and p_hasta and (p_area is null or g.area = p_area)
$$;

create or replace function public.consulta_compras(p_area public.area_app, p_desde date, p_hasta date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_res jsonb; v_dias int := p_hasta - p_desde + 1;
begin
  perform privado.solo_admin();
  with c as (select * from privado.compras_rango(p_area, p_desde, p_hasta)),
  ca as (select * from privado.compras_rango(p_area, p_desde - v_dias, p_desde - 1)),
  pr as (
    select coalesce(a.generico_id, b.generico_id) as generico_id,
           a.v / nullif(a.q, 0) as cu, b.v / nullif(b.q, 0) as cu_antes
      from (select generico_id, sum(valor) v, sum(cantidad) q from c group by 1) a
      full join (select generico_id, sum(valor) v, sum(cantidad) q from ca group by 1) b on b.generico_id = a.generico_id),
  -- consumo teórico del período (lo vendido × las fichas) para medir el impacto de cada subida
  teo as (
    select cf.generico_id, sum(vp.unidades * cf.cantidad_base) as q
      from privado.ventas_periodo(p_desde, p_hasta) vp
      cross join lateral privado.costo_ficha_completo(privado.ficha_vigente(vp.generico_id)) cf
     group by 1),
  var as (
    select pr.generico_id, g.nombre, g.unidad_base::text as ub, pr.cu, pr.cu_antes, (pr.cu / pr.cu_antes - 1) * 100 as pct,
           (pr.cu - pr.cu_antes) * coalesce(teo.q, 0) as impacto
      from pr join public.genericos g on g.id = pr.generico_id left join teo on teo.generico_id = pr.generico_id
     where pr.cu is not null and pr.cu_antes > 0)
  select jsonb_build_object(
    'total', round(coalesce((select sum(valor) from c), 0)),
    'total_anterior', round(coalesce((select sum(valor) from ca), 0)),
    'por_proveedor', coalesce((select jsonb_agg(jsonb_build_object('proveedor', proveedor, 'valor', round(v), 'compras', n) order by v desc)
                                 from (select proveedor, sum(valor) v, count(*) n from c group by 1) x), '[]'),
    'por_categoria', coalesce((select jsonb_agg(jsonb_build_object('categoria', categoria, 'valor', round(v)) order by v desc)
                                 from (select categoria, sum(valor) v from c group by 1) x), '[]'),
    'subidas', coalesce((select jsonb_agg(jsonb_build_object('generico_id', generico_id, 'nombre', nombre, 'unidad', ub, 'cu', round(cu, 2),
                           'cu_antes', round(cu_antes, 2), 'pct', round(pct, 1), 'impacto', round(impacto)) order by pct desc)
                          from (select * from var where pct > 0 order by pct desc limit 10) x), '[]'),
    'bajadas', coalesce((select jsonb_agg(jsonb_build_object('nombre', nombre, 'unidad', ub, 'cu', round(cu, 2), 'cu_antes', round(cu_antes, 2),
                           'pct', round(pct, 1), 'impacto', round(impacto)) order by pct)
                          from (select * from var where pct < 0 order by pct limit 5) x), '[]'),
    'impacto_subidas', round(coalesce((select sum(impacto) from var where pct > 0), 0)),
    'pedido_vs_recibido', coalesce((select jsonb_agg(jsonb_build_object('fecha', fecha, 'recepcion', recepcion, 'recepcion_id', recepcion_id, 'proveedor', proveedor,
                                      'producto', producto, 'pedida', pedida, 'recibida', recibida) order by fecha desc)
                                     from c where pedida is not null and pedida <> recibida), '[]'),
    'con_alertas', coalesce((select jsonb_agg(jsonb_build_object('fecha', fecha, 'recepcion', recepcion, 'recepcion_id', recepcion_id, 'proveedor', proveedor,
                               'producto', producto, 'hallazgos', to_jsonb(hallazgos)) order by fecha desc)
                              from c where coalesce(cardinality(hallazgos), 0) > 0), '[]'),
    'recepciones_forzadas', (select count(*) from public.recepciones r where r.forzada and r.fecha between p_desde and p_hasta and (p_area is null or r.area = p_area)))
  into v_res;
  return v_res;
end
$$;

-- ---------------------------------------------------------------- 5 · producción
create or replace function public.consulta_produccion(p_area public.area_app, p_desde date, p_hasta date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_res jsonb; v_umbral numeric := privado.parametro_num('DESVIO_REND_AVISO_PP', 5);
begin
  perform privado.solo_admin();
  with l as (
    select * from (select * from privado.lotes_lista_completo('BAR') union all select * from privado.lotes_lista_completo('COCINA')) x
     where (p_area is null or x.area = p_area::text) and x.fecha between p_desde and p_hasta and coalesce(x.estado, '') <> 'ANULADO')
  select jsonb_build_object(
    'lotes', (select count(*) from l), 'costo_total', round(coalesce((select sum(costo_total) from l), 0)),
    'fuera_banda', (select count(*) from l where abs(desvio_pp) > v_umbral), 'umbral_pp', v_umbral,
    'por_mpi', coalesce((select jsonb_agg(jsonb_build_object('generico_id', generico_id, 'mpi', mpi, 'lotes', n, 'neto', round(neto), 'unidad', ub,
                           'costo', round(costo), 'rendimiento', round(rend * 100, 1), 'desvio', round(desvio, 1), 'costo_g', round(costo_g, 2),
                           'fuera_banda', fuera) order by n desc, mpi)
                          from (select generico_id, mpi, max(unidad_base) ub, count(*) n, sum(neto_g) neto, sum(costo_total) costo, avg(rendimiento) rend,
                                       avg(desvio_pp) desvio, sum(costo_total) / nullif(sum(neto_g) filter (where costo_total is not null), 0) costo_g,
                                       count(*) filter (where abs(desvio_pp) > v_umbral) fuera
                                  from l group by 1, 2) x), '[]'),
    'serie', coalesce((select jsonb_agg(jsonb_build_object('mpi', mpi, 'puntos', puntos) order by n desc)
                        from (select mpi, count(*) n, jsonb_agg(jsonb_build_object('fecha', fecha, 'costo_g', round(costo_gramo, 2), 'codigo', codigo) order by fecha) puntos
                                from l where costo_gramo is not null group by 1 having count(*) >= 2 order by count(*) desc limit 6) x), '[]'),
    'responsables', coalesce((select jsonb_agg(jsonb_build_object('responsable', responsable, 'lotes', n, 'fuera_banda', f, 'desvio', round(d, 1)) order by f desc, n desc)
                               from (select coalesce(responsable, 'Sin responsable') responsable, count(*) n, count(*) filter (where abs(desvio_pp) > v_umbral) f,
                                            avg(abs(desvio_pp)) d from l group by 1) x), '[]'),
    'vencidos_sin_consumir', coalesce((select jsonb_agg(jsonb_build_object('codigo', codigo, 'mpi', mpi, 'fecha', fecha, 'vence', vence, 'restante', round(restante, 1),
                                         'unidad', unidad_base, 'valor', round(restante * costo_gramo)) order by vence)
                                        from l where origen = 'APP' and coalesce(restante, 0) > 0 and vence < privado.hoy()), '[]'))
  into v_res;
  return v_res;
end
$$;

-- ---------------------------------------------------------------- 6 · pérdidas
create or replace function public.consulta_perdidas(p_area public.area_app, p_desde date, p_hasta date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_res jsonb; v_dias int := p_hasta - p_desde + 1;
begin
  perform privado.solo_admin();
  with b as (
    select mv.fecha, -coalesce(mv.costo_total, 0) as valor, -mv.cantidad as cantidad, coalesce(bj.causa, 'OTRO') as causa,
           coalesce(pr.nombre, 'Sin registro') as responsable, g.nombre as producto, g.unidad_base::text as ub, u.area
      from public.movimientos mv left join public.movimientos o on o.id = mv.reversa_de
      join public.ubicaciones u on u.codigo = mv.ubicacion
      join public.productos p on p.id = mv.producto_id join public.genericos g on g.id = p.generico_id
      left join public.bajas bj on bj.id = coalesce(o.documento_id, mv.documento_id)
      left join public.perfiles pr on pr.id = bj.usuario_id
     where coalesce(o.tipo, mv.tipo) = 'SALIDA_BAJA' and (p_area is null or u.area = p_area)
       and mv.fecha between p_desde - 5 * v_dias and p_hasta),
  ahora as (select * from b where fecha between p_desde and p_hasta)
  select jsonb_build_object(
    'total', round(coalesce((select sum(valor) from ahora), 0)),
    'por_causa', coalesce((select jsonb_agg(jsonb_build_object('causa', causa, 'valor', round(v), 'bajas', n) order by v desc)
                             from (select causa, sum(valor) v, count(*) n from ahora group by 1) x), '[]'),
    'por_responsable', coalesce((select jsonb_agg(jsonb_build_object('responsable', responsable, 'valor', round(v), 'bajas', n) order by v desc)
                                   from (select responsable, sum(valor) v, count(*) n from ahora group by 1) x), '[]'),
    'por_producto', coalesce((select jsonb_agg(jsonb_build_object('producto', producto, 'unidad', ub, 'cantidad', round(q, 1), 'valor', round(v)) order by v desc)
                                from (select producto, ub, sum(cantidad) q, sum(valor) v from ahora group by 1, 2 order by sum(valor) desc limit 10) x), '[]'),
    'tendencia', (select jsonb_agg(jsonb_build_object('desde', p_desde - k * v_dias, 'hasta', p_hasta - k * v_dias,
                    'valor', round(coalesce((select sum(valor) from b where fecha between p_desde - k * v_dias and p_hasta - k * v_dias), 0))) order by k desc)
                    from generate_series(0, 5) k),
    'cortesias', '[]'::jsonb)
  into v_res;
  return v_res;
end
$$;

revoke execute on function public.consulta_inventario(public.area_app, date, date), public.consulta_compras(public.area_app, date, date),
                           public.consulta_produccion(public.area_app, date, date), public.consulta_perdidas(public.area_app, date, date) from public, anon;
grant execute on function public.consulta_inventario(public.area_app, date, date), public.consulta_compras(public.area_app, date, date),
                          public.consulta_produccion(public.area_app, date, date), public.consulta_perdidas(public.area_app, date, date) to authenticated;
