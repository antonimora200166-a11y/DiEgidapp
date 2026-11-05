-- =====================================================================================
-- SGI Di Égida · 46 · Costo estimado de fichas mientras no hay kardex (Anthony, 06/11/2026)
-- El costo de una ficha salía solo del kardex y el bar aún no tiene movimientos: ninguna MPI ni
-- cóctel mostraba costo. Además a las fichas les faltaba lo que rinde cada MPI y varias
-- conversiones (zumos y siropes en ml que se guardan en g, frutas «por unidad»). Aquí:
--   1. Conversiones PROPUESTAS (estado SUPUESTO) para lo que las fichas piden en otra unidad:
--      densidades por tipo (zumo 1,04 · sirope 1,30 · miel 1,42 …), peso por unidad de frutas y
--      el contenido de la presentación para «bot / lata / und». Quien mida, la corrige.
--   2. Neto esperado de las MPI que no lo tienen: suma de la receta × rendimiento mediano del
--      registro de producción (lotes_historicos); sin registro, la suma de la receta. Queda en la
--      nota de la ficha de dónde salió, para que el jefe de barra lo confirme.
--   3. Costo estimado: sin kardex, un insumo usa su costo de referencia y una MPI el costo de su
--      propia receta entre su neto (hasta 5 niveles). public.costo_ficha lo usa; la pantalla lo
--      marca como «estimado». En cuanto haya kardex, manda el kardex. Nada de esto entra al kardex.
-- =====================================================================================

-- ---------------------------------------------------------------- 1. conversiones propuestas
-- densidad aproximada (g por ml) según el nombre del genérico
create or replace function privado.densidad_estimada(p_nombre text)
returns numeric language sql immutable set search_path = ''
as $$
  select case
    when n ~ '(^| )miel( de abeja| de abejas)?($| )' and n !~ 'agave' then 1.42
    when n ~ '(leche condensada)' then 1.30
    when n ~ '(sirope|syrup|jarabe|miel de agave|agave|grenadina|chamoy)' then 1.30
    when n ~ '(picadillo y sirope)' then 1.25
    when n ~ '(almibar)' then 1.05
    when n ~ '(zumo|jugo|pulpa|mix de citricos|horchata|leche evaporada|leche)' then 1.04
    when n ~ '(licor|te de|infusion|agua|tonica|soda|ginger|vino|vermouth|aperitivo)' then 1.00
    else null end
  from (select privado.normalizar(p_nombre) as n) x
$$;

-- peso aproximado (g) de una unidad, según el nombre
create or replace function privado.peso_unidad_estimado(p_nombre text)
returns numeric language sql immutable set search_path = ''
as $$
  select case
    when n ~ 'pina' then 1500
    when n ~ '(melon|sandia|patilla)' then 1500
    when n ~ 'mango' then 300
    when n ~ '(naranja|toronja)' then 200
    when n ~ '(manzana|pera)' then 180
    when n ~ 'mandarina' then 120
    when n ~ '(lulo|granadilla)' then 100
    when n ~ 'maracuya' then 90
    when n ~ 'kiwi' then 75
    when n ~ 'limon' then 60
    when n ~ 'fresa' then 15
    when n ~ 'lychee' then 15
    when n ~ 'uchuva' then 5
    when n ~ 'aceituna' then 4
    when n ~ 'canela' then 3
    when n ~ 'clavo' then 0.1
    else null end
  from (select privado.normalizar(p_nombre) as n) x
$$;

with faltan as (
  select distinct g.id, g.nombre, g.unidad_base::text as ub, lower(trim(l.unidad)) as u
    from public.ficha_lineas l
    join public.fichas f on f.id = l.ficha_id and (f.vigente_hasta is null or f.vigente_hasta >= current_date)
    join public.genericos g on g.id = l.generico_id
   where l.cantidad is not null and l.unidad is not null
     and lower(trim(l.unidad)) ~ '^[a-z]+$'
     and lower(trim(l.unidad)) not in ('dash', 'gts', 'gota', 'todo')
     and privado.a_base(g.id, l.cantidad, l.unidad) is null
),
propuesta as (
  select fa.*,
         case
           when fa.u = 'ml' and fa.ub = 'g' then privado.densidad_estimada(fa.nombre)
           when fa.u = 'g' and fa.ub = 'ml' then round(1 / nullif(privado.densidad_estimada(fa.nombre), 0), 4)
           when fa.u = 'cda' and fa.ub = 'g' then case when privado.normalizar(fa.nombre) ~ 'acido' then 12 else 15 end
           when fa.u = 'cda' and fa.ub = 'ml' then 15
           when fa.u = 'bola' then 60
           when fa.u = 'casco' then 15
           when fa.u in ('bot', 'lata', 'und', 'unidad') then coalesce(
             (select p.contenido_base from public.productos p
               where p.generico_id = fa.id and p.activo and not p.contenido_variable and p.contenido_base > 1
               order by p.contenido_base, p.codigo limit 1),   -- la presentación más chica: la de una porción
             case when fa.ub = 'g' then privado.peso_unidad_estimado(fa.nombre) end)
         end as factor
    from faltan fa
)
insert into public.conversiones (generico_id, unidad, factor_a_base, estado, medido_en, nota)
select id, u, factor, 'SUPUESTO', current_date,
       'Propuesta automática (06/11/2026) para costear las fichas: confírmala midiendo.'
  from propuesta where factor > 0
