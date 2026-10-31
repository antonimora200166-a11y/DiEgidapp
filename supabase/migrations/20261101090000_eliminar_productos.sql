-- =====================================================================================
-- SGI Di Égida · 25 · Eliminar (dar de baja) y reactivar productos — solo administración
-- Decisión de Anthony (31/10/2026): poder eliminar desde cualquier lista los productos que no
-- sirven, y solo con su usuario de administración. Como nada se borra (las recepciones, conteos
-- y lotes viejos siguen apuntando al producto), eliminar lo deja INACTIVO: sale de todas las
-- listas y pantallas de trabajo, con quién, cuándo y por qué en la bitácora, y se puede reactivar.
-- No se elimina lo que tiene saldo en el kardex. Si era el último producto activo de su genérico,
-- el genérico también se da de baja, salvo que una ficha vigente lo use como ingrediente.
-- =====================================================================================

create or replace function public.eliminar_productos(p_ids uuid[], p_motivo text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_p      record;
  v_ok     int := 0; v_mal int := 0;
  v_det    jsonb := '[]';
  v_saldo  text;
  v_ficha  text;
  v_marca  text := 'Eliminado por administración el ' || to_char(now() at time zone 'America/Bogota', 'YYYY-MM-DD');
begin
  if not privado.tiene_rol('admin') then
    raise exception 'Solo administración elimina productos.' using errcode = '42501';
  end if;
  if length(coalesce(trim(p_motivo), '')) < 5 then raise exception 'Escribe por qué se eliminan (mínimo 5 caracteres).'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 then raise exception 'No hay productos seleccionados.'; end if;
  if cardinality(p_ids) > 500 then raise exception 'Máximo 500 productos por vez.'; end if;

  for v_p in
    select p.id, p.codigo, p.activo, p.generico_id, g.nombre, g.activo as g_activo
      from public.productos p join public.genericos g on g.id = p.generico_id
     where p.id = any (p_ids) order by g.nombre for update of p
  loop
    if not v_p.activo then
      v_det := v_det || jsonb_build_object('id', v_p.id, 'codigo', v_p.codigo, 'ok', true, 'mensaje', 'Ya estaba eliminado.');
      continue;
    end if;
    select string_agg(round(e.cantidad, 2) || ' en ' || u.nombre, ', ') into v_saldo
      from public.existencias e join public.ubicaciones u on u.codigo = e.ubicacion
     where e.producto_id = v_p.id and e.cantidad <> 0;
    if v_saldo is not null then
      v_mal := v_mal + 1;
      v_det := v_det || jsonb_build_object('id', v_p.id, 'codigo', v_p.codigo, 'ok', false,
        'mensaje', 'Tiene saldo en el kardex (' || v_saldo || '): cuéntalo en cero, dalo de baja o trasládalo antes de eliminarlo.');
      continue;
    end if;
    -- si es el último producto activo del genérico, el genérico también sale, salvo que una ficha lo pida
    if not exists (select 1 from public.productos o where o.generico_id = v_p.generico_id and o.activo and o.id <> v_p.id) then
      select string_agg(distinct f.codigo, ', ') into v_ficha
        from public.ficha_lineas l join public.fichas f on f.id = l.ficha_id
       where l.generico_id = v_p.generico_id and (f.vigente_hasta is null or f.vigente_hasta >= privado.hoy());
      if v_ficha is not null then
        v_mal := v_mal + 1;
        v_det := v_det || jsonb_build_object('id', v_p.id, 'codigo', v_p.codigo, 'ok', false,
          'mensaje', '«' || v_p.nombre || '» está en la(s) ficha(s) ' || v_ficha || ': quítalo de la ficha o crea otro producto antes de eliminarlo.');
        continue;
      end if;
      update public.genericos set activo = false, nota = concat_ws(' · ', nota, v_marca || ': ' || trim(p_motivo))
       where id = v_p.generico_id and activo;
    end if;
    update public.productos set activo = false, nota = concat_ws(' · ', nota, v_marca || ': ' || trim(p_motivo)) where id = v_p.id;
    update public.propuestas_unidad set estado = 'RECHAZADA', mensaje = 'El producto se eliminó.', decidido_por = auth.uid(), decidido_en = now()
     where producto_id = v_p.id and estado = 'PENDIENTE';
    v_ok := v_ok + 1;
    v_det := v_det || jsonb_build_object('id', v_p.id, 'codigo', v_p.codigo, 'ok', true);
  end loop;

  perform privado.bitacora('PRODUCTOS ELIMINADOS', 'productos', null,
                           jsonb_build_object('ok', v_ok, 'fallidos', v_mal, 'detalle', v_det), trim(p_motivo));
  return jsonb_build_object('ok', v_ok, 'fallidos', v_mal, 'detalle', v_det);
end
$$;

create or replace function public.reactivar_productos(p_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  if not privado.tiene_rol('admin') then
    raise exception 'Solo administración reactiva productos.' using errcode = '42501';
  end if;
  update public.genericos g set activo = true
   where g.id in (select p.generico_id from public.productos p where p.id = any (p_ids)) and not g.activo;
  update public.productos set activo = true where id = any (p_ids) and not activo;
  get diagnostics v_n = row_count;
  perform privado.bitacora('PRODUCTOS REACTIVADOS', 'productos', null, jsonb_build_object('productos', v_n, 'ids', to_jsonb(p_ids)));
  return jsonb_build_object('ok', v_n, 'fallidos', 0, 'detalle', '[]'::jsonb);
end
$$;

revoke execute on function public.eliminar_productos(uuid[], text), public.reactivar_productos(uuid[]) from public, anon;
grant execute on function public.eliminar_productos(uuid[], text), public.reactivar_productos(uuid[]) to authenticated;
