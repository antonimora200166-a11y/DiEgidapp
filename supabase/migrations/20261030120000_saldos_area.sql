-- =====================================================================================
-- SGI Di Égida · 15 · Saldos del área para Bajas y Trasladar
-- public.saldos_area: cada producto inventariable del área (MPe y MPI) con su presentación,
-- su costo promedio y su saldo en cada zona ({"BAR_BODEGA": 5000, …}; solo zonas ≠ 0).
-- Las pantallas proponen primero lo que hay en la zona y muestran el valor de lo que se mueve.
-- No escribe nada: registran public.registrar_baja y public.registrar_traslado.
-- =====================================================================================

create or replace function public.saldos_area(p_area public.area_app)
returns table (producto_id uuid, codigo text, generico text, marca text, presentacion text, tipo public.tipo_generico,
               unidad_base public.unidad_base, unidad_compra text, contenido_base numeric, contenido_variable boolean,
               costo_promedio numeric, saldos jsonb, estado public.estado_catalogo)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.puede_operar(p_area) then
    raise exception 'Sin permiso para mover inventario en %.', p_area using errcode = '42501';
  end if;
  return query
  select p.id, p.codigo, g.nombre, p.marca, p.presentacion, g.tipo, g.unidad_base, p.unidad_compra, p.contenido_base,
         p.contenido_variable, cp.costo_promedio,
         coalesce((select jsonb_object_agg(e.ubicacion, e.cantidad) from public.existencias e
                    where e.producto_id = p.id and e.cantidad <> 0), '{}'),
         p.estado
    from public.productos p
    join public.genericos g on g.id = p.generico_id
    left join public.costos_producto cp on cp.producto_id = p.id
   where p.activo and g.activo and g.area = p_area and g.tipo in ('MPe', 'MPI')
   order by g.nombre, p.marca, p.presentacion;
end
$$;

revoke execute on function public.saldos_area(public.area_app) from public, anon;
grant execute on function public.saldos_area(public.area_app) to authenticated;
