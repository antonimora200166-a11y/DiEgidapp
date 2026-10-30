-- =====================================================================================
-- SGI Di Égida · 16 · Historial de documentos y su detalle
-- public.historial_documentos: recepciones, lotes, bajas, traslados y conteos de un área en una
--   sola lista, del más reciente al más antiguo, con su valor, quién lo registró y si se anuló.
-- public.detalle_documento: el encabezado y las líneas de uno, y si quien consulta puede anularlo.
-- Solo leen. Anular sigue siendo public.anular_documento (reversa en el kardex, nada se borra).
-- Ven quienes ven costos y operan en el área; admin y auditoría ven todo.
-- =====================================================================================

create or replace function privado.ve_area(p_area public.area_app)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select privado.ve_costos() and (privado.opera_en(p_area) or privado.tiene_rol('admin', 'auditor'))
$$;

create or replace function privado.puede_anular(p_area public.area_app)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select privado.tiene_rol('admin') or (p_area = 'BAR' and privado.tiene_rol('jefe_bar'))
      or (p_area = 'COCINA' and privado.tiene_rol('chef'))
$$;

-- Valor de un documento: Σ |costo| de sus movimientos originales (sin reversas). En un traslado
-- cuenta solo la salida; en un lote, la entrada del MPI.
create or replace function privado.valor_documento(p_tipo text, p_id uuid)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select sum(abs(m.costo_total)) from public.movimientos m
   where m.documento_tipo = p_tipo and m.documento_id = p_id and m.tipo <> 'REVERSA'
     and m.tipo not in ('TRASLADO_ENTRADA', 'SALIDA_A_PRODUCCION')
$$;

create or replace function public.historial_documentos(p_area public.area_app, p_tipo text default null,
                                                       p_limite integer default 60)
