-- =====================================================================================
-- SGI Di Égida · Fase C: Hoy, carta con margen, pedido sugerido, etiquetas de lote y
-- códigos de barras.
-- · resumen_hoy: lo que pide atención hoy en cada área (conteos que tocan, MPI por vencer,
--   bajo mínimo, lotes sin costo, pendientes de revisión), según el rol.
-- · carta_costos / fijar_precio: costo de la receta vigente de cada cóctel y plato contra su
--   precio de carta (con impoconsumo), % de costo y margen frente a META_PCT_COSTO.
-- · pedido_sugerido: lo que está en el mínimo o por debajo, cuánto pedir hasta el máximo y a
--   quién se le compró la última vez.
-- · lote_etiqueta: los datos de la etiqueta QR de un lote (vence = fecha + vida útil).
-- · codigos_barras: el código de barras de cada presentación, aprendido al escanear.
-- =====================================================================================

insert into public.parametros (clave, valor, descripcion)
select v.clave, v.valor, v.descripcion from (values
  ('META_PCT_COSTO',   '25', '% de costo objetivo de cócteles y platos sobre el precio sin impoconsumo.'),
  ('DIAS_AVISO_VENCE', '2',  'Días antes del vencimiento de un lote de MPI en que Inicio avisa.')
) as v (clave, valor, descripcion)
where not exists (select 1 from public.parametros p where p.clave = v.clave);

-- ---------------------------------------------------------------- códigos de barras
create table public.codigos_barras (
  codigo       text primary key check (codigo ~ '^[0-9A-Za-z.-]{4,40}$'),
  producto_id  uuid not null references public.productos (id),
  creado_por   uuid default auth.uid() references public.perfiles (id),
  creado_en    timestamptz not null default now()
);
create index codigos_barras_producto_idx on public.codigos_barras (producto_id);
comment on table public.codigos_barras is 'EAN/UPC de cada presentación: se aprende la primera vez que alguien lo escanea y elige el producto.';
create trigger codigos_barras_inmutable before update or delete on public.codigos_barras
  for each row execute function privado.bloquear_cambios();
alter table public.codigos_barras enable row level security;
revoke all on public.codigos_barras from anon;
revoke insert, update, delete, truncate on public.codigos_barras from authenticated;
create policy codigos_barras_leer on public.codigos_barras for select to authenticated using (true);

create or replace function public.producto_por_codigo(p_codigo text)
returns table (producto_id uuid, codigo text, generico text, marca text, presentacion text, area public.area_app)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.codigo, g.nombre, p.marca, p.presentacion, g.area
    from public.codigos_barras cb
    join public.productos p on p.id = cb.producto_id
    join public.genericos g on g.id = p.generico_id
   where cb.codigo = trim(p_codigo) and p.activo and g.activo and auth.uid() is not null
$$;

