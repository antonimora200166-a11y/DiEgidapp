-- =====================================================================================
-- SGI Di Égida · 22 · Catálogo con filtros, columnas y agrupación (al estilo de Odoo)
-- public.catalogo_filtrado(filtros, orden, agrupar, límite, desde): una página del catálogo con
-- todo lo que muestra la vista de lista, sobre TODO el catálogo (no solo la página visible).
-- Dentro de un grupo de filtros se suman (g o ml); entre grupos se cruzan (g y Lácteos).
-- filtros: {areas[], estados[] (PROVISIONAL|VALIDADO), activos (activos|inactivos|todos),
--           tipos[] (MPe|MPI|SIN_COSTO|BEBIDA|PLATO), unidades[] (g|ml|und), categorias[] (código | 'SIN'),
--           conservacion[] (Ambiente|Refrigerado|Congelado|SIN), abc[] (A|B|C|SIN),
--           faltas[] (categoria|frio|factor|costo|tara), kardex (con|sin), variable (true|false), q}
-- Los costos y saldos solo salen para quien ve costos (el resto los recibe vacíos).
-- =====================================================================================

create or replace function public.catalogo_filtrado(p_filtros jsonb default '{}', p_orden text default 'nombre',
                                                    p_agrupar text default null, p_limite integer default 80,
                                                    p_desde integer default 0)
