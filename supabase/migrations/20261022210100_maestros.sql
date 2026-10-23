-- =====================================================================================
-- SGI Di Égida · 02 · Maestros
-- Genérico = lo que piden fichas y recetas («Ginebra Tanqueray», «Sirope Simple»).
-- Producto = genérico + marca + presentación: es el código del kardex (CLAUDE.md).
-- Toda cantidad se guarda en la unidad base del genérico: g, ml o und.
-- =====================================================================================

create type public.tipo_generico as enum (
  'MPe',        -- materia prima externa: se compra
  'MPI',        -- materia prima intermedia: se produce (siropes, zumos, picadillos)
  'SIN_COSTO',  -- agua o subproducto ya pagado en otro insumo
  'BEBIDA',     -- cóctel o bebida de carta: se vende, no se inventaría
  'PLATO'       -- plato de carta
);

create type public.estado_medida as enum ('MEDIDO', 'DECLARADO', 'SUPUESTO');

-- ---------------------------------------------------------------- ubicaciones
create table public.ubicaciones (
  codigo  text primary key check (codigo ~ '^[A-Z0-9_]+$'),
  nombre  text not null,
  area    public.area_app not null,
  activo  boolean not null default true
);

-- ---------------------------------------------------------------- categorías
-- La categoría es del genérico, no de la línea de recepción (corrige el «kiwi = OTROS»).
create table public.categorias (
  codigo          text primary key check (codigo ~ '^[A-Z0-9_]+$'),
  nombre          text not null,
  area            public.area_app not null,
  exige_sello     boolean not null default false,  -- licores y vinos (B8)
  es_perecedero   boolean not null default false,  -- pide vencimiento
  activo          boolean not null default true
);

-- ---------------------------------------------------------------- genéricos
create table public.genericos (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null unique,            -- BAR_MPe_0079, BAR_MPi_0006 …
  nombre        text not null,
  nombre_norm   text generated always as (privado.normalizar(nombre)) stored,
  tipo          public.tipo_generico not null,
  categoria     text references public.categorias (codigo),
  area          public.area_app not null,
  unidad_base   public.unidad_base not null,
  vida_util_dias integer check (vida_util_dias > 0),
  activo        boolean not null default true,
  nota          text,
  creado_en     timestamptz not null default now(),
  unique (area, nombre_norm)
);

-- ---------------------------------------------------------------- productos (código del kardex)
create table public.productos (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null unique,
  generico_id     uuid not null references public.genericos (id),
  marca           text not null default '',
  presentacion    text not null default '',        -- «Botella 700 ml», «Bolsa 2.500 g», «Granel»
  unidad_compra   text not null,                   -- BOT, CJA, PAQ, KG, GR, UND, LATA …
  contenido_base  numeric check (contenido_base > 0),  -- cuánto trae 1 unidad de compra, en unidad base
  contenido_variable boolean not null default false, -- el contenido se registra en cada recepción
  stock_minimo    numeric check (stock_minimo >= 0),  -- en unidades de compra (botellas, bolsas …)
  stock_maximo    numeric check (stock_maximo >= 0),
  activo          boolean not null default true,
  nota            text,
  creado_en       timestamptz not null default now(),
  unique (generico_id, marca, presentacion),
  check (contenido_variable or contenido_base is not null)
);

comment on column public.productos.contenido_base is
  'Ej.: Ginebra Tanqueray BOT = 700 (ml). Reemplaza FACTORES_COMPRA del Sheet.';

-- ---------------------------------------------------------------- alias de nombres
-- Un nombre de factura, ficha o registro antiguo apunta a UN solo destino por fuente
-- (corrige el «último gana» del catálogo de costos).
create table public.alias (
  id            uuid primary key default gen_random_uuid(),
  fuente        text not null check (fuente in ('RECEPCION', 'FICHA', 'PRODUCCION', 'INVENTARIO', 'RECETA')),
  alias         text not null,
  alias_norm    text generated always as (privado.normalizar(alias)) stored,
  generico_id   uuid not null references public.genericos (id),
  producto_id   uuid references public.productos (id),
  unique (fuente, alias_norm)
);