create or replace function public.asociar_codigo_barras(p_codigo text, p_producto uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_codigo text := trim(p_codigo);
  v_area public.area_app; v_nombre text; v_otro text;
begin
  select g.area, g.nombre || coalesce(nullif(' · ' || p.presentacion, ' · '), '') into v_area, v_nombre
    from public.productos p join public.genericos g on g.id = p.generico_id
   where p.id = p_producto and p.activo and g.activo;
  if v_area is null then return jsonb_build_object('ok', false, 'error', 'El producto no existe o está dado de baja.'); end if;
  if not privado.puede_operar(v_area) then
    raise exception 'Sin permiso para registrar códigos en %.', v_area using errcode = '42501';
  end if;
  if v_codigo !~ '^[0-9A-Za-z.-]{4,40}$' then
    return jsonb_build_object('ok', false, 'error', 'Ese código no parece un código de barras.');
  end if;
  select g.nombre into v_otro from public.codigos_barras cb join public.productos p on p.id = cb.producto_id
    join public.genericos g on g.id = p.generico_id where cb.codigo = v_codigo;
  if v_otro is not null then
    return jsonb_build_object('ok', false, 'error', 'Ese código ya es de ' || v_otro || '. Si está mal, avísale a administración.');
  end if;
  insert into public.codigos_barras (codigo, producto_id) values (v_codigo, p_producto);
  perform privado.bitacora('CÓDIGO DE BARRAS ASOCIADO', 'codigos_barras', v_codigo, jsonb_build_object('producto', v_nombre));
  return jsonb_build_object('ok', true, 'producto', v_nombre);
end
$$;

-- ---------------------------------------------------------------- Hoy
create or replace function public.resumen_hoy()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hoy date := privado.hoy();
  v_aviso integer := privado.parametro_num('DIAS_AVISO_VENCE', 2)::integer;
  v_areas jsonb := '[]';
  a public.area_app;
  v_prog jsonb := '[]';
  v_vence jsonb; v_o jsonb;
begin
  if auth.uid() is null then raise exception 'Sin sesión.' using errcode = '42501'; end if;
  if exists (select 1 from public.ubicaciones u where u.activo and privado.puede_operar(u.area)) then
    select coalesce(jsonb_agg(to_jsonb(cp)), '[]') into v_prog from public.conteos_programados() cp;
  end if;
  foreach a in array array['BAR', 'COCINA']::public.area_app[] loop
    continue when not (privado.opera_en(a) or privado.tiene_rol('admin', 'auditor'));
    -- MPI con saldo cuyo último lote vence pronto (el kardex no separa por lote: se mira el más reciente)
    select coalesce(jsonb_agg(x order by x ->> 'vence'), '[]') into v_vence from (
      select jsonb_build_object('producto', g.nombre, 'lote', l.codigo, 'lote_id', l.id,
                                'vence', l.fecha + g.vida_util_dias) as x
        from public.genericos g
        join public.productos p on p.generico_id = g.id and p.activo
        join lateral (select lp.id, lp.codigo, lp.fecha from public.lotes_produccion lp
                       where lp.producto_id = p.id order by lp.fecha desc, lp.registrado_en desc limit 1) l on true
       where g.area = a and g.tipo = 'MPI' and g.vida_util_dias is not null
         and (select coalesce(sum(e.cantidad), 0) from public.existencias e where e.producto_id = p.id) > 0
         and l.fecha + g.vida_util_dias <= v_hoy + v_aviso
       limit 20) t;
    v_o := jsonb_build_object(
      'area', a,
      'conteo_tocan', (select coalesce(sum((x ->> 'tocan')::int), 0) from jsonb_array_elements(v_prog) x where x ->> 'area' = a::text),
      'conteo_zonas', (select count(*) from jsonb_array_elements(v_prog) x where x ->> 'area' = a::text and (x ->> 'tocan')::int > 0),
      'recepciones_hoy', (select count(*) from public.recepciones r where r.area = a and r.fecha = v_hoy),
      'lotes_hoy', (select count(*) from public.lotes_produccion l where l.area = a and l.fecha = v_hoy),
      'por_vencer', v_vence,
      'bajo_minimo', (select count(*) from public.productos p join public.genericos g on g.id = p.generico_id
                       where g.area = a and p.activo and p.stock_minimo is not null and p.contenido_base > 0
                         and exists (select 1 from public.movimientos m where m.producto_id = p.id)
                         and (select coalesce(sum(e.cantidad), 0) from public.existencias e where e.producto_id = p.id) / p.contenido_base <= p.stock_minimo),
      'lotes_sin_costo', (select count(*) from public.lotes_produccion l where l.area = a and l.estado_costo <> 'COMPLETO'
                            and l.fecha >= v_hoy - 30),
      'kardex', exists (select 1 from public.movimientos m join public.ubicaciones u on u.codigo = m.ubicacion where u.area = a));
    if privado.edita_area(a) then
      v_o := v_o || jsonb_build_object(
        'provisionales', (select count(*) from public.productos p join public.genericos g on g.id = p.generico_id
                           where g.area = a and p.activo and p.estado = 'PROVISIONAL'),
        'pares', (select count(*) from public.revision_catalogo r where r.area = a and r.decision is null),
        'propuestas', (select count(*) from public.propuestas_unidad pu join public.productos p on p.id = pu.producto_id
                        join public.genericos g on g.id = p.generico_id where g.area = a and pu.estado = 'PENDIENTE'),
        'carta_sin_precio', (select count(*) from public.genericos g where g.area = a and g.activo and g.tipo in ('BEBIDA', 'PLATO')
                              and not exists (select 1 from public.precios_venta pv where pv.generico_id = g.id)));
    end if;
    v_areas := v_areas || v_o;
  end loop;
  return jsonb_build_object('hoy', v_hoy, 'areas', v_areas,
    'errores_semana', case when privado.tiene_rol('admin') then
      (select count(*) from public.errores_app e where e.ocurrido_en >= now() - interval '7 days') end);
end
$$;

-- ---------------------------------------------------------------- carta: costo, precio y margen
create or replace function public.carta_costos(p_area public.area_app)
returns table (generico_id uuid, nombre text, tipo public.tipo_generico, carta text, ficha_codigo text,
               lineas integer, lineas_con_costo integer, faltantes text[], costo numeric,
               precio numeric, precio_desde date, pct_costo numeric, margen numeric)
language plpgsql stable security definer set search_path = ''
as $$
declare v_imp numeric := 1 + privado.parametro_num('IMPOCONSUMO_PCT', 8) / 100;
begin
  if not privado.ve_area(p_area) then
    raise exception 'Sin permiso para ver los costos de %.', p_area using errcode = '42501';
  end if;
  return query
  select g.id, g.nombre, g.tipo, nullif(trim(substring(g.nota from 'Carta: ([^·]+)')), ''), f.codigo,
         coalesce(t.lineas, 0), coalesce(t.con_costo, 0), coalesce(t.faltantes, '{}'), t.total,
         pv.precio_con_impuesto, pv.vigente_desde,
         case when t.lineas > 0 and t.lineas = t.con_costo and pv.precio_con_impuesto > 0
              then round(t.total / (pv.precio_con_impuesto / v_imp) * 100, 1) end,
         case when t.lineas > 0 and t.lineas = t.con_costo and pv.precio_con_impuesto > 0
              then round(pv.precio_con_impuesto / v_imp - t.total) end
    from public.genericos g
    left join public.fichas f on f.id = privado.ficha_vigente(g.id)
    left join lateral (
      select count(*)::int as lineas, count(*) filter (where c.falta is null)::int as con_costo,
             round(coalesce(sum(c.costo), 0)) as total, array_remove(array_agg(c.falta order by c.linea), null) as faltantes
        from public.costo_ficha(f.id) c) t on f.id is not null
    left join lateral (
      select v.precio_con_impuesto, v.vigente_desde from public.precios_venta v
       where v.generico_id = g.id and v.vigente_desde <= privado.hoy()
       order by v.vigente_desde desc limit 1) pv on true
   where g.area = p_area and g.activo and g.tipo in ('BEBIDA', 'PLATO')
   order by g.nombre;
end
$$;

create or replace function public.fijar_precio(p_generico uuid, p_precio numeric)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_g record; v_hoy date := privado.hoy(); v_actual numeric;
begin
  select g.id, g.area, g.nombre, g.tipo into v_g from public.genericos g where g.id = p_generico and g.activo;
  if v_g.id is null or v_g.tipo not in ('BEBIDA', 'PLATO') then
    return jsonb_build_object('ok', false, 'error', 'Solo los cócteles y platos tienen precio de carta.');
  end if;
  if not privado.edita_area(v_g.area) then
    raise exception 'Sin permiso para cambiar precios de %.', v_g.area using errcode = '42501';
  end if;
  if p_precio is null or p_precio <= 0 or p_precio > 10000000 then
    return jsonb_build_object('ok', false, 'error', 'Precio no válido.');
  end if;
  select pv.precio_con_impuesto into v_actual from public.precios_venta pv where pv.generico_id = p_generico and pv.vigente_desde = v_hoy;
  if v_actual is not null then
    -- los precios tienen historia y no se editan: uno por día
    return jsonb_build_object('ok', false, 'error', 'El precio de ' || v_g.nombre || ' ya se fijó hoy en $' || to_char(v_actual, 'FM999G999G999')
                              || '. El cambio se puede hacer desde mañana.');
  end if;
  insert into public.precios_venta (generico_id, precio_con_impuesto, vigente_desde) values (p_generico, round(p_precio), v_hoy);
  perform privado.bitacora('PRECIO DE CARTA', 'precios_venta', v_g.nombre, jsonb_build_object('precio', round(p_precio)));
  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------- pedido sugerido
create or replace function public.pedido_sugerido(p_area public.area_app)
returns table (producto_id uuid, codigo text, generico text, marca text, presentacion text, unidad_compra text,
               saldo_unidades numeric, minimo numeric, maximo numeric, pedir numeric, tiene_kardex boolean,
               proveedor text, ultima_compra date, costo_unidad numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (privado.puede_operar(p_area) or privado.ve_area(p_area)) then
    raise exception 'Sin permiso para ver el pedido de %.', p_area using errcode = '42501';
  end if;
  return query
  with base as (
    select p.id, p.codigo, g.nombre, p.marca, p.presentacion, p.unidad_compra, p.contenido_base, p.stock_minimo, p.stock_maximo,
           round(coalesce((select sum(e.cantidad) from public.existencias e where e.producto_id = p.id), 0) / p.contenido_base, 2) as unidades,
           exists (select 1 from public.movimientos m where m.producto_id = p.id) as kardex
      from public.productos p join public.genericos g on g.id = p.generico_id
     where g.area = p_area and p.activo and g.activo and p.stock_minimo is not null and p.contenido_base > 0
  ), ultima as (
    -- última compra: la de la app, si no la del histórico de los Sheets
    select b.id, u.proveedor, u.fecha, u.cu
      from base b
      left join lateral (
        select x.proveedor, x.fecha, x.cu from (
          select pr.nombre as proveedor, r.fecha, rl.costo_unitario_base * b.contenido_base as cu, 1 as prioridad
            from public.recepcion_lineas rl join public.recepciones r on r.id = rl.recepcion_id
            join public.proveedores pr on pr.id = r.proveedor_id
           where rl.producto_id = b.id and rl.costo_unitario_base > 0
          union all
          select ch.proveedor, ch.fecha, ch.costo_unitario_base * b.contenido_base, 2
            from public.compras_historicas ch where ch.producto_id = b.id and ch.computable
        ) x order by x.prioridad, x.fecha desc limit 1) u on true
  )
  select b.id, b.codigo, b.nombre, b.marca, b.presentacion, b.unidad_compra, b.unidades, b.stock_minimo, b.stock_maximo,
         greatest(ceil(coalesce(b.stock_maximo, b.stock_minimo * 2) - b.unidades), 1), b.kardex,
         u.proveedor, u.fecha, case when privado.ve_costos() then round(u.cu) end
    from base b left join ultima u on u.id = b.id
   where b.unidades <= b.stock_minimo
   order by u.proveedor nulls last, b.nombre, b.presentacion;
end
$$;

-- ---------------------------------------------------------------- etiqueta de lote
create or replace function public.lote_etiqueta(p_codigo text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb; v_area public.area_app;
begin
  select l.area into v_area from public.lotes_produccion l where l.codigo = trim(p_codigo);
  if v_area is null then return null; end if;
  if not (privado.opera_en(v_area) or privado.tiene_rol('admin', 'auditor')) then
    raise exception 'Sin permiso para ver lotes de %.', v_area using errcode = '42501';
  end if;
  select jsonb_build_object(
           'id', l.id, 'codigo', l.codigo, 'area', l.area, 'fecha', l.fecha, 'producto_id', l.producto_id,
           'mpi', g.nombre, 'unidad', g.unidad_base, 'neto', l.neto_base, 'unidades', l.unidades,
           'vence', case when g.vida_util_dias is not null then l.fecha + g.vida_util_dias end,
           'conservacion', g.conservacion, 'zona', u.nombre, 'responsable', pe.nombre,
           'costo_unitario', case when privado.ve_costos() then l.costo_unitario end, 'estado_costo', l.estado_costo,
           'anulado', exists (select 1 from public.anulaciones an where an.documento_tipo = 'LOTE' and an.documento_id = l.id))
    into v
    from public.lotes_produccion l
    join public.productos p on p.id = l.producto_id
    join public.genericos g on g.id = p.generico_id
    join public.ubicaciones u on u.codigo = l.ubicacion
    join public.perfiles pe on pe.id = l.responsable_id
   where l.codigo = trim(p_codigo);
  return v;
end
$$;

revoke execute on function public.producto_por_codigo(text), public.asociar_codigo_barras(text, uuid), public.resumen_hoy(),
  public.carta_costos(public.area_app), public.fijar_precio(uuid, numeric), public.pedido_sugerido(public.area_app),
  public.lote_etiqueta(text) from public, anon;
grant execute on function public.producto_por_codigo(text), public.asociar_codigo_barras(text, uuid), public.resumen_hoy(),
  public.carta_costos(public.area_app), public.fijar_precio(uuid, numeric), public.pedido_sugerido(public.area_app),
  public.lote_etiqueta(text) to authenticated;