returns table (id uuid, codigo text, generico_id uuid, generico text, marca text, presentacion text, area public.area_app,
               tipo public.tipo_generico, categoria text, categoria_nombre text, unidad_base public.unidad_base,
               unidad_compra text, contenido_base numeric, contenido_variable boolean, conservacion text,
               temp_max_llegada numeric, estado public.estado_catalogo, activo boolean, clase_abc public.clase_abc,
               costo_promedio numeric, costo_referencia numeric, saldo numeric, con_kardex boolean, sin_tara boolean,
               creado_por text, creado_en timestamptz, grupo text, total_grupo bigint, total bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare
  f      jsonb := coalesce(p_filtros, '{}');
  v_costos boolean := privado.ve_costos();
  v_q    text := privado.normalizar(f ->> 'q');
begin
  if not privado.usuario_activo() then raise exception 'Sin sesión.' using errcode = '42501'; end if;

  return query
  with base as (
    select p.id, p.codigo, g.id as generico_id, g.nombre as generico, p.marca, p.presentacion, g.area, g.tipo, g.categoria,
           c.nombre as categoria_nombre, g.unidad_base, p.unidad_compra, p.contenido_base, p.contenido_variable, g.conservacion,
           g.temp_max_llegada, p.estado, p.activo and g.activo as activo, p.clase_abc,
           cp.costo_promedio, cr.costo_unitario_base as costo_referencia, coalesce(cp.cantidad, 0) as saldo,
           exists (select 1 from public.movimientos m where m.producto_id = p.id) as con_kardex,
           exists (select 1 from public.taras t where t.producto_id = p.id and t.tara_g is null) as sin_tara,
           pe.nombre as creado_por, p.creado_en
      from public.productos p
      join public.genericos g on g.id = p.generico_id
      left join public.categorias c on c.codigo = g.categoria
      left join public.costos_producto cp on cp.producto_id = p.id
      left join public.costos_referencia cr on cr.producto_id = p.id
      left join public.perfiles pe on pe.id = p.creado_por
  ), filtrada as (
    select b.* from base b
     where (not (f ? 'areas') or jsonb_array_length(f -> 'areas') = 0 or b.area::text in (select jsonb_array_elements_text(f -> 'areas')))
       and (not (f ? 'estados') or jsonb_array_length(f -> 'estados') = 0 or b.estado::text in (select jsonb_array_elements_text(f -> 'estados')))
       and (case coalesce(f ->> 'activos', 'activos') when 'todos' then true when 'inactivos' then not b.activo else b.activo end)
       and (not (f ? 'tipos') or jsonb_array_length(f -> 'tipos') = 0 or b.tipo::text in (select jsonb_array_elements_text(f -> 'tipos')))
       and (not (f ? 'unidades') or jsonb_array_length(f -> 'unidades') = 0 or b.unidad_base::text in (select jsonb_array_elements_text(f -> 'unidades')))
       and (not (f ? 'categorias') or jsonb_array_length(f -> 'categorias') = 0
            or coalesce(b.categoria, 'SIN') in (select jsonb_array_elements_text(f -> 'categorias')))
       and (not (f ? 'conservacion') or jsonb_array_length(f -> 'conservacion') = 0
            or coalesce(b.conservacion, 'SIN') in (select jsonb_array_elements_text(f -> 'conservacion')))
       and (not (f ? 'abc') or jsonb_array_length(f -> 'abc') = 0 or coalesce(b.clase_abc::text, 'SIN') in (select jsonb_array_elements_text(f -> 'abc')))
       -- «le falta»: basta con que le falte una de las marcadas
       and (not (f ? 'faltas') or jsonb_array_length(f -> 'faltas') = 0
            or ('categoria' in (select jsonb_array_elements_text(f -> 'faltas')) and b.categoria is null)
            or ('frio' in (select jsonb_array_elements_text(f -> 'faltas')) and b.conservacion is null)
            or ('factor' in (select jsonb_array_elements_text(f -> 'faltas')) and (b.contenido_variable or b.contenido_base is null))
            or ('costo' in (select jsonb_array_elements_text(f -> 'faltas')) and b.costo_promedio is null and b.costo_referencia is null)
            or ('tara' in (select jsonb_array_elements_text(f -> 'faltas')) and b.sin_tara))
       and (case f ->> 'kardex' when 'con' then b.con_kardex when 'sin' then not b.con_kardex else true end)
       and (case f ->> 'variable' when 'true' then b.contenido_variable when 'false' then not b.contenido_variable else true end)
       and (v_q = '' or privado.normalizar(b.generico || ' ' || b.marca || ' ' || b.presentacion || ' ' || b.codigo) like '%' || v_q || '%'
            or exists (select 1 from public.alias al where al.generico_id = b.generico_id
                         and (al.producto_id is null or al.producto_id = b.id) and al.alias_norm like '%' || v_q || '%'))
  ), agrupada as (
    select x.*, case p_agrupar
                  when 'unidad' then x.unidad_base::text
                  when 'categoria' then coalesce(x.categoria_nombre, 'Sin categoría')
                  when 'tipo' then x.tipo::text
                  when 'estado' then x.estado::text
                  when 'area' then x.area::text
                  when 'conservacion' then coalesce(x.conservacion, 'Sin conservación')
                  when 'abc' then coalesce('Clase ' || x.clase_abc::text, 'Sin clase')
                end as grupo
      from filtrada x
  )
  select a.id, a.codigo, a.generico_id, a.generico, a.marca, a.presentacion, a.area, a.tipo, a.categoria, a.categoria_nombre,
         a.unidad_base, a.unidad_compra, a.contenido_base, a.contenido_variable, a.conservacion, a.temp_max_llegada, a.estado,
         a.activo, a.clase_abc,
         case when v_costos then a.costo_promedio end, case when v_costos then a.costo_referencia end,
         case when v_costos then a.saldo end, a.con_kardex, a.sin_tara, a.creado_por, a.creado_en,
         a.grupo, count(*) over (partition by a.grupo), count(*) over ()
    from agrupada a
   order by a.grupo nulls first,
            case when p_orden = 'codigo' then a.codigo end,
            case when p_orden = 'creado' then a.creado_en end desc,
            case when p_orden = 'costo' then a.costo_promedio end desc nulls last,
            case when p_orden = 'saldo' then a.saldo end desc,
            case when p_orden = 'categoria' then a.categoria_nombre end,
            case when p_orden = 'unidad' then a.unidad_base::text end,
            a.generico, a.marca, a.presentacion
   limit least(greatest(coalesce(p_limite, 80), 1), 500) offset greatest(coalesce(p_desde, 0), 0);
end
$$;

revoke execute on function public.catalogo_filtrado(jsonb, text, text, integer, integer) from public, anon;
grant execute on function public.catalogo_filtrado(jsonb, text, text, integer, integer) to authenticated;
