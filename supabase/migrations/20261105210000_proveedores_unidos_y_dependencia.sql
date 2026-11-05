-- =====================================================================================
-- SGI Di Égida · 43 · Un proveedor, un nombre · y cuánto dependemos de cada uno (05/11/2026)
-- 1. El mismo proveedor escrito de varias formas («Fruver JC» / «Frutas y Verduras del Campo
--    JC»). Las recepciones no se editan, así que unir dos proveedores no reescribe nada: el que
--    sale queda inactivo con unido_en, su nombre pasa a ser un alias del que queda, y todo lo
--    que lea compras resuelve el proveedor vigente (privado.proveedor_vigente).
--    proveedor_desde_factura (Recibir) y Precios desde fotos buscan también por alias: un nombre
--    ya unido no vuelve a crear un proveedor.
-- 2. public.proveedores_parecidos: pares que podrían ser el mismo (para revisarlos).
-- 3. public.dependencia_proveedores: gasto, participación, productos que solo trae uno,
--    categorías concentradas. Con eso la IA arma el análisis de riesgos
--    (analisis_proveedores guarda cada análisis: no se repite al abrir la página).
-- =====================================================================================

alter table public.proveedores add column unido_en uuid references public.proveedores (id);

create table public.proveedor_alias (
  id           uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references public.proveedores (id),
  alias        text not null,
  alias_norm   text generated always as (privado.normalizar(alias)) stored unique,
  creado_en    timestamptz not null default now()
);
alter table public.proveedor_alias enable row level security;
revoke all on public.proveedor_alias from anon;
revoke insert, update, delete, truncate on public.proveedor_alias from authenticated;
create policy proveedor_alias_leer on public.proveedor_alias for select to authenticated using (true);

-- pares que una persona ya dijo que NO son el mismo
create table public.proveedores_distintos (
  a uuid not null references public.proveedores (id),
  b uuid not null references public.proveedores (id),
  decidido_por uuid references public.perfiles (id),
  decidido_en timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);
alter table public.proveedores_distintos enable row level security;
revoke all on public.proveedores_distintos from anon;
revoke insert, update, delete, truncate on public.proveedores_distintos from authenticated;
create policy proveedores_distintos_leer on public.proveedores_distintos for select to authenticated using (true);