returns table (tipo text, id uuid, codigo text, fecha date, registrado_en timestamptz, detalle text,
               lineas integer, valor numeric, usuario text, forzado boolean, anulado boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.ve_area(p_area) then
    raise exception 'Sin permiso para ver los documentos de %.', p_area using errcode = '42501';
  end if;
  return query
  with docs as (
    select 'RECEPCION'::text as tipo, r.id, r.codigo, r.fecha, r.registrado_en,
           pr.nombre || coalesce(' · ' || r.documento, '') as detalle,
           (select count(*)::int from public.recepcion_lineas l where l.recepcion_id = r.id) as lineas,
           r.usuario_id, r.forzada as forzado
      from public.recepciones r join public.proveedores pr on pr.id = r.proveedor_id
     where r.area = p_area
    union all
    select 'LOTE', l.id, l.codigo, l.fecha, l.registrado_en,
           g.nombre || ' · ' || trim(to_char(l.neto_base, 'FM999G999G990D##')) || ' ' || g.unidad_base,
           (select count(*)::int from public.lote_consumos c where c.lote_id = l.id), l.usuario_id, l.forzado
      from public.lotes_produccion l join public.productos p on p.id = l.producto_id join public.genericos g on g.id = p.generico_id
     where l.area = p_area
    union all
    select 'BAJA', b.id, b.codigo, b.fecha, b.registrado_en,
           initcap(replace(replace(b.causa, 'DANADO', 'DAÑADO'), '_', ' ')) || ' · ' || u.nombre,
           (select count(*)::int from public.baja_lineas x where x.baja_id = b.id), b.usuario_id, b.forzada
      from public.bajas b join public.ubicaciones u on u.codigo = b.ubicacion
     where b.area = p_area
    union all
    select 'TRASLADO', t.id, t.codigo, t.fecha, t.registrado_en, uo.nombre || ' → ' || ud.nombre,
           (select count(*)::int from public.traslado_lineas x where x.traslado_id = t.id), t.usuario_id, t.forzado
      from public.traslados t
      join public.ubicaciones uo on uo.codigo = t.origen
      join public.ubicaciones ud on ud.codigo = t.destino
     where uo.area = p_area or ud.area = p_area
    union all
    select 'CONTEO', c.id, c.codigo, c.fecha, c.registrado_en,
           case when c.tipo = 'INICIAL' then 'Inicial · ' else '' end || u.nombre,
           (select count(*)::int from public.conteo_lineas x where x.conteo_id = c.id), c.usuario_id, false
      from public.conteos c join public.ubicaciones u on u.codigo = c.ubicacion
     where u.area = p_area
  )
  select d.tipo, d.id, d.codigo, d.fecha, d.registrado_en, d.detalle, d.lineas,
         privado.valor_documento(d.tipo, d.id), pe.nombre, d.forzado,
         exists (select 1 from public.anulaciones an where an.documento_tipo = d.tipo and an.documento_id = d.id and an.linea_id is null)
    from docs d left join public.perfiles pe on pe.id = d.usuario_id
   where p_tipo is null or d.tipo = upper(p_tipo)
   order by d.registrado_en desc
   limit least(greatest(coalesce(p_limite, 60), 1), 300);
end
$$;

create or replace function public.detalle_documento(p_tipo text, p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tipo text := upper(p_tipo);
  v_area public.area_app;
  v_enc  jsonb;
  v_lin  jsonb;
begin
  case v_tipo
    when 'RECEPCION' then
      select r.area, jsonb_build_object('codigo', r.codigo, 'fecha', r.fecha, 'zona', u.nombre, 'proveedor', pr.nombre,
               'documento', r.documento, 'soporte', r.tipo_soporte, 'con_foto', r.soporte_ruta is not null,
               'observaciones', r.observaciones, 'motivo_forzado', r.motivo_forzado, 'avisos', to_jsonb(r.avisos),
               'recibe', (select pe.nombre from public.perfiles pe where pe.id = r.recibe_id))
        into v_area, v_enc
        from public.recepciones r join public.proveedores pr on pr.id = r.proveedor_id join public.ubicaciones u on u.codigo = r.ubicacion
       where r.id = p_id;
      select jsonb_agg(jsonb_build_object('id', l.id, 'linea', l.linea, 'producto', g.nombre || coalesce(nullif(' · ' || p.marca, ' · '), ''),
               'presentacion', p.presentacion, 'unidad_base', g.unidad_base, 'unidad_compra', p.unidad_compra,
               'pedida', l.cantidad_pedida, 'recibida', l.cantidad_recibida, 'cantidad_base', l.cantidad_base,
               'valor', l.valor_total, 'costo_unitario', l.costo_unitario_base, 'condicion', l.condicion, 'sello', l.sello,
               'temperatura', l.temperatura, 'vencimiento', l.vencimiento, 'hallazgos', to_jsonb(l.hallazgos),
               'observaciones', l.observaciones, 'origen', l.origen,
               'anulada', exists (select 1 from public.anulaciones an where an.documento_tipo = 'RECEPCION'
                                   and an.documento_id = p_id and an.linea_id = l.id)) order by l.linea)
        into v_lin
        from public.recepcion_lineas l join public.productos p on p.id = l.producto_id join public.genericos g on g.id = p.generico_id
       where l.recepcion_id = p_id;
    when 'LOTE' then
      select l.area, jsonb_build_object('codigo', l.codigo, 'fecha', l.fecha, 'zona', u.nombre, 'producto', g.nombre,
               'unidad_base', g.unidad_base, 'neto', l.neto_base, 'entrada', l.entrada_base, 'rendimiento', l.rendimiento,
               'rendimiento_ficha', l.rendimiento_ficha, 'costo_total', l.costo_total, 'costo_unitario', l.costo_unitario,
               'estado_costo', l.estado_costo, 'unidades', l.unidades, 'tiempo_min', l.tiempo_min,
               'ficha', (select f.codigo from public.fichas f where f.id = l.ficha_id),
               'observaciones', l.observaciones, 'motivo_forzado', l.motivo_forzado, 'avisos', to_jsonb(l.avisos),
               'responsable', (select pe.nombre from public.perfiles pe where pe.id = l.responsable_id))
        into v_area, v_enc
        from public.lotes_produccion l join public.productos p on p.id = l.producto_id join public.genericos g on g.id = p.generico_id
        join public.ubicaciones u on u.codigo = l.ubicacion
       where l.id = p_id;
      select jsonb_agg(jsonb_build_object('linea', c.linea, 'producto', g.nombre || coalesce(nullif(' · ' || p.marca, ' · '), ''),
               'cantidad', c.cantidad, 'unidad', c.unidad, 'cantidad_base', c.cantidad_base, 'unidad_base', g.unidad_base,
               'costo_unitario', c.costo_unitario, 'costo', c.costo, 'nota', c.nota) order by c.linea)
        into v_lin
        from public.lote_consumos c join public.productos p on p.id = c.producto_id join public.genericos g on g.id = p.generico_id
       where c.lote_id = p_id;
    when 'BAJA' then
      select b.area, jsonb_build_object('codigo', b.codigo, 'fecha', b.fecha, 'zona', u.nombre, 'causa', b.causa,
               'observaciones', b.observaciones, 'motivo_forzado', b.motivo_forzado)
        into v_area, v_enc
        from public.bajas b join public.ubicaciones u on u.codigo = b.ubicacion where b.id = p_id;
      select jsonb_agg(jsonb_build_object('linea', x.linea, 'producto', g.nombre || coalesce(nullif(' · ' || p.marca, ' · '), ''),
               'presentacion', p.presentacion, 'cantidad_base', x.cantidad_base, 'unidad_base', g.unidad_base,
               'costo', abs(m.costo_total)) order by x.linea)
        into v_lin
        from public.baja_lineas x join public.productos p on p.id = x.producto_id join public.genericos g on g.id = p.generico_id
        left join public.movimientos m on m.id = x.movimiento_id
       where x.baja_id = p_id;
    when 'TRASLADO' then
      select uo.area, jsonb_build_object('codigo', t.codigo, 'fecha', t.fecha, 'origen', uo.nombre, 'destino', ud.nombre,
               'observaciones', t.observaciones, 'motivo_forzado', t.motivo_forzado)
        into v_area, v_enc
        from public.traslados t join public.ubicaciones uo on uo.codigo = t.origen join public.ubicaciones ud on ud.codigo = t.destino
       where t.id = p_id;
      select jsonb_agg(jsonb_build_object('linea', x.linea, 'producto', g.nombre || coalesce(nullif(' · ' || p.marca, ' · '), ''),
               'presentacion', p.presentacion, 'cantidad_base', x.cantidad_base, 'unidad_base', g.unidad_base,
               'costo', abs(m.costo_total)) order by x.linea)
        into v_lin
        from public.traslado_lineas x join public.productos p on p.id = x.producto_id join public.genericos g on g.id = p.generico_id
        left join public.movimientos m on m.id = x.mov_salida_id
       where x.traslado_id = p_id;
    when 'CONTEO' then
      select u.area, jsonb_build_object('codigo', c.codigo, 'fecha', c.fecha, 'zona', u.nombre, 'tipo_conteo', c.tipo,
               'observaciones', c.observaciones,
               'responsable', (select pe.nombre from public.perfiles pe where pe.id = c.responsable_id))
        into v_area, v_enc
        from public.conteos c join public.ubicaciones u on u.codigo = c.ubicacion where c.id = p_id;
      select jsonb_agg(jsonb_build_object('linea', x.linea, 'producto', g.nombre || coalesce(nullif(' · ' || p.marca, ' · '), ''),
               'presentacion', p.presentacion, 'unidad_base', g.unidad_base, 'contada', x.cantidad_contada,
               'teorico', x.saldo_teorico, 'diferencia', x.diferencia, 'costo', m.costo_total) order by x.linea)
        into v_lin
        from public.conteo_lineas x join public.productos p on p.id = x.producto_id join public.genericos g on g.id = p.generico_id
        left join public.movimientos m on m.id = x.movimiento_id
       where x.conteo_id = p_id;
    else raise exception 'Tipo de documento no válido: %', p_tipo;
  end case;
  if v_enc is null then raise exception 'No existe el documento % %.', v_tipo, p_id; end if;
  if not privado.ve_area(v_area) then
    raise exception 'Sin permiso para ver los documentos de %.', v_area using errcode = '42501';
  end if;

  return jsonb_build_object(
    'tipo', v_tipo, 'id', p_id, 'area', v_area, 'encabezado', v_enc, 'lineas', coalesce(v_lin, '[]'),
    'valor', privado.valor_documento(v_tipo, p_id),
    'registrado', (select jsonb_build_object('usuario', pe.nombre, 'en', d.registrado_en)
                     from (select r.usuario_id, r.registrado_en from public.recepciones r where v_tipo = 'RECEPCION' and r.id = p_id
                           union all select l.usuario_id, l.registrado_en from public.lotes_produccion l where v_tipo = 'LOTE' and l.id = p_id
                           union all select b.usuario_id, b.registrado_en from public.bajas b where v_tipo = 'BAJA' and b.id = p_id
                           union all select t.usuario_id, t.registrado_en from public.traslados t where v_tipo = 'TRASLADO' and t.id = p_id
                           union all select c.usuario_id, c.registrado_en from public.conteos c where v_tipo = 'CONTEO' and c.id = p_id) d
                     left join public.perfiles pe on pe.id = d.usuario_id),
    'anulacion', (select jsonb_build_object('motivo', an.motivo, 'en', an.anulado_en, 'usuario', pe.nombre)
                    from public.anulaciones an left join public.perfiles pe on pe.id = an.usuario_id
                   where an.documento_tipo = v_tipo and an.documento_id = p_id and an.linea_id is null),
    'puede_anular', privado.puede_anular(v_area));
end
$$;

revoke execute on function privado.ve_area(public.area_app), privado.puede_anular(public.area_app),
                           privado.valor_documento(text, uuid) from public;
revoke execute on function public.historial_documentos(public.area_app, text, integer), public.detalle_documento(text, uuid) from public, anon;
grant execute on function public.historial_documentos(public.area_app, text, integer), public.detalle_documento(text, uuid) to authenticated;
