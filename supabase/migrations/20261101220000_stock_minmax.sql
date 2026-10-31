-- =====================================================================================
-- SGI Di Égida · Mínimo y máximo de cada producto (en unidades de compra), para el pedido
-- sugerido. Lo cambia quien edita el área; queda en la auditoría de productos.
-- =====================================================================================
create or replace function public.fijar_stock(p_producto uuid, p_minimo numeric, p_maximo numeric)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_g uuid;
begin
  select p.generico_id into v_g from public.productos p where p.id = p_producto;
  if v_g is null then return jsonb_build_object('ok', false, 'error', 'El producto no existe.'); end if;
  if not privado.edita_generico(v_g) then
    raise exception 'Sin permiso para cambiar este producto.' using errcode = '42501';
  end if;
  if (p_minimo is not null and p_minimo < 0) or (p_maximo is not null and p_maximo < 0) then
    return jsonb_build_object('ok', false, 'error', 'El mínimo y el máximo no pueden ser negativos.');
  end if;
  if p_maximo is not null and p_minimo is not null and p_maximo < p_minimo then
    return jsonb_build_object('ok', false, 'error', 'El máximo no puede ser menor que el mínimo.');
  end if;
  if p_maximo is not null and p_minimo is null then
    return jsonb_build_object('ok', false, 'error', 'Pon primero el mínimo: es el que dispara el pedido.');
  end if;
  update public.productos set stock_minimo = p_minimo, stock_maximo = p_maximo where id = p_producto;
  return jsonb_build_object('ok', true);
end
$$;

revoke execute on function public.fijar_stock(uuid, numeric, numeric) from public, anon;
grant execute on function public.fijar_stock(uuid, numeric, numeric) to authenticated;