-- ---------------------------------------------------------------- conversiones de unidad
-- Densidades (ml→g), pesos por unidad (und→g), cucharadas, gotas… Reemplaza PARAMETROS.
create table public.conversiones (
  id            uuid primary key default gen_random_uuid(),
  generico_id   uuid not null references public.genericos (id),
  unidad        text not null check (unidad ~ '^[a-z]+$'),   -- unidad de origen: ml, g, und, cda, gota, bot …
  factor_a_base numeric not null check (factor_a_base > 0),
  estado        public.estado_medida not null default 'MEDIDO',
  medido_por    uuid references public.perfiles (id),
  medido_en     date,
  nota          text,
  unique (generico_id, unidad)
);

-- ---------------------------------------------------------------- taras de botellas
create table public.taras (
  producto_id   uuid primary key references public.productos (id),
  tara_g        numeric check (tara_g > 0),          -- null = falta pesar la botella vacía
  densidad_g_ml numeric check (densidad_g_ml between 0.5 and 2),
  medido_por    uuid references public.perfiles (id),
  medido_en     date
);

-- ---------------------------------------------------------------- proveedores
create table public.proveedores (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  nombre_norm  text generated always as (privado.normalizar(nombre)) stored unique,
  nit          text,
  activo       boolean not null default true,
  creado_en    timestamptz not null default now()
);

-- ---------------------------------------------------------------- parámetros con historia
create table public.parametros (
  clave          text not null check (clave ~ '^[A-Z0-9_]+$'),
  valor          text not null,
  vigente_desde  timestamptz not null default now(),
  descripcion    text,
  creado_por     uuid default auth.uid(),
  primary key (clave, vigente_desde)
);

create or replace function privado.parametro(p_clave text)
returns text
language sql stable security definer set search_path = ''
as $$
  select p.valor from public.parametros p
  where p.clave = p_clave and p.vigente_desde <= now()
  order by p.vigente_desde desc limit 1
$$;

create or replace function privado.parametro_num(p_clave text, p_defecto numeric)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce(nullif(privado.parametro(p_clave), '')::numeric, p_defecto)
$$;

-- Fecha operativa de hoy en la zona del restaurante (corrige el desfase de las 22:00).
create or replace function privado.hoy()
returns date
language sql stable security definer set search_path = ''
as $$
  select (now() at time zone coalesce(privado.parametro('ZONA_HORARIA'), 'America/Bogota'))::date
$$;

-- ---------------------------------------------------------------- fichas técnicas (versionadas)
create table public.fichas (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null,                     -- #5, C01 …
  generico_id    uuid not null references public.genericos (id),  -- MPI, BEBIDA o PLATO resultante
  version        integer not null default 1 check (version > 0),
  neto_esperado  numeric check (neto_esperado > 0), -- en unidad base del genérico resultante
  vigente_desde  date not null default current_date,
  vigente_hasta  date,
  nota           text,
  creado_en      timestamptz not null default now(),
  unique (generico_id, version),
  check (vigente_hasta is null or vigente_hasta >= vigente_desde)
);

create table public.ficha_lineas (
  id           uuid primary key default gen_random_uuid(),
  ficha_id     uuid not null references public.fichas (id),
  linea        integer not null check (linea > 0),
  generico_id  uuid not null references public.genericos (id),
  cantidad     numeric check (cantidad > 0),        -- null = la ficha no trae cantidad (garnish)
  unidad       text not null check (unidad ~ '^[a-z]+$'),
  nota         text,
  unique (ficha_id, linea)
);

