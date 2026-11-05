-- =====================================================================================
-- SGI Di Égida · 44 · Directorio de proveedores (pantalla Proveedores, 05/11/2026)
-- Organizar la lista: corregir nombre y NIT, desactivar el que ya no se usa y volver a
-- activarlo. Al renombrar, el nombre viejo queda como alias (las facturas con ese nombre
-- se siguen reconociendo). Los unidos a otro no se editan: se ven con a quién se unieron.
-- =====================================================================================

create or replace function public.lista_proveedores()
returns table (id uuid, nombre text, nit text, activo boolean, unido_en text, alias text[],
               productos integer, compras integer, ultima_compra date, recepciones integer)
language sql stable security definer set search_path = ''
as $$
  select pv.id, pv.nombre, pv.nit, pv.activo,
         (select u.nombre from public.proveedores u where u.id = pv.unido_en),
         coalesce((select array_agg(pa.alias order by pa.alias) from public.proveedor_alias pa where pa.proveedor_id = pv.id), '{}'),
         (select count(*)::int from public.proveedor_productos pp where pp.proveedor_id = pv.id),
         (select coalesce(sum(pp.veces), 0)::int from public.proveedor_productos pp where pp.proveedor_id = pv.id),
         (select max(pp.ultima_fecha) from public.proveedor_productos pp where pp.proveedor_id = pv.id),
         (select count(*)::int from public.recepciones r where r.proveedor_id = pv.id)
    from public.proveedores pv
   where privado.edita_proveedores() or privado.tiene_rol('auditor')
   order by pv.activo desc, pv.unido_en nulls first, pv.nombre
$$;

create or replace function public.editar_proveedor(p_id uuid, p_nombre text, p_nit text, p_activo boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v public.proveedores%rowtype;
  v_nombre text := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_nit text := nullif(regexp_replace(coalesce(p_nit, ''), '[^0-9-]', '', 'g'), '');
begin
  if not privado.edita_proveedores() then
    raise exception 'Solo administración o los jefes de área organizan proveedores.' using errcode = '42501';
  end if;
  select * into v from public.proveedores where id = p_id for update;
  if v.id is null then raise exception 'No existe el proveedor.'; end if;
  if v.unido_en is not null then
    return privado.resultado(false, null, null, array['Está unido a otro proveedor: edita ese.'], '{}', '{}');
  end if;
  if length(v_nombre) < 3 then return privado.resultado(false, null, null, array['El nombre necesita al menos 3 letras.'], '{}', '{}'); end if;
  if exists (select 1 from public.proveedores o where o.nombre_norm = privado.normalizar(v_nombre) and o.id <> v.id) then
    return privado.resultado(false, null, null, array['Ya hay otro proveedor con ese nombre: si es el mismo, únelos en «Proveedores repetidos».'], '{}', '{}');
  end if;
  if exists (select 1 from public.proveedor_alias pa where pa.alias_norm = privado.normalizar(v_nombre) and pa.proveedor_id <> v.id) then
    return privado.resultado(false, null, null, array['Ese nombre ya es otro nombre de un proveedor distinto.'], '{}', '{}');
  end if;

  if privado.normalizar(v_nombre) <> v.nombre_norm then
    insert into public.proveedor_alias (proveedor_id, alias) values (v.id, v.nombre) on conflict (alias_norm) do nothing;
    delete from public.proveedor_alias where proveedor_id = v.id and alias_norm = privado.normalizar(v_nombre);
  end if;
  update public.proveedores set nombre = v_nombre, nit = v_nit, activo = coalesce(p_activo, activo) where id = v.id;
  perform privado.bitacora('PROVEEDOR EDITADO', 'proveedores', v.id::text,
    jsonb_build_object('antes', jsonb_build_object('nombre', v.nombre, 'nit', v.nit, 'activo', v.activo),
                       'ahora', jsonb_build_object('nombre', v_nombre, 'nit', v_nit, 'activo', coalesce(p_activo, v.activo))));
  return privado.resultado(true, v.id, null, '{}', '{}', '{}');
end
$$;

revoke execute on function public.lista_proveedores(), public.editar_proveedor(uuid, text, text, boolean) from public, anon;
grant execute on function public.lista_proveedores(), public.editar_proveedor(uuid, text, text, boolean) to authenticated;
