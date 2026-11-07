-- =====================================================================================
-- SGI Di Égida · Carta y margen (pantalla informativa, solo administración) · 08/11/2026
-- Decisiones de Anthony (06–07/11/2026):
--   · Todo lo que tenga que ver con precios y costos del establecimiento lo ve SOLO
--     administración: la carta, sus costos y fijar el precio de carta.
--   · % de costo y margen sobre el precio neto = precio de carta / (1 + impoconsumo).
--     El impoconsumo es configurable (parámetro IMPOCONSUMO_PCT, 8 %).
--   · Cada sección de la carta tiene su meta de % de costo con historia. Semáforo:
--     verde ≤ meta · amarillo hasta meta + banda (3 puntos) · rojo después.
--   · Estado de la ficha: COMPLETA (todas las líneas con costo), PARCIAL (falta alguna)
--     o SIN_FICHA. «Estimado» (sin kardex todavía) es una marca aparte.
-- Contenido:
--   · genericos.seccion_carta: sección propia (si está vacía se lee de la nota «Carta: …»)
--   · public.metas_costo + privado.meta_costo(área, sección, fecha)
--   · privado.ve_precios() y privado.calculo_margen(…) (fórmula pura, con pruebas)
--   · public.carta_margen(área): una fila por producto final, con sus ingredientes
--   · carta_costos, carta_baul y fijar_precio pasan a ser solo de administración
-- =====================================================================================

-- ---------------------------------------------------------------- quién ve precios
create or replace function privado.ve_precios()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(privado.rol_actual() = 'admin', false)
$$;

comment on function privado.ve_precios() is
  'Precios de carta, costos y márgenes: solo administración (decisión de Anthony, 06/11/2026).';

-- ---------------------------------------------------------------- sección de la carta
alter table public.genericos add column if not exists seccion_carta text;
comment on column public.genericos.seccion_carta is
  'Sección de la carta (CLÁSICA, MOCKTAIL, SANGRÍA, ENTRADA…). Si está vacía, se lee de la nota «Carta: …».';

create or replace function privado.seccion_carta(p_seccion text, p_nota text)
returns text
language sql immutable
as $$
  select case s when 'MOCKTAIL (STELLA)' then 'MOCKTAIL' else s end
    from (select nullif(upper(trim(coalesce(p_seccion, substring(p_nota from 'Carta: ([^·]+)')))), '') as s) x
$$;

update public.genericos g
   set seccion_carta = privado.seccion_carta(null, g.nota)
 where g.tipo in ('BEBIDA', 'PLATO') and g.seccion_carta is null and privado.seccion_carta(null, g.nota) is not null;

-- ---------------------------------------------------------------- metas por sección (con historia)
create table if not exists public.metas_costo (
  id             uuid primary key default gen_random_uuid(),
  area           public.area_app not null,
  seccion        text,                     -- null = meta general del área
  meta_pct       numeric not null check (meta_pct > 0 and meta_pct < 100),
  banda_pp       numeric not null default 3 check (banda_pp >= 0 and banda_pp < 50),
  vigente_desde  date not null default current_date,
  fuente         text,
  creado_por     uuid default auth.uid(),
  creado_en      timestamptz not null default now(),
  check (seccion is null or seccion = upper(trim(seccion)))
);
create unique index if not exists metas_costo_vigencia_idx
  on public.metas_costo (area, coalesce(seccion, ''), vigente_desde);

alter table public.metas_costo enable row level security;
drop policy if exists metas_costo_lee on public.metas_costo;
create policy metas_costo_lee on public.metas_costo for select to authenticated using (privado.ve_precios());
revoke insert, update, delete on public.metas_costo from authenticated, anon;

create trigger metas_costo_inmutables
  before update or delete on public.metas_costo
  for each row execute function privado.bloquear_cambios();

