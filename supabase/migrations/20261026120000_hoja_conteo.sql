-- =====================================================================================
-- SGI Di Égida · 11 · Hoja de conteo por zona
-- public.hoja_conteo: lo que se recorre al contar una zona, en orden.
--   · los productos asignados a la zona (ubicacion_productos), en su orden de recorrido;
--   · los que tienen saldo en la zona aunque no estén asignados;
--   · si la zona no tiene nada asignado (las de bar hoy), todo lo inventariable del área.
-- No trae el saldo del kardex: el conteo es a ciegas para no sesgar a quien cuenta. Solo dice
-- si el producto ya tiene kardex (conteo normal) o no (entra en el conteo inicial).
-- =====================================================================================

create or replace function public.hoja_conteo(p_ubicacion text)
returns table (producto_id uuid, codigo text, generico text, marca text, presentacion text, categoria text,
               unidad_base public.unidad_base, unidad_compra text, contenido_base numeric, contenido_variable boolean,
               tiene_tara boolean, tiene_kardex boolean, asignado boolean, orden integer, estado public.estado_catalogo)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_area public.area_app;
  v_con_asignados boolean;
begin
  select u.area into v_area from public.ubicaciones u where u.codigo = p_ubicacion and u.activo;
  if v_area is null then raise exception 'Ubicación no válida: %', p_ubicacion; end if;
  if not privado.puede_operar(v_area) then
    raise exception 'Sin permiso para contar en %.', p_ubicacion using errcode = '42501';
  end if;
  v_con_asignados := exists (select 1 from public.ubicacion_productos up where up.ubicacion = p_ubicacion and up.activo);

  return query
  select p.id, p.codigo, g.nombre, p.marca, p.presentacion, coalesce(c.nombre, 'Sin categoría'),
         g.unidad_base, p.unidad_compra, p.contenido_base, p.contenido_variable,
         exists (select 1 from public.taras t where t.producto_id = p.id and t.tara_g is not null),
         exists (select 1 from public.movimientos m where m.producto_id = p.id),
         up.producto_id is not null,
         up.orden,
         p.estado
    from public.productos p
    join public.genericos g on g.id = p.generico_id
    left join public.categorias c on c.codigo = g.categoria
    left join public.ubicacion_productos up on up.producto_id = p.id and up.ubicacion = p_ubicacion and up.activo
   where p.activo and g.activo and g.area = v_area
     and g.tipo not in ('SIN_COSTO', 'BEBIDA', 'PLATO')
     and (up.producto_id is not null
          or exists (select 1 from public.existencias e where e.producto_id = p.id and e.ubicacion = p_ubicacion and e.cantidad <> 0)
          or not v_con_asignados)
   order by (up.producto_id is null), up.orden nulls last, coalesce(c.nombre, 'zzz'), g.nombre, p.marca, p.presentacion;
end
$$;

revoke execute on function public.hoja_conteo(text) from public, anon;
grant execute on function public.hoja_conteo(text) to authenticated;
