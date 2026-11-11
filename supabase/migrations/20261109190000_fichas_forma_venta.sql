-- =====================================================================================
-- SGI Di Égida · Fichas por forma de venta (07/11/2026)
-- La lista de fichas del bar trae, además de los cócteles, unas 130 fichas automáticas de una
-- línea (botellas, shots, copas y reventa). lista_fichas devuelve la forma de venta para que la
-- pantalla pueda filtrarlas y agruparlas aparte. El cuerpo es el de 20261101180000_velocidad con
-- el filtro del baúl de 20261108120000_baul_carta («not g.en_baul»).
-- =====================================================================================

drop function if exists public.lista_fichas(public.area_app);
create function public.lista_fichas(p_area public.area_app)
returns table (generico_id uuid, nombre text, tipo public.tipo_generico, unidad_base public.unidad_base,
               ficha_id uuid, codigo text, version integer, neto_esperado numeric, lineas integer, faltan integer,
               primer_falta text, lotes integer, forma_venta text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.ve_costos() or not (privado.opera_en(p_area) or privado.tiene_rol('admin', 'auditor')) then
    raise exception 'Sin permiso para ver las fichas de %.', p_area using errcode = '42501';
  end if;
  return query
  select g.id, g.nombre, g.tipo, g.unidad_base, f.id, f.codigo, f.version, f.neto_esperado,
         coalesce(x.lineas, 0), coalesce(x.faltan, 0), x.primer_falta,
         (select count(*)::int from public.lotes_produccion lp where lp.ficha_id = f.id),
         g.forma_venta
    from public.genericos g
    left join public.fichas f on f.id = privado.ficha_vigente(g.id)
    left join lateral (
      select count(*)::int as lineas,
             count(*) filter (where c.falta like 'La ficha no trae cantidad%' or c.falta like 'Falta la conversión%')::int as faltan,
             (array_agg(c.falta order by c.linea)
                filter (where c.falta like 'La ficha no trae cantidad%' or c.falta like 'Falta la conversión%'))[1] as primer_falta
        from public.costo_ficha(f.id) c
    ) x on f.id is not null
   where g.area = p_area and g.activo and not g.en_baul and g.tipo in ('MPI', 'BEBIDA', 'PLATO')
   order by g.tipo, f.codigo nulls last, g.nombre;
end
$$;

revoke execute on function public.lista_fichas(public.area_app) from public, anon;
grant execute on function public.lista_fichas(public.area_app) to authenticated;