create or replace function privado.proveedor_vigente(p uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  with recursive cadena(id, paso) as (
    select p, 0
    union all
    select pv.unido_en, c.paso + 1 from cadena c join public.proveedores pv on pv.id = c.id
     where pv.unido_en is not null and c.paso < 20
  )
  select id from cadena order by paso desc limit 1
$$;

-- nombre (o alias) → proveedor vigente
create or replace function privado.proveedor_por_nombre(p_nombre text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select privado.proveedor_vigente(coalesce(
    (select pv.id from public.proveedores pv where pv.nombre_norm = privado.normalizar(p_nombre) limit 1),
    (select pa.proveedor_id from public.proveedor_alias pa where pa.alias_norm = privado.normalizar(p_nombre) limit 1)))
$$;

create or replace function privado.edita_proveedores()
returns boolean language sql stable security definer set search_path = ''
as $$ select privado.tiene_rol('admin') or privado.edita_area('BAR') or privado.edita_area('COCINA') $$;

-- ---------------------------------------------------------------- unir dos proveedores
create or replace function public.unir_proveedores(p_queda uuid, p_va uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  q public.proveedores%rowtype; v public.proveedores%rowtype;
begin
  if not privado.edita_proveedores() then
    raise exception 'Solo administración o los jefes de área unen proveedores.' using errcode = '42501';
  end if;
  select * into q from public.proveedores where id = p_queda for update;
  select * into v from public.proveedores where id = p_va for update;
  if q.id is null or v.id is null or q.id = v.id then raise exception 'Los dos proveedores deben existir y ser distintos.'; end if;
  if not q.activo or not v.activo then
    return privado.resultado(false, null, null, array['Uno de los dos ya está inactivo o unido.'], '{}', '{}');
  end if;

  -- lo que se le compraba al que sale pasa al que queda (es un resumen: se recalcula, no se edita historia)
  insert into public.proveedor_productos as pp (proveedor_id, producto_id, nombre_factura, ultimo_valor, ultima_cantidad_base,
                                                ultimo_costo_base, ultima_fecha, primera_fecha, veces, origen)
  select q.id, x.producto_id, x.nombre_factura, x.ultimo_valor, x.ultima_cantidad_base, x.ultimo_costo_base, x.ultima_fecha,
         x.primera_fecha, x.veces, x.origen
    from public.proveedor_productos x where x.proveedor_id = v.id
  on conflict (proveedor_id, producto_id) do update
     set veces = pp.veces + excluded.veces,
         primera_fecha = least(pp.primera_fecha, excluded.primera_fecha),
         nombre_factura = case when excluded.ultima_fecha > pp.ultima_fecha then excluded.nombre_factura else pp.nombre_factura end,
         ultimo_valor = case when excluded.ultima_fecha > pp.ultima_fecha then excluded.ultimo_valor else pp.ultimo_valor end,
         ultima_cantidad_base = case when excluded.ultima_fecha > pp.ultima_fecha then excluded.ultima_cantidad_base else pp.ultima_cantidad_base end,
         ultimo_costo_base = case when excluded.ultima_fecha > pp.ultima_fecha then excluded.ultimo_costo_base else pp.ultimo_costo_base end,
         ultima_fecha = greatest(pp.ultima_fecha, excluded.ultima_fecha),
         actualizado_en = now();
  delete from public.proveedor_productos where proveedor_id = v.id;

  -- sus nombres quedan como alias del que queda
  update public.proveedor_alias set proveedor_id = q.id where proveedor_id = v.id;
  insert into public.proveedor_alias (proveedor_id, alias) values (q.id, v.nombre) on conflict (alias_norm) do nothing;
  update public.proveedores set nit = coalesce(nit, v.nit) where id = q.id;
  update public.proveedores set activo = false, unido_en = q.id where id = v.id;

  perform privado.bitacora('PROVEEDORES UNIDOS', 'proveedores', q.id::text, jsonb_build_object('queda', q.nombre, 'sale', v.nombre));
  return privado.resultado(true, q.id, null, '{}', '{}', array['«' || v.nombre || '» ahora es «' || q.nombre || '».']);
end
$$;

create or replace function public.marcar_proveedores_distintos(p_a uuid, p_b uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not privado.edita_proveedores() then
    raise exception 'Solo administración o los jefes de área deciden esto.' using errcode = '42501';
  end if;
  insert into public.proveedores_distintos (a, b, decidido_por) values (least(p_a, p_b), greatest(p_a, p_b), auth.uid())
  on conflict do nothing;
end
$$;

-- ---------------------------------------------------------------- posibles repetidos
create or replace function privado.nombre_proveedor_limpio(p text)
returns text language sql immutable set search_path = ''
as $$
  select trim(regexp_replace(regexp_replace(privado.normalizar(coalesce(p, '')),
    '\m(s\.?a\.?s|ltda|s\.?a|cia|y|de|del|la|el|los|las|distribuidora|distribuidores|comercializadora|inversiones|grupo|supermercados?|tiendas?)\M', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;

create or replace function public.proveedores_parecidos()
returns table (a_id uuid, a_nombre text, a_compras integer, b_id uuid, b_nombre text, b_compras integer, parecido numeric, motivo text)
language sql stable security definer set search_path = ''
as $$
  with pv as (
    select p.id, p.nombre, p.nit, privado.nombre_proveedor_limpio(p.nombre) as limpio,
           (select coalesce(sum(pp.veces), 0)::int from public.proveedor_productos pp where pp.proveedor_id = p.id) as compras
      from public.proveedores p where p.activo
  )
  select a.id, a.nombre, a.compras, b.id, b.nombre, b.compras,
         round(extensions.similarity(a.limpio, b.limpio)::numeric, 2),
         case when a.nit is not null and a.nit = b.nit then 'Mismo NIT'
              when extensions.similarity(a.limpio, b.limpio) >= 0.45 then 'Nombre muy parecido'
              else 'Comparten la palabra «' || (select w from unnest(string_to_array(a.limpio, ' ')) w
                                                where length(w) >= 2 and w !~ '^[0-9]+$' and w = any (string_to_array(b.limpio, ' ')) limit 1) || '»' end
    from pv a join pv b on a.id < b.id
   where privado.edita_proveedores()
     and not exists (select 1 from public.proveedores_distintos d where d.a = a.id and d.b = b.id)
     and ((a.nit is not null and a.nit = b.nit)
          or extensions.similarity(a.limpio, b.limpio) >= 0.45
          or exists (select 1 from unnest(string_to_array(a.limpio, ' ')) w
                      where length(w) >= 2 and w !~ '^[0-9]+$' and w = any (string_to_array(b.limpio, ' '))))
   order by 7 desc, a.nombre
$$;

-- ---------------------------------------------------------------- Recibir: un nombre ya unido no crea otro proveedor
create or replace function public.proveedor_desde_factura(p_area public.area_app, p_nombre text, p_nit text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_nombre text := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_nit    text := nullif(regexp_replace(coalesce(p_nit, ''), '[^0-9-]', '', 'g'), '');
  v_dig    text := left(regexp_replace(coalesce(p_nit, ''), '\D', '', 'g'), 9);   -- sin dígito de verificación
  v_id     uuid;
  v_p      record;
begin
  if not privado.puede_operar(p_area) then
    raise exception 'Sin permiso para recibir en %.', p_area using errcode = '42501';
  end if;
  if v_nombre = upper(v_nombre) then v_nombre := initcap(v_nombre); end if;
  if length(v_nombre) < 3 then raise exception 'El nombre del proveedor es muy corto: «%».', v_nombre; end if;

  -- por nombre, por alias (nombres de proveedores ya unidos) o por NIT; siempre el vigente
  v_id := privado.proveedor_por_nombre(v_nombre);
  if v_id is null and length(v_dig) >= 6 then
    select privado.proveedor_vigente(pr.id) into v_id from public.proveedores pr
     where left(regexp_replace(coalesce(pr.nit, ''), '\D', '', 'g'), 9) = v_dig limit 1;
  end if;
  if v_id is not null then
    select pr.id, pr.nombre, pr.activo into v_p from public.proveedores pr where pr.id = v_id;
    return jsonb_build_object('id', v_p.id, 'nombre', v_p.nombre, 'creado', false, 'activo', v_p.activo);
  end if;

  insert into public.proveedores (nombre, nit) values (v_nombre, v_nit)
  on conflict (nombre_norm) do nothing
  returning id, nombre, activo into v_p;
  if v_p.id is null then
    select pr.id, pr.nombre, pr.activo into v_p from public.proveedores pr where pr.nombre_norm = privado.normalizar(v_nombre);
    return jsonb_build_object('id', v_p.id, 'nombre', v_p.nombre, 'creado', false, 'activo', v_p.activo);
  end if;
  perform privado.bitacora('PROVEEDOR CREADO DESDE FACTURA', 'proveedores', v_p.id::text,
                           jsonb_build_object('nombre', v_nombre, 'nit', v_nit, 'area', p_area));
  return jsonb_build_object('id', v_p.id, 'nombre', v_p.nombre, 'creado', true, 'activo', true);
end
$$;

-- ---------------------------------------------------------------- dependencia
-- Compras de los últimos p_meses: recepciones de la app (no anuladas) y compras de referencia
-- (libros anteriores y fotos), cada una con su proveedor vigente.
create or replace function public.dependencia_proveedores(p_meses integer default 12)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_desde date := (privado.hoy() - make_interval(months => greatest(1, least(coalesce(p_meses, 12), 36))))::date;
  v jsonb;
begin
  if not (privado.ve_costos() and (privado.tiene_rol('admin', 'auditor') or privado.edita_area('BAR') or privado.edita_area('COCINA'))) then
    raise exception 'Solo administración o los jefes de área ven la dependencia de proveedores.' using errcode = '42501';
  end if;
  with compras as (
    select privado.proveedor_vigente(re.proveedor_id) as prov, rl.producto_id, re.fecha, coalesce(rl.valor_total, 0) as valor
      from public.recepcion_lineas rl join public.recepciones re on re.id = rl.recepcion_id
     where re.fecha >= v_desde and rl.valor_total > 0
       and not exists (select 1 from public.anulaciones an where an.documento_id = re.id and (an.linea_id is null or an.linea_id = rl.id))
    union all
    select privado.proveedor_por_nombre(ch.proveedor),
           coalesce(ch.producto_id, (select p.id from public.productos p
                                      where p.generico_id = coalesce(privado.generico_vigente(ch.generico_id), ch.generico_id)
                                      order by p.activo desc, p.codigo limit 1)),
           ch.fecha, ch.valor_total
      from public.compras_historicas ch
     where ch.computable and ch.fecha >= v_desde
  ),
  c as (
    select co.prov, co.producto_id, co.fecha, co.valor, g.id as gen, g.nombre as generico, g.area, g.clase,
           coalesce((select k.nombre from public.categorias k where k.codigo = g.categoria), 'Sin categoría') as categoria
      from compras co join public.productos p on p.id = co.producto_id join public.genericos g on g.id = coalesce(privado.generico_vigente(p.generico_id), p.generico_id)
     where co.prov is not null
  ),
  total as (select coalesce(sum(valor), 0) as t from c),
  por_gen as (   -- cuántos proveedores tiene cada insumo
    select gen, count(distinct prov) as n_prov, sum(valor) as gasto from c group by gen
  ),
  prov as (
    select c.prov, sum(c.valor) as gasto, count(*) as compras, count(distinct c.gen) as insumos, max(c.fecha) as ultima,
           count(distinct c.gen) filter (where pg.n_prov = 1) as unicos
      from c join por_gen pg on pg.gen = c.gen group by c.prov
  ),
  cat as (
    select c.area, c.categoria, sum(c.valor) as gasto, count(distinct c.prov) as n_prov,
           (array_agg(c.prov order by c.valor desc))[1] as prov_mayor
      from c group by c.area, c.categoria
  ),
  cat_top as (
    select k.*, (select sum(x.valor) from c x where x.area = k.area and x.categoria = k.categoria and x.prov = k.prov_mayor) as gasto_mayor
      from cat k
  ),
  unico as (
    select c.gen, max(c.generico) as generico, max(c.area::text) as area, max(c.categoria) as categoria, max(c.prov::text)::uuid as prov,
           sum(c.valor) as gasto, count(*) as compras
      from c join por_gen pg on pg.gen = c.gen where pg.n_prov = 1 group by c.gen
  )
  select jsonb_build_object(
    'desde', v_desde, 'hasta', privado.hoy(), 'total', (select t from total),
    'n_proveedores', (select count(*) from prov),
    'hhi', (select round(sum(power(100.0 * p.gasto / nullif(t.t, 0), 2))) from prov p, total t),
    'proveedores', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.prov, 'nombre', pv.nombre, 'gasto', round(p.gasto), 'participacion', round(100.0 * p.gasto / nullif(t.t, 0), 1),
        'compras', p.compras, 'insumos', p.insumos, 'insumos_solo_el', p.unicos, 'ultima', p.ultima,
        'categorias', (select jsonb_agg(distinct c.categoria) from c where c.prov = p.prov)) order by p.gasto desc)
      from prov p join public.proveedores pv on pv.id = p.prov, total t), '[]'),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object(
        'area', k.area, 'categoria', k.categoria, 'gasto', round(k.gasto), 'proveedores', k.n_prov,
        'mayor', (select nombre from public.proveedores where id = k.prov_mayor),
        'participacion_mayor', round(100.0 * k.gasto_mayor / nullif(k.gasto, 0), 1)) order by k.gasto desc)
      from cat_top k), '[]'),
    'un_solo_proveedor', coalesce((select jsonb_agg(jsonb_build_object(
        'insumo', u.generico, 'area', u.area, 'categoria', u.categoria, 'proveedor', (select nombre from public.proveedores where id = u.prov),
        'gasto', round(u.gasto), 'compras', u.compras) order by u.gasto desc)
      from (select * from unico order by gasto desc limit 40) u), '[]')
  ) into v;
  return v;
end
$$;

-- ---------------------------------------------------------------- análisis guardados
create table public.analisis_proveedores (
  id         uuid primary key default gen_random_uuid(),
  creado_en  timestamptz not null default now(),
  creado_por uuid references public.perfiles (id) default auth.uid(),
  datos      jsonb not null,      -- lo que se le pasó a la IA (dependencia_proveedores)
  resultado  jsonb not null,      -- riesgos, calendario, fuentes
  modelo     text
);
alter table public.analisis_proveedores enable row level security;
revoke all on public.analisis_proveedores from anon;
revoke insert, update, delete, truncate on public.analisis_proveedores from authenticated;
create policy analisis_proveedores_leer on public.analisis_proveedores for select to authenticated using (privado.ve_costos());
create trigger analisis_proveedores_sin_borrado before update or delete on public.analisis_proveedores
  for each row execute function privado.bloquear_cambios();

create or replace function public.guardar_analisis_proveedores(p_datos jsonb, p_resultado jsonb, p_modelo text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if not privado.edita_proveedores() then
    raise exception 'Solo administración o los jefes de área generan el análisis.' using errcode = '42501';
  end if;
  insert into public.analisis_proveedores (datos, resultado, modelo) values (p_datos, p_resultado, p_modelo) returning id into v_id;
  perform privado.bitacora('ANÁLISIS DE PROVEEDORES', 'analisis_proveedores', v_id::text, null);
  return v_id;
end
$$;

revoke execute on function public.unir_proveedores(uuid, uuid), public.marcar_proveedores_distintos(uuid, uuid),
                           public.proveedores_parecidos(), public.dependencia_proveedores(integer),
                           public.guardar_analisis_proveedores(jsonb, jsonb, text) from public, anon;
grant execute on function public.unir_proveedores(uuid, uuid), public.marcar_proveedores_distintos(uuid, uuid),
                          public.proveedores_parecidos(), public.dependencia_proveedores(integer),
                          public.guardar_analisis_proveedores(jsonb, jsonb, text) to authenticated;
