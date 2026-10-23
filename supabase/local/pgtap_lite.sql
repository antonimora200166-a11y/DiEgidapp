-- Subconjunto mínimo de pgTAP para PGlite, con las mismas firmas que pgTAP:
-- plan, ok, is, isnt, lives_ok, throws_like, finish. En Supabase real se usa pgTAP.
create schema tap;
create sequence tap.n;
grant usage on schema tap to anon, authenticated, service_role;
grant usage on sequence tap.n to anon, authenticated, service_role;

create or replace function tap.plan(n integer) returns text language sql as $$ select '1..' || n $$;

create or replace function tap.ok(pasa boolean, descripcion text default '') returns text
language plpgsql as $$
declare k bigint := nextval('tap.n');
begin
  return case when coalesce(pasa, false) then 'ok ' else 'not ok ' end || k || ' - ' || coalesce(descripcion, '');
end $$;

create or replace function tap.is(tiene anyelement, quiere anyelement, descripcion text default '') returns text
language plpgsql as $$
declare r text := tap.ok(tiene is not distinct from quiere, descripcion);
begin
  if tiene is distinct from quiere then
    r := r || E'\n#     tiene: ' || coalesce(tiene::text, 'NULL') || E'\n#     quiere: ' || coalesce(quiere::text, 'NULL');
  end if;
  return r;
end $$;

create or replace function tap.isnt(tiene anyelement, no_quiere anyelement, descripcion text default '') returns text
language plpgsql as $$
begin return tap.ok(tiene is distinct from no_quiere, descripcion); end $$;

create or replace function tap.lives_ok(consulta text, descripcion text default '') returns text
language plpgsql as $$
begin
  execute consulta;
  return tap.ok(true, descripcion);
exception when others then
  return tap.ok(false, descripcion) || E'\n#     murió: ' || sqlerrm;
end $$;

create or replace function tap.throws_like(consulta text, patron text, descripcion text default '') returns text
language plpgsql as $$
begin
  execute consulta;
  return tap.ok(false, descripcion) || E'\n#     no lanzó ningún error';
exception when others then
  if sqlerrm like patron then return tap.ok(true, descripcion); end if;
  return tap.ok(false, descripcion) || E'\n#     error: ' || sqlerrm || E'\n#     esperaba: ' || patron;
end $$;

create or replace function tap.finish() returns setof text language sql as $$ select null::text where false $$;

grant execute on all functions in schema tap to anon, authenticated, service_role;