-- Metas propuestas por referencias de la industria (06/11/2026), sobre precio neto.
-- Bar: cócteles 15–25 % (típico 18–24 %), cerveza 24–30 %, vino por copa 25–40 %,
-- botella 35–50 %, sin licor 15–25 %. Cocina: costo de alimentos 28–35 % (provisional).
insert into public.metas_costo (area, seccion, meta_pct, banda_pp, vigente_desde, fuente) values
  ('BAR', null,            24, 3, '2026-01-01', 'Promedio de bebidas de la industria 18–24 %'),
  ('BAR', 'CLÁSICA',       25, 3, '2026-01-01', 'Cócteles 15–25 %; tope por licor importado'),
  ('BAR', 'AUTOR',         25, 3, '2026-01-01', 'Cócteles 15–25 %; tope por licor importado'),
  ('BAR', 'SANGRÍA',       22, 3, '2026-01-01', 'Preparación de lote con vino de la casa'),
  ('BAR', 'MIMOSA',        28, 3, '2026-01-01', 'Base de espumoso: rango de vino 25–35 %'),
  ('BAR', 'MOCKTAIL',      22, 3, '2026-01-01', 'Sin licor 15–25 %'),
  ('BAR', 'JUGOS Y LIMONADAS', 22, 3, '2026-01-01', 'Sin licor 15–25 %'),
  ('BAR', 'SHOT',          20, 3, '2026-01-01', 'Destilado servido solo 15–20 %'),
  ('BAR', 'CERVEZA',       30, 3, '2026-01-01', 'Cerveza en botella 24–30 %'),
  ('BAR', 'VINO COPA',     30, 3, '2026-01-01', 'Vino por copa 25–40 %'),
  ('BAR', 'BOTELLA',       40, 3, '2026-01-01', 'Botella entera 35–50 %'),
  ('BAR', 'GASEOSAS Y AGUAS', 25, 3, '2026-01-01', 'Reventa sin preparación'),
  ('COCINA', null,         30, 3, '2026-01-01', 'Costo de alimentos 28–35 % (provisional)')
on conflict do nothing;

insert into public.parametros (clave, valor, descripcion)
select 'IMPOCONSUMO_PCT', '8', 'Impoconsumo incluido en el precio de carta: precio neto = precio / (1 + %/100).'
 where not exists (select 1 from public.parametros where clave = 'IMPOCONSUMO_PCT');

-- Meta vigente en una fecha: la de la sección; si la sección no tiene, la general del área;
-- si tampoco, el parámetro META_PCT_COSTO con banda de 3 puntos.
create or replace function privado.meta_costo(p_area public.area_app, p_seccion text, p_fecha date default null)
returns table (meta_pct numeric, banda_pp numeric)
language sql stable security definer set search_path = ''
as $$
  select coalesce(m.meta_pct, privado.parametro_num('META_PCT_COSTO', 25)), coalesce(m.banda_pp, 3)
    from (select 1) uno
    left join lateral (
      select mc.meta_pct, mc.banda_pp from public.metas_costo mc
       where mc.area = p_area and (mc.seccion = upper(trim(p_seccion)) or mc.seccion is null)
         and mc.vigente_desde <= coalesce(p_fecha, privado.hoy())
       order by (mc.seccion is null), mc.vigente_desde desc
       limit 1) m on true
$$;

-- ---------------------------------------------------------------- fórmula (pura)
-- p_costo: costo de la ficha · p_precio: precio de carta con impoconsumo · p_imp_pct: 8
-- Sin costo completo o sin precio, el % y el margen no salen (null).
create or replace function privado.calculo_margen(p_costo numeric, p_precio numeric, p_imp_pct numeric,
                                                  p_meta numeric, p_banda numeric)
returns table (precio_neto numeric, pct_costo numeric, margen numeric, margen_pct numeric, semaforo text)
language sql immutable
as $$
  with b as (
    select case when p_precio > 0 then p_precio / (1 + coalesce(p_imp_pct, 0) / 100) end as neto
  ), c as (
    select b.neto,
           case when b.neto > 0 and p_costo is not null then p_costo / b.neto * 100 end as pct
      from b
  )
  select round(c.neto, 2),
         round(c.pct, 1),
         case when c.pct is not null then round(c.neto - p_costo) end,
         case when c.pct is not null then round(100 - c.pct, 1) end,
         case when c.pct is null or p_meta is null then null
              when round(c.pct, 1) <= p_meta then 'VERDE'
              when round(c.pct, 1) <= p_meta + coalesce(p_banda, 0) then 'AMARILLO'
              else 'ROJO' end
    from c
$$;

-- ---------------------------------------------------------------- carta y margen
create or replace function public.carta_margen(p_area public.area_app default null)
returns table (generico_id uuid, codigo text, nombre text, tipo public.tipo_generico, area public.area_app,
               seccion text, ficha_codigo text, ficha_version integer, estado_ficha text,
               lineas integer, lineas_con_costo integer, faltantes text[], estimado boolean, costo numeric,
               precio numeric, precio_desde date, impoconsumo_pct numeric, precio_neto numeric,
               pct_costo numeric, margen numeric, margen_pct numeric,
               meta_pct numeric, banda_pp numeric, semaforo text, ingredientes jsonb)
