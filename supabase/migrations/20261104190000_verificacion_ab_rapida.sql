-- =====================================================================================
-- SGI Di Égida · 35 · Hoja de verificación A/B más rápida
-- Los parecidos se buscan con el operador % de pg_trgm (umbral 0,45), que usa el índice
-- genericos_nombre_trgm, en vez de calcular similarity() contra todos los genéricos:
-- en cocina pasa de ~5 s a ~1,3 s con el mismo resultado.
-- =====================================================================================

create or replace function public.lista_verificacion(p_area public.area_app)
returns table (producto_id uuid, codigo text, generico_id uuid, generico text, marca text, presentacion text,
               tipo public.tipo_generico, categoria text, clase_abc public.clase_abc, unidad_base public.unidad_base,
               unidad_compra text, contenido_base numeric, contenido_variable boolean,
               valor_compras numeric, n_compras integer, ult_fecha date, ult_proveedor text, ult_nombre text,
               ult_valor numeric, ult_cantidad_base numeric, costo_base numeric, costo_fuente text,
               costo_min numeric, costo_max numeric, tiene_ficha boolean, tiene_kardex boolean,
               parecidos jsonb, alertas text[], verificado_en timestamptz, verificado_por text)
language plpgsql stable security definer set search_path = '' set pg_trgm.similarity_threshold = 0.45
as $$
#variable_conflict use_column
begin
  if not (privado.tiene_rol('admin', 'auditor') or privado.edita_area(p_area)) then
    raise exception 'Solo administración o el jefe del área ven la hoja de verificación.' using errcode = '42501';
  end if;

  return query
  with prod as (
    select p.*, g.nombre as g_nombre, g.tipo as g_tipo, g.unidad_base as g_ub, g.nombre_norm,
           (select c.nombre from public.categorias c where c.codigo = g.categoria) as cat_nombre
      from public.productos p join public.genericos g on g.id = p.generico_id
     where p.activo and g.activo and g.area = p_area and g.tipo in ('MPe', 'MPI')
  ),
  -- compras: las históricas de los Sheets (de cocina vienen por genérico) y las recibidas en la app
  compras as (
    select pr.id as pid, ch.fecha, ch.proveedor, ch.nombre_factura as nombre, ch.valor_total, ch.cantidad_base,
           ch.costo_unitario_base as cub
      from prod pr join public.compras_historicas ch
        on ch.computable and (ch.producto_id = pr.id or (ch.producto_id is null and ch.generico_id = pr.generico_id))
    union all
    select pr.id, re.fecha, pv.nombre, pr.g_nombre, rl.valor_total, rl.cantidad_base, rl.costo_unitario_base
      from prod pr
      join public.recepcion_lineas rl on rl.producto_id = pr.id and rl.valor_total > 0 and rl.cantidad_base > 0
      join public.recepciones re on re.id = rl.recepcion_id
      left join public.proveedores pv on pv.id = re.proveedor_id
     where not exists (select 1 from public.anulaciones an where an.documento_id = re.id and (an.linea_id is null or an.linea_id = rl.id))
  ),
  resumen as (
    select c.pid, sum(c.valor_total) as valor, count(*)::int as n, min(c.cub) as cmin, max(c.cub) as cmax,
           sum(c.valor_total) / nullif(sum(c.cantidad_base), 0) as cprom
      from compras c group by c.pid
  ),
  ultima as (
    select distinct on (c.pid) c.* from compras c order by c.pid, c.fecha desc
  ),
  base as (
    select pr.*, r.valor, r.n, r.cmin, r.cmax, u.fecha as u_fecha, u.proveedor as u_prov, u.nombre as u_nombre,
           u.valor_total as u_valor, u.cantidad_base as u_cant,
           coalesce(cp.costo_promedio, cr.costo_unitario_base, r.cprom) as costo,
           case when cp.costo_promedio is not null then 'kardex' when cr.costo_unitario_base is not null then 'referencia'
                when r.cprom is not null then 'compras' end as fuente,
           exists (select 1 from public.fichas fi where fi.generico_id = pr.generico_id) as ficha,
           exists (select 1 from public.movimientos m where m.producto_id = pr.id) as kardex,
           (select cantidad from privado.cantidad_presentacion(pr.presentacion)) as pres_cant,
           (select unidad from privado.cantidad_presentacion(pr.presentacion)) as pres_ub,
           (select coalesce(jsonb_agg(jsonb_build_object('generico_id', s.id, 'nombre', s.nombre, 'unidad_base', s.unidad_base,
                                                         'parecido', round(s.sim::numeric, 2)) order by s.sim desc), '[]')
              from (select o.id, o.nombre, o.unidad_base, extensions.similarity(o.nombre_norm, pr.nombre_norm) as sim
                      from public.genericos o
                     where o.activo and o.area = p_area and o.tipo = pr.g_tipo and o.id <> pr.generico_id
                       and o.nombre_norm operator(extensions.%) pr.nombre_norm
                       and not exists (select 1 from public.revision_catalogo rc
                                        where rc.decision = 'SEPARAR'
                                          and ((rc.a_generico_id = o.id and rc.b_generico_id = pr.generico_id)
                                            or (rc.b_generico_id = o.id and rc.a_generico_id = pr.generico_id)))
                     order by sim desc limit 3) s) as parecidos
      from prod pr
      left join resumen r on r.pid = pr.id
      left join ultima u on u.pid = pr.id
      left join public.costos_producto cp on cp.producto_id = pr.id
      left join public.costos_referencia cr on cr.producto_id = pr.id
  )
  select b.id, b.codigo, b.generico_id, b.g_nombre, b.marca, b.presentacion, b.g_tipo, b.cat_nombre, b.clase_abc, b.g_ub,
         b.unidad_compra, b.contenido_base, b.contenido_variable, b.valor, coalesce(b.n, 0), b.u_fecha, b.u_prov, b.u_nombre,
         b.u_valor, b.u_cant, b.costo, b.fuente, b.cmin, b.cmax, b.ficha, b.kardex, b.parecidos,
         array_remove(array[
           case when b.g_tipo = 'MPe' and b.costo is null then 'SIN_PRECIO' end,
           case when b.g_tipo = 'MPI' and not b.ficha then 'MPI_SIN_FICHA' end,
           case when not b.contenido_variable and b.pres_cant is not null and b.pres_ub = b.g_ub::text
                     and abs(b.pres_cant - b.contenido_base) > 0.02 * b.pres_cant then 'PRESENTACION' end,
           case when b.pres_ub is not null and b.g_ub::text <> 'und' and b.pres_ub <> b.g_ub::text then 'UNIDAD_TEXTO' end,
           case when not b.contenido_variable and (
                     (b.unidad_compra in ('KG', 'LT', 'L') and b.contenido_base <> 1000)
                  or (b.unidad_compra in ('GR', 'G', 'ML') and b.contenido_base <> 1)
                  or (b.contenido_base = 1 and b.g_ub <> 'und' and b.unidad_compra not in ('GR', 'G', 'ML'))) then 'CONTENIDO' end,
           case when b.costo is not null and (
                     (b.g_ub = 'g' and (b.costo < 0.5 or b.costo > 400))
                  or (b.g_ub = 'ml' and (b.costo < 0.5 or b.costo > 600))
                  or (b.g_ub = 'und' and (b.costo < 20 or b.costo > 1000000))) then 'PRECIO_RARO' end,
           case when b.cmin > 0 and b.cmax / b.cmin > 2 then 'PRECIOS_DISPARES' end,
           case when exists (select 1 from jsonb_array_elements(b.parecidos) e where (e ->> 'parecido')::numeric >= 0.6) then 'PARECIDO' end
         ], null),
         b.verificado_en, pe.nombre
    from base b left join public.perfiles pe on pe.id = b.verificado_por
   order by b.clase_abc nulls last, b.valor desc nulls last, b.g_nombre, b.marca, b.presentacion;
end
$$;
