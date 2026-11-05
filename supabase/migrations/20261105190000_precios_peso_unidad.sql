-- =====================================================================================
-- SGI Di Égida · 42 · Precios desde fotos: lo que se vio con la primera factura (05/11/2026)
-- Tiquete de Agro Fruvers con 20 líneas: se guardaron 13. Las 7 que venían por UNIDAD de un
-- producto que va en gramos (piña, sandía, repollo…) no tenían cómo pasar a gramos y la pantalla
-- las dejó por fuera sin avisar. Ahora la pantalla pide cuánto pesa una unidad, y aquí:
--   · ese peso queda como conversión del genérico (1 und = N g, DECLARADO) si no tenía una;
--   · la misma línea de la misma factura (proveedor + documento + producto + cantidad + valor)
--     no se guarda dos veces aunque se suba otra foto de la misma factura.
-- =====================================================================================

-- p: {area, ruta, proveedor_id?, proveedor, documento, fecha,
--     lineas: [{n, producto_id, descripcion, cantidad_base, valor_total, fijar_costo,
--               presentacion?: {presentacion, unidad_compra, contenido_base, contenido_variable},
--               renombrar?: {nombre?, marca?}, peso_unidad? (g o ml que pesa 1 und)}]}
create or replace function public.guardar_precios_foto(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_area public.area_app;
  v_ruta text := nullif(trim(p ->> 'ruta'), '');
  v_prov text := nullif(trim(p ->> 'proveedor'), '');
  v_prov_id uuid;
  v_doc text := nullif(trim(p ->> 'documento'), '');
  v_fecha date;
  x jsonb; r record;
  v_n int; v_cant numeric; v_valor numeric; v_cu numeric; v_fuente text;
  v_ok int := 0; v_mal int := 0; v_det jsonb := '[]';
  v_msgs text[]; v_res jsonb; v_ins int; v_gen jsonb; v_pro jsonb; v_peso numeric;
begin
  begin v_area := (p ->> 'area')::public.area_app;
  exception when others then raise exception 'Área no válida: %', p ->> 'area'; end;
  if not privado.edita_area(v_area) then
    raise exception 'Solo el jefe de % o el admin guardan precios.', v_area using errcode = '42501';
  end if;
  if v_ruta is null or v_ruta !~ ('^' || v_area::text || '/\d{4}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$') then
    raise exception 'Falta la foto de donde salen los precios.';
  end if;
  begin v_fecha := coalesce(nullif(p ->> 'fecha', '')::date, privado.hoy());
  exception when others then v_fecha := privado.hoy(); end;
  if v_fecha > privado.hoy() then v_fecha := privado.hoy(); end if;
  -- el proveedor elegido, o el que se llama igual
  select pv.id, pv.nombre into v_prov_id, v_prov from public.proveedores pv
   where pv.id = nullif(p ->> 'proveedor_id', '')::uuid or (nullif(p ->> 'proveedor_id', '') is null and pv.nombre_norm = privado.normalizar(v_prov))
   limit 1;
  if v_prov_id is null then v_prov := nullif(trim(p ->> 'proveedor'), ''); end if;
  v_fuente := 'Foto · ' || coalesce(v_prov, 'sin proveedor') || ' · ' || to_char(v_fecha, 'DD/MM/YYYY');

  for x in select value from jsonb_array_elements(coalesce(p -> 'lineas', '[]')) loop
    v_n := (x ->> 'n')::int;
    v_msgs := '{}';
    select pr.id, pr.codigo, pr.generico_id, pr.activo, g.area, g.nombre, g.unidad_base, g.tipo,
           exists (select 1 from public.movimientos m where m.producto_id = pr.id) as kardex
      into r
      from public.productos pr join public.genericos g on g.id = pr.generico_id
     where pr.id = nullif(x ->> 'producto_id', '')::uuid;
    begin
      v_cant := (x ->> 'cantidad_base')::numeric;
      v_valor := (x ->> 'valor_total')::numeric;
    exception when others then v_cant := null; v_valor := null; end;

    if r.id is null or not r.activo then v_msgs := v_msgs || 'Elige el producto del catálogo.'::text;
    elsif r.area <> v_area then v_msgs := v_msgs || ('«' || r.nombre || '» no es de esta área.');
    elsif r.tipo <> 'MPe' then v_msgs := v_msgs || ('«' || r.nombre || '» no se compra (es ' || r.tipo || ').');
    end if;
    if not coalesce(v_cant > 0 and v_valor > 0, false) then v_msgs := v_msgs || 'Falta la cantidad o el valor.'::text; end if;
    if cardinality(v_msgs) = 0 then
      v_cu := v_valor / v_cant;
      if not privado.costo_creible(r.unidad_base, v_cu) then
        v_msgs := v_msgs || ('Da $' || round(v_cu, 2) || ' por ' || r.unidad_base || ', que no es creíble: revisa la cantidad y su unidad.');
      end if;
    end if;
    if cardinality(v_msgs) > 0 then
      v_mal := v_mal + 1;
      v_det := v_det || jsonb_build_object('n', v_n, 'ok', false, 'mensaje', array_to_string(v_msgs, ' '));
      continue;
    end if;

    -- presentación, nombre genérico y marca: todo por editar_producto; si no pasa, la línea no se guarda a medias
    v_gen := jsonb_strip_nulls(jsonb_build_object('nombre', nullif(trim(x #>> '{renombrar,nombre}'), '')));
    v_pro := coalesce(case when jsonb_typeof(x -> 'presentacion') = 'object' then x -> 'presentacion' end, '{}')
             || case when x #> '{renombrar}' ? 'marca' then jsonb_build_object('marca', coalesce(trim(x #>> '{renombrar,marca}'), '')) else '{}' end;
    if v_gen <> '{}' or v_pro <> '{}' then
      v_res := public.editar_producto(jsonb_build_object('id', r.id, 'generico', v_gen, 'producto', v_pro));
      if not (v_res ->> 'ok')::boolean then
        v_mal := v_mal + 1;
        v_det := v_det || jsonb_build_object('n', v_n, 'ok', false, 'mensaje',
          'No se pudo corregir el producto: ' || (select string_agg(m, ' ') from jsonb_array_elements_text(v_res -> 'fatales') m));
        continue;
      end if;
      if v_gen ? 'nombre' then v_msgs := v_msgs || ('Ahora se llama «' || (v_gen ->> 'nombre') || '».'); end if;
      if v_pro ? 'marca' then v_msgs := v_msgs || ('Marca: «' || (v_pro ->> 'marca') || '».'); end if;
      if jsonb_typeof(x -> 'presentacion') = 'object' then v_msgs := v_msgs || 'Presentación corregida.'::text; end if;
    end if;

    if v_doc is not null and exists (
         select 1 from public.compras_historicas ch
          where ch.origen = 'FOTO' and ch.documento = v_doc and ch.producto_id = r.id
            and privado.normalizar(coalesce(ch.proveedor, '')) = privado.normalizar(coalesce(v_prov, ''))
            and ch.cantidad_base = v_cant and ch.valor_total = v_valor) then
      v_ins := 0;
    else
      insert into public.compras_historicas (id, origen, id_origen, fecha, proveedor, documento, nombre_factura, generico_id, producto_id,
                                             cantidad_base, valor_total, computable, motivo_exclusion)
      values (gen_random_uuid(), 'FOTO', v_ruta || '#' || v_n, v_fecha, v_prov, v_doc,
              coalesce(nullif(trim(x ->> 'descripcion'), ''), r.nombre), r.generico_id, r.id, v_cant, v_valor, true, null)
      on conflict (origen, id_origen) do nothing;
      get diagnostics v_ins = row_count;
    end if;
    if v_ins = 0 then
      v_msgs := v_msgs || 'Esta línea de esta factura ya se había guardado.'::text;
    else
      perform privado.registrar_proveedor_producto(v_prov_id, r.id, x ->> 'descripcion', v_cant, v_valor, v_fecha, 'FOTO');
    end if;

    begin v_peso := nullif(x ->> 'peso_unidad', '')::numeric; exception when others then v_peso := null; end;
    if v_peso > 0 and r.unidad_base <> 'und' then
      insert into public.conversiones (generico_id, unidad, factor_a_base, estado, medido_por, medido_en, nota)
      values (r.generico_id, 'und', v_peso, 'DECLARADO', auth.uid(), privado.hoy(), 'Desde Precios desde fotos: ' || coalesce(v_prov, 'foto') || '.')
      on conflict (generico_id, unidad) do nothing;
      get diagnostics v_ins = row_count;
      if v_ins = 1 then v_msgs := v_msgs || ('Queda que 1 und pesa ' || v_peso || ' ' || r.unidad_base || '.'); end if;
    end if;

    -- el nombre de la factura queda aprendido para emparejar la próxima vez (si no apunta ya a otro)
    if length(coalesce(trim(x ->> 'descripcion'), '')) >= 3 then
      insert into public.alias (fuente, alias, generico_id, producto_id)
      values ('RECEPCION', trim(x ->> 'descripcion'), r.generico_id, r.id)
      on conflict do nothing;
    end if;

    if coalesce((x ->> 'fijar_costo')::boolean, true) then
      if r.kardex then
        v_msgs := v_msgs || 'Ya tiene kardex: su costo lo lleva el kardex, el precio queda solo como referencia.'::text;
      else
        insert into public.costos_referencia (producto_id, costo_unitario_base, fuente, n_compras, ultima_compra, calculado_en)
        values (r.id, round(v_cu, 6), v_fuente, 1, v_fecha, current_date)
        on conflict (producto_id) do update
           set costo_unitario_base = excluded.costo_unitario_base, fuente = excluded.fuente, n_compras = 1,
               ultima_compra = excluded.ultima_compra, calculado_en = excluded.calculado_en;
        insert into public.costos_referencia (producto_id, costo_unitario_base, fuente, n_compras, ultima_compra, calculado_en)
        select o.id, round(v_cu, 6), 'Mismo genérico: ' || v_fuente, null, v_fecha, current_date
          from public.productos o
         where o.generico_id = r.generico_id and o.activo and o.id <> r.id
           and not exists (select 1 from public.movimientos m where m.producto_id = o.id)
        on conflict (producto_id) do update
           set costo_unitario_base = excluded.costo_unitario_base, fuente = excluded.fuente, calculado_en = excluded.calculado_en
         where public.costos_referencia.fuente like 'Mismo genérico%';
        v_msgs := v_msgs || ('Costo: $' || round(v_cu, 2) || ' por ' || r.unidad_base || '.');
      end if;
    end if;

    v_ok := v_ok + 1;
    v_det := v_det || jsonb_build_object('n', v_n, 'ok', true, 'mensaje', array_to_string(v_msgs, ' '));
  end loop;

  perform privado.bitacora('PRECIOS DESDE FOTO', 'compras_historicas', v_ruta,
                           jsonb_build_object('area', v_area, 'proveedor', v_prov, 'proveedor_id', v_prov_id, 'ok', v_ok, 'fallidos', v_mal));
  return jsonb_build_object('ok', v_ok, 'fallidos', v_mal, 'detalle', v_det, 'proveedor_id', v_prov_id);
end
$$;

revoke execute on function public.guardar_precios_foto(jsonb) from public, anon;
grant execute on function public.guardar_precios_foto(jsonb) to authenticated;
