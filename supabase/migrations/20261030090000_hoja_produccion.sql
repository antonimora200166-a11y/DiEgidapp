-- =====================================================================================
-- SGI Di Égida · 14 · Hoja de producción
-- public.datos_produccion: lo que la pantalla Producir necesita de un área en una sola llamada.
--   · mpis     : los MPI que se pueden producir, con su ficha vigente y su costo actual;
--   · fichas   : las fichas vigentes con sus líneas por genérico y el factor a unidad base de
--                cada línea (null = falta la conversión, el lote la rechazaría con F8);
--   · insumos  : todo lo que puede consumir un lote (MPe, MPI y sin costo) con su costo;
--   · saldos   : existencias distintas de cero por zona, para proponer el producto con saldo.
-- No escribe nada: el lote lo registra public.registrar_lote.
-- =====================================================================================

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

  with vigentes as (            -- la versión más reciente vigente de cada genérico
    select distinct on (f.generico_id) f.*
      from public.fichas f join public.genericos g on g.id = f.generico_id
     where g.area = p_area and g.tipo = 'MPI'
       and f.vigente_desde <= privado.hoy() and (f.vigente_hasta is null or f.vigente_hasta >= privado.hoy())
     order by f.generico_id, f.version desc
  )
  select jsonb_build_object(
    'mpis', coalesce((
      select jsonb_agg(jsonb_build_object(
               'producto_id', p.id, 'codigo', p.codigo, 'generico_id', g.id, 'generico', g.nombre, 'marca', p.marca,
               'presentacion', p.presentacion, 'unidad_base', g.unidad_base, 'costo_promedio', cp.costo_promedio,
               'ficha_id', vf.id, 'ficha_codigo', vf.codigo,
               'ultimo_lote', (select max(l.fecha) from public.lotes_produccion l where l.producto_id = p.id))
             order by g.nombre, p.marca)
        from public.productos p
        join public.genericos g on g.id = p.generico_id
        left join vigentes vf on vf.generico_id = g.id
        left join public.costos_producto cp on cp.producto_id = p.id
       where p.activo and g.activo and g.area = p_area and g.tipo = 'MPI'), '[]'),
    'fichas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', vf.id, 'codigo', vf.codigo, 'version', vf.version, 'neto_esperado', vf.neto_esperado, 'nota', vf.nota,
               'lineas', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'linea', l.linea, 'generico_id', g2.id, 'generico', g2.nombre, 'tipo', g2.tipo,
                          'unidad_base', g2.unidad_base, 'cantidad', l.cantidad, 'unidad', l.unidad, 'nota', l.nota,
                          'factor', privado.a_base(g2.id, 1, l.unidad))
                        order by l.linea)
                   from public.ficha_lineas l join public.genericos g2 on g2.id = l.generico_id
                  where l.ficha_id = vf.id), '[]')))
        from vigentes vf), '[]'),
    'insumos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'producto_id', p.id, 'codigo', p.codigo, 'generico_id', g.id, 'generico', g.nombre, 'marca', p.marca,
               'presentacion', p.presentacion, 'tipo', g.tipo, 'unidad_base', g.unidad_base,
               'costo_promedio', cp.costo_promedio)
             order by g.nombre, p.marca, p.presentacion)
        from public.productos p
        join public.genericos g on g.id = p.generico_id
        left join public.costos_producto cp on cp.producto_id = p.id
       where p.activo and g.activo and g.area = p_area and g.tipo in ('MPe', 'MPI', 'SIN_COSTO')), '[]'),
    'saldos', coalesce((
      select jsonb_agg(jsonb_build_object('producto_id', e.producto_id, 'ubicacion', e.ubicacion, 'cantidad', e.cantidad))
        from public.existencias e join public.ubicaciones u on u.codigo = e.ubicacion
       where u.area = p_area and e.cantidad <> 0), '[]'))
  into v;
  return v;
end
$$;

revoke execute on function public.datos_produccion(public.area_app) from public, anon;
grant execute on function public.datos_produccion(public.area_app) to authenticated;
