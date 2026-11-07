-- =====================================================================================
-- SGI Di Égida · Marca del ingrediente en la ficha (Anthony, 07/11/2026)
-- La ficha pedía el genérico («Vinagre Balsámico») y no dejaba decir cuál de sus marcas se usa
-- (Colavita, Roland, granel). Ahora cada línea puede llevar el producto (marca y presentación):
--   · es opcional: sin marca, la línea sigue siendo «cualquiera del genérico», como antes;
--   · el costo de la línea usa el de esa marca (kardex o, sin kardex, su referencia); si la marca
--     no tiene costo, el del genérico;
--   · al producir, la app propone esa marca para la línea (quien produce la puede cambiar);
--   · cambiar solo la marca crea versión nueva (cuenta en la huella de la ficha).
-- Si después la marca se elimina o pasa a otro genérico, la línea vuelve a «cualquiera».
-- Las funciones se ajustan sobre su definición vigente (sin reescribirlas); si un texto esperado
-- no aparece, la migración se detiene.
-- =====================================================================================

alter table public.ficha_lineas add column producto_id uuid references public.productos (id);
comment on column public.ficha_lineas.producto_id is
  'Marca/presentación que pide la ficha (opcional). Null = cualquier producto del genérico.';

-- ---------------------------------------------------------------- costo de una marca
-- kardex del producto; sin kardex, su costo de referencia. Null si no es de ese genérico o está inactivo.
create or replace function privado.costo_marca(p_producto uuid, p_generico uuid)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select c.costo_promedio from public.costos_producto c where c.producto_id = p.id and c.costo_promedio is not null),
    (select cr.costo_unitario_base from public.costos_referencia cr where cr.producto_id = p.id))
    from public.productos p
   where p.id = p_producto and p.generico_id = p_generico and p.activo
$$;