on conflict (generico_id, unidad) do nothing;

-- ---------------------------------------------------------------- 2. neto esperado de las MPI
with mpi as (
  select f.id as fid, g.id as gid, g.unidad_base
    from public.fichas f join public.genericos g on g.id = f.generico_id
   where g.tipo = 'MPI' and f.neto_esperado is null and (f.vigente_hasta is null or f.vigente_hasta >= current_date)
),
suma as (
  select m.fid, m.gid,
         sum(privado.a_base(l.generico_id, l.cantidad, l.unidad)) as base,
         bool_and(l.cantidad is not null and (privado.a_base(l.generico_id, l.cantidad, l.unidad) is not null
                  or lower(coalesce(l.unidad, '')) in ('dash', 'gts', 'gota'))) as completa
    from mpi m join public.ficha_lineas l on l.ficha_id = m.fid
   group by m.fid, m.gid
),
rend as (
  select lh.generico_id as gid, count(*) as lotes,
         (percentile_cont(0.5) within group (order by (lh.neto_g / lh.entrada_g)::float8))::numeric as r
    from public.lotes_historicos lh
   where lh.estado_lote = 'ACTIVA' and lh.neto_g > 0 and lh.entrada_g > 0
   group by lh.generico_id
)
update public.fichas f
   set neto_esperado = round(s.base * least(1.1, greatest(0.2, coalesce(r.r, 1))), 1),
       nota = concat_ws(' · ', f.nota,
         case when r.r is not null
              then 'Neto esperado estimado (06/11/2026): suma de la receta × rendimiento mediano de ' || r.lotes
                   || ' lote(s) del registro (' || round(r.r * 100) || ' %). Confírmalo con el próximo lote.'
              else 'Neto esperado estimado (06/11/2026) como la suma de la receta, sin registro de producción: '
                   || 'corrígelo con lo que rinde de verdad.' end)
  from suma s left join rend r on r.gid = s.gid
 where f.id = s.fid and s.completa and s.base > 0;

-- ---------------------------------------------------------------- 3. costo estimado
create or replace function privado.costo_estimado_generico(p_generico uuid, p_prof integer default 0)
returns numeric
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_k numeric; v_tipo public.tipo_generico; v_f uuid; v_neto numeric;
  v_total numeric := 0; l record; v_base numeric; v_cu numeric;
begin
  v_k := privado.costo_vigente_generico(p_generico);
  if v_k is not null then return v_k; end if;
  select g.tipo into v_tipo from public.genericos g where g.id = p_generico;
  if v_tipo = 'SIN_COSTO' then return 0; end if;
  if v_tipo = 'MPe' then
    return (select avg(cr.costo_unitario_base) from public.costos_referencia cr
              join public.productos p on p.id = cr.producto_id
             where p.generico_id = p_generico and p.activo);
  end if;
  if v_tipo is distinct from 'MPI' or p_prof >= 5 then return null; end if;
  v_f := privado.ficha_vigente(p_generico);
  if v_f is null then return null; end if;
  select f.neto_esperado into v_neto from public.fichas f where f.id = v_f;
  if v_neto is null or v_neto <= 0 then return null; end if;
  for l in select fl.cantidad, fl.unidad, fl.generico_id as gid from public.ficha_lineas fl where fl.ficha_id = v_f loop
    if l.cantidad is null then return null; end if;
    v_base := privado.a_base(l.gid, l.cantidad, l.unidad);
    if v_base is null then
      if lower(coalesce(l.unidad, '')) in ('dash', 'gts', 'gota') then continue; end if;
      return null;
    end if;
    v_cu := privado.costo_estimado_generico(l.gid, p_prof + 1);
    if v_cu is null then return null; end if;
    v_total := v_total + v_base * v_cu;
  end loop;
  return v_total / v_neto;
