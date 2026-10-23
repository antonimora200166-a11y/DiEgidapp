-- Solo para correr las pruebas en PGlite (sin Docker). En Supabase real esto ya existe.
-- Reproduce lo mínimo: roles de PostgREST, esquema auth con auth.users y auth.uid(),
-- y los privilegios por defecto que Supabase da sobre el esquema public.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create table auth.users (
  id         uuid primary key,
  email      text,
  created_at timestamptz default now()
);

create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
