-- =====================================================================================
-- SGI Di Égida · Velocidad
-- · lista_fichas: calcula el costo de cada ficha una sola vez (antes, dos por fila: 546 ms en bar).
-- · Índices para las relaciones que crecen con el kardex (líneas de documentos por producto,
--   saldos y movimientos por zona, alias por genérico). Con el kardex vacío no se nota; con
--   meses de movimientos, sin ellos cada pantalla recorre la tabla entera.
-- =====================================================================================

create or replace function public.lista_fichas(p_area public.area_app)
returns table (generico_id uuid, nombre text, tipo public.tipo_generico, unidad_base public.unidad_base,
               ficha_id uuid, codigo text, version integer, neto_esperado numeric, lineas integer, faltan integer,
               primer_falta text, lotes integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.ve_costos() or not (privado.opera_en(p_area) or privado.tiene_rol('admin', 'auditor')) then
    raise exception 'Sin permiso para ver las fichas de %.', p_area using errcode = '42501';
  end if;
  return query
  select g.id, g.nombre, g.tipo, g.unidad_base, f.id, f.codigo, f.version, f.neto_esperado,
         coalesce(x.lineas, 0), coalesce(x.faltan, 0), x.primer_falta,
         (select count(*)::int from public.lotes_produccion lp where lp.ficha_id = f.id)
    from public.genericos g
    left join public.fichas f on f.id = privado.ficha_vigente(g.id)
    left join lateral (
      select count(*)::int as lineas,
             count(*) filter (where c.falta like 'La ficha no trae cantidad%' or c.falta like 'Falta la conversión%')::int as faltan,
             (array_agg(c.falta order by c.linea)
                filter (where c.falta like 'La ficha no trae cantidad%' or c.falta like 'Falta la conversión%'))[1] as primer_falta
        from public.costo_ficha(f.id) c
    ) x on f.id is not null
   where g.area = p_area and g.activo and g.tipo in ('MPI', 'BEBIDA', 'PLATO')
   order by g.tipo, f.codigo nulls last, g.nombre;
end
$$;

create index if not exists conteo_lineas_producto_idx     on public.conteo_lineas (producto_id);
create index if not exists recepcion_lineas_producto_idx  on public.recepcion_lineas (producto_id);
create index if not exists lote_consumos_producto_idx     on public.lote_consumos (producto_id);
create index if not exists baja_lineas_producto_idx       on public.baja_lineas (producto_id);
create index if not exists traslado_lineas_producto_idx   on public.traslado_lineas (producto_id);
create index if not exists lotes_produccion_producto_idx  on public.lotes_produccion (producto_id);
create index if not exists lotes_produccion_ficha_idx     on public.lotes_produccion (ficha_id);
create index if not exists existencias_ubicacion_idx      on public.existencias (ubicacion);
create index if not exists movimientos_ubicacion_idx      on public.movimientos (ubicacion);
create index if not exists conteos_ubicacion_idx          on public.conteos (ubicacion, fecha desc);
create index if not exists ficha_lineas_generico_idx      on public.ficha_lineas (generico_id);
create index if not exists alias_generico_idx             on public.alias (generico_id);
create index if not exists ubicacion_productos_producto_idx on public.ubicacion_productos (producto_id);
