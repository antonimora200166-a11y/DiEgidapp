-- =====================================================================================
-- SGI Di Égida · 06 · Catálogo vivo: productos provisionales, clase ABC y búsqueda de parecidos
-- Quien opera un área puede dar de alta un producto que no existe (recepción, conteo), pero
-- entra PROVISIONAL: el jefe del área (o el admin) lo valida. Antes de crearlo, la app busca
-- parecidos por trigramas para que no nazca un duplicado («Azúcar Manuelita» ≈ «Azúcar blanca»).
-- La clase ABC sale del valor de compra (scripts/migracion/unificar.mjs) y luego del kardex.
-- =====================================================================================

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
grant usage on schema extensions to authenticated;

create type public.estado_catalogo as enum ('PROVISIONAL', 'VALIDADO');
create type public.clase_abc as enum ('A', 'B', 'C');

-- ---------------------------------------------------------------- usuario de acceso
-- Se entra con un usuario corto («frank.motato»); Auth guarda usuario@<dominio interno>.
alter table public.perfiles
  add column usuario text unique check (usuario ~ '^[a-z0-9][a-z0-9._-]{2,29}$');

-- ---------------------------------------------------------------- estado y trazabilidad
alter table public.genericos
  add column estado       public.estado_catalogo not null default 'VALIDADO',
  add column creado_por   uuid default auth.uid() references public.perfiles (id),
  add column validado_por uuid references public.perfiles (id),
  add column validado_en  timestamptz;

alter table public.productos
  add column estado       public.estado_catalogo not null default 'VALIDADO',
  add column clase_abc    public.clase_abc,
  add column abc_calculado_en date,
  add column creado_por   uuid default auth.uid() references public.perfiles (id),
  add column validado_por uuid references public.perfiles (id),
  add column validado_en  timestamptz;

comment on column public.productos.estado is
  'PROVISIONAL = alta de operación sin revisar: se puede recibir y contar, pero el jefe del área debe validarlo.';
comment on column public.productos.clase_abc is
  'A = ~80 % del valor comprado, B = el siguiente ~15 %, C = el resto. Fija la frecuencia de conteo.';

-- ---------------------------------------------------------------- índices de parecido
create index genericos_nombre_trgm on public.genericos using gin (nombre_norm extensions.gin_trgm_ops);
create index alias_alias_trgm      on public.alias     using gin (alias_norm extensions.gin_trgm_ops);

-- ---------------------------------------------------------------- búsqueda de parecidos
-- Compara contra genérico + marca + presentación y contra los alias (nombres de factura,
-- inventario y fichas). Corre con los permisos de quien llama: RLS decide qué ve.
create or replace function public.buscar_productos(p_texto text, p_area public.area_app default null,
                                                   p_limite integer default 8)
returns table (producto_id uuid, generico_id uuid, codigo text, generico text, marca text, presentacion text,
               area public.area_app, estado public.estado_catalogo, activo boolean, parecido numeric, coincide_con text)
language sql stable set search_path = ''
as $$
  with t as (select privado.normalizar(p_texto) as q),
  candidatos as (
    select p.id as producto_id, g.id as generico_id, p.codigo, g.nombre as generico, p.marca, p.presentacion, g.area,
           p.estado, p.activo and g.activo as activo,
           greatest(extensions.similarity(t.q, g.nombre_norm || ' ' || privado.normalizar(p.marca)),
                    extensions.word_similarity(t.q, g.nombre_norm || ' ' || privado.normalizar(p.marca)
                                                    || ' ' || privado.normalizar(p.presentacion))) as parecido,
           g.nombre || coalesce(nullif(' ' || p.marca, ' '), '') as coincide_con
      from t, public.productos p join public.genericos g on g.id = p.generico_id
     where p_area is null or g.area = p_area
    union all
    select p.id, g.id, p.codigo, g.nombre, p.marca, p.presentacion, g.area,
           p.estado, p.activo and g.activo,
           greatest(extensions.similarity(t.q, a.alias_norm), extensions.word_similarity(t.q, a.alias_norm)),
           a.alias
      from t, public.alias a join public.genericos g on g.id = a.generico_id
      join public.productos p on p.generico_id = g.id and (a.producto_id is null or p.id = a.producto_id)
     where p_area is null or g.area = p_area
  ),
  -- el mejor parecido de cada producto (por su nombre o por cualquiera de sus alias)
  mejor as (
    select distinct on (c.producto_id) c.*
      from candidatos c
     where c.parecido >= 0.3 and length((select q from t)) >= 2
     order by c.producto_id, c.parecido desc
  )
  select m.producto_id, m.generico_id, m.codigo, m.generico, m.marca, m.presentacion, m.area, m.estado, m.activo,
         round(m.parecido::numeric, 2), m.coincide_con
    from mejor m
   order by m.parecido desc, m.activo desc, m.codigo
   limit greatest(1, least(coalesce(p_limite, 8), 50))
$$;