-- ¿el costo de la línea es estimado? con marca que tiene costo propio: estimado si no viene del kardex
create or replace function privado.costo_linea_estimado(p_generico uuid, p_producto uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when privado.costo_marca(p_producto, p_generico) is not null
      then not exists (select 1 from public.costos_producto c where c.producto_id = p_producto and c.costo_promedio is not null)
    else privado.costo_es_estimado(p_generico) end
$$;

-- etiqueta de la marca: «Colavita · Botella 250 ml», «Granel»
create or replace function privado.etiqueta_producto(p_producto uuid, p_generico uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(nullif(concat_ws(' · ', nullif(trim(p.marca), ''), nullif(trim(p.presentacion), '')), ''), p.codigo)
    from public.productos p
   where p.id = p_producto and p.generico_id = p_generico and p.activo
$$;

revoke execute on function privado.costo_marca(uuid, uuid), privado.costo_linea_estimado(uuid, uuid),
                           privado.etiqueta_producto(uuid, uuid) from public;

-- ---------------------------------------------------------------- ajustes sobre la definición vigente
create or replace function pg_temp.parchar(p_fn regprocedure, p_cambios text[])
returns void
language plpgsql
as $$
declare v_def text; v_i int;
begin
  v_def := pg_get_functiondef(p_fn);
  for v_i in 1 .. array_length(p_cambios, 1) / 2 loop
    if position(p_cambios[2 * v_i - 1] in v_def) = 0 then
      raise exception 'No se encontró en %: %', p_fn, p_cambios[2 * v_i - 1];
    end if;
    v_def := replace(v_def, p_cambios[2 * v_i - 1], p_cambios[2 * v_i]);
  end loop;
  execute v_def;
end
$$;

-- costo de cada línea: el de su marca si la tiene
select pg_temp.parchar('privado.costo_ficha_completo(uuid)', array[
  'else privado.costo_estimado_generico(g.id) end as valor) cu',
  'else coalesce(privado.costo_marca(l.producto_id, g.id), privado.costo_estimado_generico(g.id)) end as valor) cu']);

-- costo estimado de una MPI por su receta: también con la marca de cada línea
select pg_temp.parchar('privado.costo_estimado_generico(uuid, integer)', array[
  'select fl.cantidad, fl.unidad, fl.generico_id as gid from public.ficha_lineas fl',
  'select fl.cantidad, fl.unidad, fl.generico_id as gid, fl.producto_id as pid from public.ficha_lineas fl',
  'v_cu := privado.costo_estimado_generico(l.gid, p_prof + 1);',
  'v_cu := coalesce(privado.costo_marca(l.pid, l.gid), privado.costo_estimado_generico(l.gid, p_prof + 1));']);

-- cambiar la marca es un cambio de la ficha
select pg_temp.parchar('privado.huella_ficha(uuid)', array[
  'jsonb_build_array(l.generico_id, l.cantidad, l.unidad, l.nota)',
  'jsonb_build_array(l.generico_id, l.cantidad, l.unidad, l.nota, l.producto_id)']);

-- guardar: valida y guarda la marca
select pg_temp.parchar('public.guardar_ficha(jsonb)', array[
  E'    v_vistos := v_vistos || v_ing.id;\n',
  E'    v_vistos := v_vistos || v_ing.id;\n'
  || E'    if privado.uuid_o_null(v_l ->> ''producto_id'') is not null and not exists (\n'
  || E'         select 1 from public.productos pr where pr.id = privado.uuid_o_null(v_l ->> ''producto_id'') and pr.generico_id = v_ing.id and pr.activo) then\n'
  || E'      f := f || (''Línea '' || v_n || '' ('' || v_ing.nombre || ''): esa marca no es de este ingrediente o ya no está activa.'');\n'
  || E'    end if;\n',
  'insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad, nota)',
  'insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad, nota, producto_id)',
  E'privado.texto_o_null(e.value ->> ''nota'', 200)\n      from jsonb_array_elements(p -> ''lineas'') with ordinality e;',
  E'privado.texto_o_null(e.value ->> ''nota'', 200), privado.uuid_o_null(e.value ->> ''producto_id'')\n      from jsonb_array_elements(p -> ''lineas'') with ordinality e;']);

-- leer la ficha: la marca de cada línea y las marcas de cada ingrediente para elegir
select pg_temp.parchar('privado.ficha_para_editar_completo(uuid, uuid)', array[
  '''cantidad'', l.cantidad, ''unidad'', l.unidad, ''nota'', l.nota,',
  '''producto_id'', case when privado.etiqueta_producto(l.producto_id, g.id) is not null then l.producto_id end, '
  || '''marca'', privado.etiqueta_producto(l.producto_id, g.id), '
  || '''cantidad'', l.cantidad, ''unidad'', l.unidad, ''nota'', l.nota,',
  '''estimado'', c.costo_unitario is not null and privado.costo_es_estimado(g.id))',
  '''estimado'', c.costo_unitario is not null and privado.costo_linea_estimado(g.id, l.producto_id))',
  'from public.conversiones c where c.generico_id = g.id))',
  'from public.conversiones c where c.generico_id = g.id), '
  || '''productos'', (select coalesce(jsonb_agg(jsonb_build_object(''id'', p.id, ''etiqueta'', privado.etiqueta_producto(p.id, g.id)) '
  || 'order by p.marca, p.presentacion), ''[]'') from public.productos p where p.generico_id = g.id and p.activo))']);

-- Producir: la línea dice qué marca pide la ficha
select pg_temp.parchar('privado.datos_produccion_completo(public.area_app)', array[
  '''cantidad'', l.cantidad, ''unidad'', l.unidad, ''nota'', l.nota,',
  '''producto_id'', case when privado.etiqueta_producto(l.producto_id, g2.id) is not null then l.producto_id end, '
  || '''cantidad'', l.cantidad, ''unidad'', l.unidad, ''nota'', l.nota,']);