-- ---------------------------------------------------------------- precio de carta (con historia)
create table public.precios_venta (
  id                   uuid primary key default gen_random_uuid(),
  generico_id          uuid not null references public.genericos (id),
  precio_con_impuesto  numeric not null check (precio_con_impuesto > 0),
  vigente_desde        date not null default current_date,
  creado_por           uuid default auth.uid(),
  unique (generico_id, vigente_desde)
);

-- ---------------------------------------------------------------- conversión a unidad base
-- Devuelve null si falta la conversión: el llamador decide si es fatal.
create or replace function privado.a_base(p_generico uuid, p_cantidad numeric, p_unidad text)
returns numeric
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_base public.unidad_base;
  v_tipo public.tipo_generico;
  v_factor numeric;
  u text := lower(trim(p_unidad));
begin
  select g.unidad_base, g.tipo into v_base, v_tipo from public.genericos g where g.id = p_generico;
  if v_base is null then return null; end if;
  if u = v_base::text then return p_cantidad; end if;
  if u = 'kg' and v_base = 'g' then return p_cantidad * 1000; end if;
  if u = 'l' and v_base = 'ml' then return p_cantidad * 1000; end if;
  -- lo que se cuenta por unidad: una botella, lata o unidad es 1 und
  if v_base = 'und' and u in ('bot', 'lata', 'unidad') then return p_cantidad; end if;
  -- agua y subproductos sin costo: ml ↔ g se toma 1:1 (no afecta costo)
  if v_tipo = 'SIN_COSTO' and u in ('ml', 'g') and v_base::text in ('ml', 'g') then return p_cantidad; end if;
  select c.factor_a_base into v_factor from public.conversiones c
   where c.generico_id = p_generico and c.unidad = u;
  return case when v_factor is null then null else p_cantidad * v_factor end;
end
$$;

-- ---------------------------------------------------------------- auditoría y RLS
create trigger ubicaciones_auditar after insert or update on public.ubicaciones for each row execute function privado.auditar();
create trigger categorias_auditar  after insert or update on public.categorias  for each row execute function privado.auditar();
create trigger genericos_auditar   after insert or update on public.genericos   for each row execute function privado.auditar();
create trigger productos_auditar   after insert or update on public.productos   for each row execute function privado.auditar();
create trigger alias_auditar       after insert or update on public.alias       for each row execute function privado.auditar();
create trigger conversiones_auditar after insert or update on public.conversiones for each row execute function privado.auditar();
create trigger taras_auditar       after insert or update on public.taras       for each row execute function privado.auditar();
create trigger proveedores_auditar after insert or update on public.proveedores for each row execute function privado.auditar();
create trigger fichas_auditar      after insert or update on public.fichas      for each row execute function privado.auditar();
create trigger ficha_lineas_auditar after insert or update or delete on public.ficha_lineas for each row execute function privado.auditar();

-- Nada maestro se borra: se desactiva (activo = false). Parámetros y precios: nueva vigencia.
create trigger ubicaciones_sin_borrado  before delete on public.ubicaciones  for each row execute function privado.bloquear_cambios();
create trigger categorias_sin_borrado   before delete on public.categorias   for each row execute function privado.bloquear_cambios();
create trigger genericos_sin_borrado    before delete on public.genericos    for each row execute function privado.bloquear_cambios();
create trigger productos_sin_borrado    before delete on public.productos    for each row execute function privado.bloquear_cambios();
create trigger proveedores_sin_borrado  before delete on public.proveedores  for each row execute function privado.bloquear_cambios();
create trigger fichas_sin_borrado       before delete on public.fichas       for each row execute function privado.bloquear_cambios();
create trigger parametros_inmutables    before update or delete on public.parametros    for each row execute function privado.bloquear_cambios();
create trigger precios_inmutables       before update or delete on public.precios_venta for each row execute function privado.bloquear_cambios();