-- ---------------------------------------------------------------- código de un genérico nuevo
create or replace function privado.codigo_generico(p_area public.area_app, p_tipo public.tipo_generico)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_prefijo text := (case p_area when 'BAR' then 'BAR' else 'COC' end) || '_' || (case p_tipo when 'MPI' then 'MPi' else 'MPe' end);
  v_n integer;
begin
  perform pg_advisory_xact_lock(hashtext('codigo_generico:' || v_prefijo));
  select coalesce(max(substring(g.codigo from '^' || v_prefijo || '_(\d+)$')::integer), 0) + 1 into v_n
    from public.genericos g where g.codigo ~ ('^' || v_prefijo || '_\d+$');
  return v_prefijo || '_' || lpad(v_n::text, 4, '0');
end
$$;

-- ---------------------------------------------------------------- crear producto (provisional)
-- p: {area, generico_id? | generico: {nombre, tipo, unidad_base, categoria?},
--     marca, presentacion, unidad_compra, contenido_base?, contenido_variable?, nota?,
--     motivo_forzado?}
-- Bloqueo (B) si hay parecidos ≥ 0,6: se crea solo con un motivo («no es el mismo porque…»).
create or replace function public.crear_producto(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_area     public.area_app;
  v_gen      public.genericos%rowtype;
  v_tipo     public.tipo_generico;
  v_ub       public.unidad_base;
  v_nombre   text := nullif(trim(p #>> '{generico,nombre}'), '');
  v_marca    text := coalesce(trim(p ->> 'marca'), '');
  v_pres     text := coalesce(trim(p ->> 'presentacion'), '');
  v_ucompra  text := upper(nullif(trim(p ->> 'unidad_compra'), ''));
  v_cont     numeric;
  v_var      boolean := coalesce((p ->> 'contenido_variable')::boolean, false);
  v_motivo   text := nullif(trim(p ->> 'motivo_forzado'), '');
  f text[] := '{}'; b text[] := '{}'; a text[] := '{}';
  v_rechazo  jsonb;
  v_id       uuid := gen_random_uuid();
  v_codigo   text;
  v_n        integer := 0;
  r          record;
begin
  begin v_area := (p ->> 'area')::public.area_app;
  exception when others then raise exception 'Área no válida: %', p ->> 'area'; end;
  if not privado.puede_operar(v_area) then
    raise exception 'Sin permiso para crear productos en %.', v_area using errcode = '42501';
  end if;

  begin v_cont := nullif(p ->> 'contenido_base', '')::numeric;
  exception when others then f := f || ('El contenido «' || (p ->> 'contenido_base') || '» no es un número.'); end;

  -- genérico: existente o nuevo (también provisional)
  if nullif(p ->> 'generico_id', '') is not null then
    select * into v_gen from public.genericos g where g.id = (p ->> 'generico_id')::uuid;
    if v_gen.id is null then f := f || 'El genérico elegido no existe.'::text;
    elsif v_gen.area <> v_area then f := f || ('El genérico ' || v_gen.nombre || ' es de ' || v_gen.area || ', no de ' || v_area || '.');
    elsif v_gen.tipo in ('BEBIDA', 'PLATO') then f := f || 'Las bebidas y platos de carta no se compran ni se cuentan.'::text;
    end if;
    v_ub := v_gen.unidad_base;
  else
    if v_nombre is null or length(v_nombre) < 3 then f := f || 'Falta el nombre genérico (mínimo 3 letras).'::text; end if;
    begin v_tipo := coalesce(nullif(p #>> '{generico,tipo}', ''), 'MPe')::public.tipo_generico;
    exception when others then f := f || ('Tipo no válido: ' || (p #>> '{generico,tipo}')); end;
    if v_tipo not in ('MPe', 'MPI') then f := f || 'Un producto nuevo es MPe (se compra) o MPI (se produce).'::text; end if;
    begin v_ub := (p #>> '{generico,unidad_base}')::public.unidad_base;
    exception when others then f := f || 'La unidad base debe ser g, ml o und.'::text; end;
    if v_ub is null then f := f || 'Falta la unidad base (g, ml o und).'::text; end if;
    if nullif(p #>> '{generico,categoria}', '') is not null
       and not exists (select 1 from public.categorias c where c.codigo = p #>> '{generico,categoria}' and c.area = v_area and c.activo) then
      f := f || ('La categoría ' || (p #>> '{generico,categoria}') || ' no existe en ' || v_area || '.');
    end if;
    if exists (select 1 from public.genericos g where g.area = v_area and g.nombre_norm = privado.normalizar(v_nombre)) then
      f := f || ('Ya existe el genérico «' || v_nombre || '» en ' || v_area || ': elígelo en vez de crearlo.');
    end if;
  end if;

  -- presentación y factor de compra
  if v_ucompra is null or v_ucompra !~ '^[A-Z]{1,6}$' then f := f || 'Falta la unidad de compra (BOT, PAQ, KG, UND…).'::text; end if;
  if not v_var and (v_cont is null or v_cont <= 0) then
    f := f || 'Falta cuánto trae una unidad de compra en unidad base (o márcalo como contenido variable).'::text;
  end if;
  if v_var then v_cont := null; end if;
  if v_pres = '' then f := f || 'Falta la presentación («Botella 750 ml», «Bolsa 1.000 g», «Granel»).'::text; end if;
  if v_gen.id is not null and exists (select 1 from public.productos x where x.generico_id = v_gen.id
                                         and privado.normalizar(x.marca) = privado.normalizar(v_marca)
                                         and privado.normalizar(x.presentacion) = privado.normalizar(v_pres)) then
    f := f || 'Ese genérico ya tiene un producto con la misma marca y presentación.'::text;
  end if;

  -- parecidos: bloqueo que se levanta con motivo
  if cardinality(f) = 0 then
    for r in select * from public.buscar_productos(concat_ws(' ', coalesce(v_gen.nombre, v_nombre), nullif(v_marca, ''), nullif(v_pres, '')), v_area, 5)
              where parecido >= 0.6 loop
      b := b || ('Se parece a ' || r.codigo || ' · ' || concat_ws(' · ', r.generico, nullif(r.marca, ''), nullif(r.presentacion, ''))
                 || ' (' || round(r.parecido * 100) || ' %).');
    end loop;
  end if;
  if cardinality(b) > 0 then
    a := a || 'Si es el mismo producto, úsalo; si es otro, escribe por qué en el motivo.'::text;
  end if;

  v_rechazo := privado.rechazo('productos', f, b, a, v_motivo);
  if v_rechazo is not null then return v_rechazo; end if;

  if v_gen.id is null then
    insert into public.genericos (codigo, nombre, tipo, categoria, area, unidad_base, estado, nota)
    values (privado.codigo_generico(v_area, v_tipo), v_nombre, v_tipo, nullif(p #>> '{generico,categoria}', ''),
            v_area, v_ub, 'PROVISIONAL', 'Alta desde la app: falta validar.')
    returning * into v_gen;
  end if;

  perform pg_advisory_xact_lock(hashtext('codigo_producto:' || v_gen.codigo));
  loop
    v_n := v_n + 1;
    v_codigo := v_gen.codigo || '-P' || lpad(v_n::text, 2, '0');
    exit when not exists (select 1 from public.productos x where x.codigo = v_codigo);
  end loop;

  insert into public.productos (id, codigo, generico_id, marca, presentacion, unidad_compra, contenido_base,
                                contenido_variable, estado, nota)
  values (v_id, v_codigo, v_gen.id, v_marca, v_pres, v_ucompra, v_cont, v_var, 'PROVISIONAL',
          concat_ws(' · ', nullif(trim(p ->> 'nota'), ''), case when v_motivo is not null and cardinality(b) > 0
                                                              then 'Creado pese a parecidos: ' || v_motivo end));

  perform privado.bitacora('PRODUCTO PROVISIONAL', 'productos', v_codigo,
                           jsonb_build_object('generico', v_gen.codigo, 'parecidos', to_jsonb(b)), v_motivo);
  return privado.resultado(true, v_id, v_codigo, '{}', b, a);
end
$$;

-- ---------------------------------------------------------------- validar un provisional
-- Solo el jefe del área o el admin. Valida también el genérico si era provisional.
create or replace function public.validar_producto(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v record;
begin
  select p.id, p.codigo, p.estado, g.id as generico_id, g.area, g.estado as estado_gen
    into v from public.productos p join public.genericos g on g.id = p.generico_id where p.id = p_id;
  if v.id is null then raise exception 'No existe el producto.'; end if;
  if not privado.edita_area(v.area) then
    raise exception 'Solo el jefe de % o el admin validan productos.', v.area using errcode = '42501';
  end if;
  if v.estado = 'VALIDADO' then return privado.resultado(true, v.id, v.codigo, '{}', '{}', array['Ya estaba validado.']); end if;
  update public.productos set estado = 'VALIDADO', validado_por = auth.uid(), validado_en = now() where id = v.id;
  if v.estado_gen = 'PROVISIONAL' then
    update public.genericos set estado = 'VALIDADO', validado_por = auth.uid(), validado_en = now() where id = v.generico_id;
  end if;
  perform privado.bitacora('PRODUCTO VALIDADO', 'productos', v.codigo, null);
  return privado.resultado(true, v.id, v.codigo, '{}', '{}', '{}');
end
$$;

-- ---------------------------------------------------------------- permisos
revoke execute on function privado.codigo_generico(public.area_app, public.tipo_generico) from public;
revoke execute on function public.buscar_productos(text, public.area_app, integer),
                           public.crear_producto(jsonb), public.validar_producto(uuid) from public, anon;
grant execute on function public.buscar_productos(text, public.area_app, integer),
                          public.crear_producto(jsonb), public.validar_producto(uuid) to authenticated;