language plpgsql stable security definer set search_path = ''
as $$
declare v_imp numeric := privado.parametro_num('IMPOCONSUMO_PCT', 8);
begin
  if not privado.ve_precios() then
    raise exception 'Sin permiso: los precios y costos de la carta solo los ve administración.' using errcode = '42501';
  end if;
  return query
  select g.id, g.codigo, g.nombre, g.tipo, g.area, s.seccion, f.codigo, f.version,
         case when f.id is null or coalesce(t.lineas, 0) = 0 then 'SIN_FICHA'
              when t.con_costo < t.lineas then 'PARCIAL' else 'COMPLETA' end,
         coalesce(t.lineas, 0), coalesce(t.con_costo, 0), coalesce(t.faltantes, '{}'), coalesce(t.estimado, false),
         t.total, pv.precio_con_impuesto, pv.vigente_desde, v_imp,
         cm.precio_neto, cm.pct_costo, cm.margen, cm.margen_pct, m.meta_pct, m.banda_pp, cm.semaforo,
         coalesce(t.ingredientes, '[]'::jsonb)
    from public.genericos g
    cross join lateral (select privado.seccion_carta(g.seccion_carta, g.nota) as seccion) s
    cross join lateral privado.meta_costo(g.area, s.seccion) m
    left join public.fichas f on f.id = privado.ficha_vigente(g.id)
    left join lateral (
      select count(*)::int as lineas, count(*) filter (where c.falta is null)::int as con_costo,
             round(coalesce(sum(c.costo), 0)) as total,
             array_remove(array_agg(c.falta order by c.linea), null) as faltantes,
             bool_or(c.costo_unitario is not null and privado.costo_es_estimado(c.generico_id)) as estimado,
             jsonb_agg(jsonb_build_object(
               'linea', c.linea, 'generico_id', c.generico_id, 'nombre', c.generico, 'tipo', gi.tipo,
               'cantidad', c.cantidad, 'unidad', c.unidad, 'costo', round(c.costo), 'falta', c.falta,
               'estimado', c.costo_unitario is not null and privado.costo_es_estimado(c.generico_id))
               order by c.linea) as ingredientes
        from public.costo_ficha(f.id) c
        left join public.genericos gi on gi.id = c.generico_id) t on f.id is not null
    left join lateral (
      select v.precio_con_impuesto, v.vigente_desde from public.precios_venta v
       where v.generico_id = g.id and v.vigente_desde <= privado.hoy()
       order by v.vigente_desde desc limit 1) pv on true
    cross join lateral privado.calculo_margen(
      case when f.id is not null and t.lineas > 0 and t.lineas = t.con_costo then t.total end,
      pv.precio_con_impuesto, v_imp, m.meta_pct, m.banda_pp) cm
   where (p_area is null or g.area = p_area) and g.activo and not g.en_baul and g.tipo in ('BEBIDA', 'PLATO')
   order by g.area, s.seccion nulls last, g.nombre;
end
$$;

revoke execute on function public.carta_margen(public.area_app) from public, anon;
grant execute on function public.carta_margen(public.area_app) to authenticated;

-- ---------------------------------------------------------------- solo administración
-- carta_costos y carta_baul muestran precios; fijar_precio los cambia. Se les cambia el
-- permiso sin reescribirlas (conservan el filtro del baúl). Si el texto no aparece, falla.
do $$
declare v_f text; v_def text; v_nueva text; v_viejo text;
begin
  foreach v_f in array array['public.carta_costos(public.area_app)', 'public.carta_baul(public.area_app)'] loop
    v_def := pg_get_functiondef(v_f::regprocedure);
    v_nueva := replace(v_def, 'if not privado.ve_area(p_area) then', 'if not privado.ve_precios() then');
    if v_nueva = v_def then raise exception 'No se encontró el permiso de área en %.', v_f; end if;
    execute v_nueva;
  end loop;
  v_def := pg_get_functiondef('public.fijar_precio(uuid, numeric)'::regprocedure);
  v_viejo := 'if not privado.edita_area(v_g.area) then';
  v_nueva := replace(v_def, v_viejo, 'if not privado.ve_precios() then');
  if v_nueva = v_def then raise exception 'No se encontró el permiso de área en fijar_precio.'; end if;
  execute v_nueva;
end
$$;
