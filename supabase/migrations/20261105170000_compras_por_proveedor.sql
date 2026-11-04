-- =====================================================================================
-- SGI Di Égida · 41 · Lo que se le compra a cada proveedor (Anthony, 05/11/2026)
--   · public.proveedor_productos: por proveedor y producto, cómo lo llama en su factura, el
--     último precio y fecha, y cuántas veces se le ha comprado. Se alimenta de:
--       - las recepciones (trigger después de cada línea; si algo falla aquí, la recepción no
--         se entera: nunca la bloquea),
--       - Precios desde fotos,
--       - las compras de los Sheets cuyo proveedor coincide por nombre (una vez, ahora).
--   · Precios desde fotos también:
--       - toma el proveedor (el que se elige, o el que se llama igual);
--       - guarda el nombre de la factura como alias, para que la próxima vez empareje solo;
--       - aplica, si se marca, el nombre genérico y la marca que sugiere la IA (public.editar_producto).
-- =====================================================================================

create table public.proveedor_productos (
  proveedor_id         uuid not null references public.proveedores (id),
  producto_id          uuid not null references public.productos (id),
  nombre_factura       text,
  ultimo_valor         numeric,
  ultima_cantidad_base numeric,
  ultimo_costo_base    numeric,
  ultima_fecha         date not null,
  primera_fecha        date not null,
  veces                integer not null default 1,
  origen               text not null check (origen in ('RECEPCION', 'FOTO', 'SHEET')),
  actualizado_en       timestamptz not null default now(),
  primary key (proveedor_id, producto_id)
);
comment on table public.proveedor_productos is
  'Qué se le compra a cada proveedor, con el nombre de su factura y el último precio. Referencia: no son movimientos.';
create index proveedor_productos_producto_idx on public.proveedor_productos (producto_id);
alter table public.proveedor_productos enable row level security;
revoke all on public.proveedor_productos from anon;
revoke insert, update, delete, truncate on public.proveedor_productos from authenticated;
create policy proveedor_productos_leer on public.proveedor_productos for select to authenticated using (privado.ve_costos());