end
$$;

-- el costo es estimado si el insumo aún no tiene costo en el kardex
create or replace function privado.costo_es_estimado(p_generico uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select privado.costo_vigente_generico(p_generico) is null
     and coalesce((select g.tipo from public.genericos g where g.id = p_generico) <> 'SIN_COSTO', false)
$$;

create or replace function public.costo_ficha(p_ficha uuid)
returns table (linea integer, generico_id uuid, generico text, cantidad numeric, unidad text,
               cantidad_base numeric, costo_unitario numeric, costo numeric, falta text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.ve_costos() then raise exception 'Sin permiso para ver costos.'; end if;
  return query
  select l.linea, g.id, g.nombre, l.cantidad, l.unidad, b.base, cu.valor,
         case when g.tipo = 'SIN_COSTO' or b.traza then 0 else b.base * cu.valor end,
         case
           when l.cantidad is null then 'La ficha no trae cantidad de ' || g.nombre
           when b.traza then null
           when b.base is null then 'Falta la conversión ' || l.unidad || '→' || g.unidad_base || ' de ' || g.nombre
           when g.tipo <> 'SIN_COSTO' and cu.valor is null then 'Sin costo vigente de ' || g.nombre
         end
    from public.ficha_lineas l
    join public.genericos g on g.id = l.generico_id
    cross join lateral (select x.base, (x.base is null and lower(l.unidad) in ('dash', 'gts', 'gota')) as traza
                          from (select privado.a_base(g.id, l.cantidad, l.unidad) as base) x) b
    -- kardex si lo hay; si no, el costo estimado (referencia o receta de la MPI)
    cross join lateral (select case when g.tipo = 'SIN_COSTO' then 0::numeric
                                    else privado.costo_estimado_generico(g.id) end as valor) cu
   where l.ficha_id = p_ficha
   order by l.linea;
end
$$;

-- ---------------------------------------------------------------- carta: dice si el costo es estimado
drop function public.carta_costos(public.area_app);
create function public.carta_costos(p_area public.area_app)
returns table (generico_id uuid, nombre text, tipo public.tipo_generico, carta text, ficha_codigo text,
               lineas integer, lineas_con_costo integer, faltantes text[], costo numeric,
               precio numeric, precio_desde date, pct_costo numeric, margen numeric, estimado boolean)
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
              then round(pv.precio_con_impuesto / v_imp - t.total) end,
         coalesce(t.estimado, false)
    from public.genericos g
    left join public.fichas f on f.id = privado.ficha_vigente(g.id)
    left join lateral (
      select count(*)::int as lineas, count(*) filter (where c.falta is null)::int as con_costo,
             round(coalesce(sum(c.costo), 0)) as total, array_remove(array_agg(c.falta order by c.linea), null) as faltantes,
             bool_or(c.costo_unitario is not null and privado.costo_es_estimado(c.generico_id)) as estimado
        from public.costo_ficha(f.id) c) t on f.id is not null
    left join lateral (
      select v.precio_con_impuesto, v.vigente_desde from public.precios_venta v
       where v.generico_id = g.id and v.vigente_desde <= privado.hoy()
       order by v.vigente_desde desc limit 1) pv on true
   where g.area = p_area and g.activo and g.tipo in ('BEBIDA', 'PLATO')
   order by g.nombre;
end
$$;
revoke execute on function public.carta_costos(public.area_app) from public, anon;
grant execute on function public.carta_costos(public.area_app) to authenticated;

-- lo que la ficha estimó por línea, para la pantalla de la ficha
create or replace function public.ficha_estimados(p_ficha uuid)
returns table (linea integer, estimado boolean)
language sql stable security definer set search_path = ''
as $$
  select l.linea, privado.costo_es_estimado(l.generico_id) from public.ficha_lineas l
   where l.ficha_id = p_ficha and privado.ve_costos()
$$;
revoke execute on function public.ficha_estimados(uuid) from public, anon;
grant execute on function public.ficha_estimados(uuid) to authenticated;

select privado.bitacora('COSTO ESTIMADO DE FICHAS', 'fichas', null, jsonb_build_object(
  'conversiones_supuestas', (select count(*) from public.conversiones where estado = 'SUPUESTO' and nota like 'Propuesta automática (06/11/2026)%'),
  'netos_estimados', (select count(*) from public.fichas where nota like '%Neto esperado estimado (06/11/2026)%')));
