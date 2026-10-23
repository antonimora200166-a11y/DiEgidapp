-- =====================================================================================
-- SGI Di Égida · 01 · Base: tipos, perfiles con rol, bitácora e inmutabilidad
-- Principios (CLAUDE.md): nada se borra, los errores se corrigen con reversa, todo queda
-- en bitácora. Las funciones internas viven en el esquema «privado», que PostgREST no expone.
-- =====================================================================================

create schema if not exists privado;
revoke all on schema privado from public;
grant usage on schema privado to authenticated, service_role;

-- ---------------------------------------------------------------- tipos de dominio
create type public.rol_app as enum (
  'admin',        -- administración: todo
  'jefe_bar',     -- fichas y recetas de bar, anulaciones de bar
  'aux_bar',      -- recepción, producción, bajas y conteos de bar
  'chef',         -- fichas de cocina, anulaciones de cocina
  'sous_chef',
  'aux_cocina',
  'servicio',     -- asesores de servicio: no ven costos ni kardex
  'auditor'       -- solo lectura
);

create type public.area_app as enum ('BAR', 'COCINA');
create type public.unidad_base as enum ('g', 'ml', 'und');

-- ---------------------------------------------------------------- perfiles
-- Un perfil por usuario de Supabase Auth. La cédula NO se guarda aquí.
create table public.perfiles (
  id          uuid primary key references auth.users (id) on delete restrict,
  nombre      text not null check (length(trim(nombre)) > 0),
  rol         public.rol_app not null,
  areas       public.area_app[] not null default '{}',
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

comment on table public.perfiles is 'Usuarios de la app con su rol y las áreas donde operan.';

-- ---------------------------------------------------------------- utilidades
create or replace function privado.rol_actual()
returns public.rol_app
language sql stable security definer set search_path = ''
as $$
  select p.rol from public.perfiles p where p.id = auth.uid() and p.activo
$$;

create or replace function privado.tiene_rol(variadic roles public.rol_app[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(privado.rol_actual() = any (roles), false)
$$;

-- ¿El usuario actual opera en el área? El admin opera en todas.
create or replace function privado.opera_en(p_area public.area_app)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.activo
      and (p.rol = 'admin' or p_area = any (p.areas))
  )
$$;

-- Roles que pueden ver costos y kardex (todos menos servicio).
create or replace function privado.ve_costos()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select privado.tiene_rol('admin', 'jefe_bar', 'aux_bar', 'chef', 'sous_chef', 'aux_cocina', 'auditor')
$$;

-- Normaliza un nombre para compararlo: minúsculas, sin tildes, espacios simples.
create or replace function privado.normalizar(s text)
returns text
language sql immutable
as $$
  select trim(regexp_replace(
    translate(lower(coalesce(s, '')), 'áéíóúüñàèìòù', 'aeiouunaeiou'),
    '\s+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------- bitácora
create table public.bitacora (
  id          bigint generated always as identity primary key,
  ocurrido_en timestamptz not null default now(),
  usuario_id  uuid default auth.uid(),
  accion      text not null,
  entidad     text,
  entidad_id  text,
  detalle     jsonb,
  motivo      text
);

comment on table public.bitacora is 'Quién, cuándo, qué y por qué. Solo se agrega.';

create or replace function privado.bitacora(p_accion text, p_entidad text, p_entidad_id text,
                                            p_detalle jsonb default null, p_motivo text default null)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.bitacora (accion, entidad, entidad_id, detalle, motivo)
  values (p_accion, p_entidad, p_entidad_id, p_detalle, p_motivo)
$$;

-- Disparador genérico: impide UPDATE y DELETE en libros mayores.
create or replace function privado.bloquear_cambios()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Registro inmutable en %: los errores se corrigen con una reversa.', tg_table_name
    using errcode = 'P0001';
end
$$;

create trigger bitacora_inmutable
  before update or delete on public.bitacora
  for each row execute function privado.bloquear_cambios();

-- Disparador genérico de auditoría para tablas maestras editables.
create or replace function privado.auditar()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.bitacora (accion, entidad, entidad_id, detalle)
  values (tg_op, tg_table_name,
          coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id', to_jsonb(new) ->> 'codigo'),
          jsonb_build_object('antes', case when tg_op <> 'INSERT' then to_jsonb(old) end,
                             'despues', case when tg_op <> 'DELETE' then to_jsonb(new) end));
  return coalesce(new, old);
end
$$;

create trigger perfiles_auditar
  after insert or update on public.perfiles
  for each row execute function privado.auditar();

create trigger perfiles_sin_borrado
  before delete on public.perfiles
  for each row execute function privado.bloquear_cambios();

-- ---------------------------------------------------------------- consecutivos
-- Códigos legibles (REC-BAR-20261022-001, PRO-2026-066) sin carreras entre dos iPads.
create table privado.consecutivos (
  prefijo text primary key,
  ultimo  integer not null default 0
);

create or replace function privado.siguiente_codigo(p_prefijo text, p_ancho int default 3)
returns text
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  insert into privado.consecutivos (prefijo, ultimo) values (p_prefijo, 1)
  on conflict (prefijo) do update set ultimo = privado.consecutivos.ultimo + 1
  returning ultimo into n;
  return p_prefijo || '-' || lpad(n::text, p_ancho, '0');
end
$$;

-- ---------------------------------------------------------------- RLS de la base
alter table public.perfiles enable row level security;
alter table public.bitacora enable row level security;

create policy perfiles_leer on public.perfiles
  for select to authenticated using (id = auth.uid() or privado.tiene_rol('admin', 'auditor'));
create policy perfiles_admin_insertar on public.perfiles
  for insert to authenticated with check (privado.tiene_rol('admin'));
create policy perfiles_admin_actualizar on public.perfiles
  for update to authenticated using (privado.tiene_rol('admin')) with check (privado.tiene_rol('admin'));

create policy bitacora_leer on public.bitacora
  for select to authenticated using (privado.tiene_rol('admin', 'auditor'));

revoke all on public.perfiles, public.bitacora from anon;
revoke insert, update, delete on public.bitacora from authenticated;