create or replace function privado.registrar_proveedor_producto(p_proveedor uuid, p_producto uuid, p_nombre text,
  p_cantidad numeric, p_valor numeric, p_fecha date, p_origen text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_cu numeric := case when p_cantidad > 0 and p_valor > 0 then p_valor / p_cantidad end;
begin
  if p_proveedor is null or p_producto is null or p_fecha is null then return; end if;
  insert into public.proveedor_productos as pp (proveedor_id, producto_id, nombre_factura, ultimo_valor, ultima_cantidad_base,
                                                ultimo_costo_base, ultima_fecha, primera_fecha, veces, origen)
  values (p_proveedor, p_producto, nullif(trim(p_nombre), ''), p_valor, p_cantidad, v_cu, p_fecha, p_fecha, 1, p_origen)
  on conflict (proveedor_id, producto_id) do update
     set veces = pp.veces + 1,
         primera_fecha = least(pp.primera_fecha, excluded.primera_fecha),
         nombre_factura = case when excluded.ultima_fecha >= pp.ultima_fecha then coalesce(excluded.nombre_factura, pp.nombre_factura) else pp.nombre_factura end,
         ultimo_valor = case when excluded.ultima_fecha >= pp.ultima_fecha and excluded.ultimo_costo_base is not null then excluded.ultimo_valor else pp.ultimo_valor end,
         ultima_cantidad_base = case when excluded.ultima_fecha >= pp.ultima_fecha and excluded.ultimo_costo_base is not null then excluded.ultima_cantidad_base else pp.ultima_cantidad_base end,
         ultimo_costo_base = case when excluded.ultima_fecha >= pp.ultima_fecha and excluded.ultimo_costo_base is not null then excluded.ultimo_costo_base else pp.ultimo_costo_base end,
         ultima_fecha = greatest(pp.ultima_fecha, excluded.ultima_fecha),
         origen = case when excluded.ultima_fecha >= pp.ultima_fecha then excluded.origen else pp.origen end,
         actualizado_en = now();
end
$$;

-- cada línea recibida cuenta; nunca bloquea la recepción
create or replace function privado.recepcion_linea_proveedor()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_prov uuid; v_fecha date;
begin
  begin
    select re.proveedor_id, re.fecha into v_prov, v_fecha from public.recepciones re where re.id = new.recepcion_id;
    if new.cantidad_base > 0 then
      perform privado.registrar_proveedor_producto(v_prov, new.producto_id, new.nombre_factura, new.cantidad_base, new.valor_total,
                                                   v_fecha, 'RECEPCION');
    end if;
  exception when others then
    null;   -- es solo para identificar proveedores: la recepción sigue
  end;
  return new;
end
$$;
create trigger recepcion_lineas_proveedor after insert on public.recepcion_lineas
  for each row execute function privado.recepcion_linea_proveedor();

-- lo que ya existe: recepciones de la app y compras de los Sheets con el proveedor por nombre
select privado.registrar_proveedor_producto(re.proveedor_id, rl.producto_id, rl.nombre_factura, rl.cantidad_base, rl.valor_total, re.fecha, 'RECEPCION')
  from public.recepcion_lineas rl join public.recepciones re on re.id = rl.recepcion_id
 where rl.cantidad_base > 0
 order by re.fecha;
select privado.registrar_proveedor_producto(pv.id, coalesce(ch.producto_id, (select p.id from public.productos p
                                              where p.generico_id = coalesce(privado.generico_vigente(ch.generico_id), ch.generico_id) and p.activo
                                              order by p.codigo limit 1)),
                                            ch.nombre_factura, ch.cantidad_base, case when ch.computable then ch.valor_total end, ch.fecha, 'SHEET')
  from public.compras_historicas ch join public.proveedores pv on pv.nombre_norm = privado.normalizar(ch.proveedor)
 where ch.origen in ('REC-BAR', 'REC-COC')
 order by ch.fecha;

-- ---------------------------------------------------------------- consulta para la pantalla
create or replace function public.compras_por_proveedor()
returns table (proveedor_id uuid, proveedor text, nit text, producto_id uuid, codigo text, generico text, marca text,
               presentacion text, area public.area_app, unidad_base public.unidad_base, nombre_factura text,
               ultimo_costo_base numeric, ultima_fecha date, primera_fecha date, veces integer, origen text)
language sql stable security definer set search_path = ''
as $$
  select pv.id, pv.nombre, pv.nit, p.id, p.codigo, g.nombre, p.marca, p.presentacion, g.area, g.unidad_base, pp.nombre_factura,
         pp.ultimo_costo_base, pp.ultima_fecha, pp.primera_fecha, pp.veces, pp.origen
    from public.proveedor_productos pp
    join public.proveedores pv on pv.id = pp.proveedor_id
    join public.productos p on p.id = pp.producto_id
    join public.genericos g on g.id = p.generico_id
   where privado.ve_costos() and (privado.tiene_rol('admin', 'auditor') or privado.edita_area(g.area))
   order by pv.nombre, g.nombre, p.marca
$$;

-- ---------------------------------------------------------------- Precios desde fotos, con proveedor, alias y nombre sugerido
-- p: {area, ruta, proveedor_id?, proveedor, documento, fecha,
--     lineas: [{n, producto_id, descripcion, cantidad_base, valor_total, fijar_costo,
--               presentacion?: {presentacion, unidad_compra, contenido_base, contenido_variable},
--               renombrar?: {nombre?, marca?}}]}
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
  v_msgs text[]; v_res jsonb; v_ins int; v_gen jsonb; v_pro jsonb;
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

    insert into public.compras_historicas (id, origen, id_origen, fecha, proveedor, documento, nombre_factura, generico_id, producto_id,
                                           cantidad_base, valor_total, computable, motivo_exclusion)
    values (gen_random_uuid(), 'FOTO', v_ruta || '#' || v_n, v_fecha, v_prov, v_doc,
            coalesce(nullif(trim(x ->> 'descripcion'), ''), r.nombre), r.generico_id, r.id, v_cant, v_valor, true, null)
    on conflict (origen, id_origen) do nothing;
    get diagnostics v_ins = row_count;
    if v_ins = 0 then
      v_msgs := v_msgs || 'Esta línea de esta foto ya se había guardado.'::text;
    else
      perform privado.registrar_proveedor_producto(v_prov_id, r.id, x ->> 'descripcion', v_cant, v_valor, v_fecha, 'FOTO');
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

revoke execute on function public.compras_por_proveedor(), public.guardar_precios_foto(jsonb) from public, anon;
grant execute on function public.compras_por_proveedor(), public.guardar_precios_foto(jsonb) to authenticated;