-- Lectura: cualquier usuario activo. Escritura: admin, o el jefe del área del registro.
-- Las tablas sin área propia (productos, alias, conversiones, taras, fichas) la heredan del genérico.
create or replace function privado.edita_area(p_area public.area_app)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select privado.tiene_rol('admin')
      or (p_area = 'BAR' and privado.tiene_rol('jefe_bar'))
      or (p_area = 'COCINA' and privado.tiene_rol('chef', 'sous_chef'))
$$;

create or replace function privado.edita_generico(p_generico uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select privado.edita_area((select g.area from public.genericos g where g.id = p_generico))
$$;

create or replace function privado.usuario_activo()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select privado.rol_actual() is not null
$$;

do $$
declare t text;
begin
  foreach t in array array['ubicaciones', 'categorias', 'genericos', 'productos', 'alias', 'conversiones',
                           'taras', 'proveedores', 'parametros', 'fichas', 'ficha_lineas', 'precios_venta']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy %I on public.%I for select to authenticated using (privado.usuario_activo())',
                   t || '_leer', t);
  end loop;
end $$;

create policy ubicaciones_escribir on public.ubicaciones for insert to authenticated with check (privado.tiene_rol('admin'));
create policy ubicaciones_editar   on public.ubicaciones for update to authenticated using (privado.tiene_rol('admin'));
create policy categorias_escribir  on public.categorias  for insert to authenticated with check (privado.edita_area(area));
create policy categorias_editar    on public.categorias  for update to authenticated using (privado.edita_area(area)) with check (privado.edita_area(area));
create policy genericos_escribir   on public.genericos   for insert to authenticated with check (privado.edita_area(area));
create policy genericos_editar     on public.genericos   for update to authenticated using (privado.edita_area(area)) with check (privado.edita_area(area));
create policy productos_escribir   on public.productos   for insert to authenticated with check (privado.edita_generico(generico_id));
create policy productos_editar     on public.productos   for update to authenticated using (privado.edita_generico(generico_id)) with check (privado.edita_generico(generico_id));
create policy alias_escribir       on public.alias       for insert to authenticated with check (privado.edita_generico(generico_id));
create policy alias_editar         on public.alias       for update to authenticated using (privado.edita_generico(generico_id));
create policy conversiones_escribir on public.conversiones for insert to authenticated with check (privado.edita_generico(generico_id));
create policy conversiones_editar  on public.conversiones for update to authenticated using (privado.edita_generico(generico_id));
create policy taras_escribir       on public.taras       for insert to authenticated
  with check (privado.edita_generico((select p.generico_id from public.productos p where p.id = producto_id)));
create policy taras_editar         on public.taras       for update to authenticated
  using (privado.edita_generico((select p.generico_id from public.productos p where p.id = producto_id)));
create policy proveedores_escribir on public.proveedores for insert to authenticated
  with check (privado.tiene_rol('admin', 'jefe_bar', 'aux_bar', 'chef', 'sous_chef'));
create policy proveedores_editar   on public.proveedores for update to authenticated using (privado.tiene_rol('admin'));
create policy parametros_escribir  on public.parametros  for insert to authenticated with check (privado.tiene_rol('admin'));
create policy fichas_escribir      on public.fichas      for insert to authenticated with check (privado.edita_generico(generico_id));
create policy fichas_editar        on public.fichas      for update to authenticated using (privado.edita_generico(generico_id));
create policy ficha_lineas_escribir on public.ficha_lineas for insert to authenticated
  with check (privado.edita_generico((select f.generico_id from public.fichas f where f.id = ficha_id)));
create policy ficha_lineas_editar  on public.ficha_lineas for update to authenticated
  using (privado.edita_generico((select f.generico_id from public.fichas f where f.id = ficha_id)));
create policy ficha_lineas_borrar  on public.ficha_lineas for delete to authenticated
  using (privado.edita_generico((select f.generico_id from public.fichas f where f.id = ficha_id)));
create policy precios_escribir     on public.precios_venta for insert to authenticated with check (privado.edita_generico(generico_id));
