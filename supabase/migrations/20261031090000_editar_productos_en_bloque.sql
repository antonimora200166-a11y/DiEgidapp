-- =====================================================================================
-- SGI Di Égida · 20 · Cambios en bloque en el catálogo
-- public.editar_productos: aplica el mismo cambio (y, si se pide, la validación) a varios
-- productos seleccionados en la pantalla Catálogo. Cada uno pasa por public.editar_producto con
-- todas sus reglas; un producto que no se puede cambiar no detiene a los demás y su motivo
-- vuelve en el resultado. Hasta 200 por vez.
-- p_cambios: {generico: {unidad_base?, categoria?, conservacion?}, producto: {unidad_compra?, contenido_base?}}
-- Devuelve {ok: n, fallidos: n, detalle: [{id, codigo, ok, mensajes[]}]}.
-- =====================================================================================

create or replace function public.editar_productos(p_ids uuid[], p_cambios jsonb default '{}', p_validar boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id   uuid;
  v_r    jsonb;
  v_det  jsonb := '[]';
  v_ok   int := 0;
  v_mal  int := 0;
  v_cod  text;
  g      jsonb := coalesce(p_cambios -> 'generico', '{}');
  x      jsonb := coalesce(p_cambios -> 'producto', '{}');
begin
  if coalesce(cardinality(p_ids), 0) = 0 then raise exception 'No hay productos seleccionados.'; end if;
  if cardinality(p_ids) > 200 then raise exception 'Máximo 200 productos por vez.'; end if;
  if g = '{}' and x = '{}' and not p_validar then raise exception 'No hay ningún cambio que aplicar.'; end if;
  -- solo se cambia en bloque lo que tiene sentido igual para todos
  if exists (select 1 from jsonb_object_keys(g) k where k not in ('unidad_base', 'categoria', 'conservacion'))
     or exists (select 1 from jsonb_object_keys(x) k where k not in ('unidad_compra', 'contenido_base')) then
    raise exception 'En bloque solo se cambia unidad base, categoría, conservación, unidad de compra y contenido.';
  end if;

  foreach v_id in array (select array_agg(distinct i) from unnest(p_ids) i)
  loop
    select p.codigo into v_cod from public.productos p where p.id = v_id;
    begin
      v_r := public.editar_producto(jsonb_build_object('id', v_id, 'validar', p_validar, 'generico', g, 'producto', x));
    exception when others then
      v_r := privado.resultado(false, v_id, v_cod, array[sqlerrm], '{}', '{}');
    end;
    if (v_r ->> 'ok')::boolean then v_ok := v_ok + 1; else v_mal := v_mal + 1; end if;
    v_det := v_det || jsonb_build_object('id', v_id, 'codigo', v_cod, 'ok', (v_r ->> 'ok')::boolean,
                                         'mensajes', coalesce(v_r -> 'fatales', '[]') || coalesce(v_r -> 'avisos', '[]'));
  end loop;

  perform privado.bitacora('CAMBIO EN BLOQUE', 'productos', null,
                           jsonb_build_object('cambios', p_cambios, 'validar', p_validar, 'ok', v_ok, 'fallidos', v_mal));
  return jsonb_build_object('ok', v_ok, 'fallidos', v_mal, 'detalle', v_det);
end
$$;

revoke execute on function public.editar_productos(uuid[], jsonb, boolean) from public, anon;
grant execute on function public.editar_productos(uuid[], jsonb, boolean) to authenticated;
