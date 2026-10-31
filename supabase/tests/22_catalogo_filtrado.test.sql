-- Catálogo con filtros y agrupación (public.catalogo_filtrado).
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
\ir fixtures.inc

create or replace function pg_temp.n(p jsonb, p_agrupar text default null) returns bigint language sql as $$
  select coalesce(max(total), 0) from public.catalogo_filtrado(p, 'nombre', p_agrupar, 500, 0)
$$;
insert into public.costos_referencia (producto_id, costo_unitario_base, fuente) values ('c0000000-0000-0000-0000-000000000002', 5.26, 'prueba');
insert into public.taras (producto_id) values ('c0000000-0000-0000-0000-000000000001');
update public.productos set estado = 'PROVISIONAL' where id = 'c0000000-0000-0000-0000-000000000006';
update public.genericos set conservacion = 'Refrigerado' where id = 'b0000000-0000-0000-0000-000000000003';

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar

select is(pg_temp.n('{}'), 7::bigint, 'sin filtros: los 7 productos activos');
select is(pg_temp.n('{"tipos": ["MPe"]}'), 4::bigint, 'tipo MPe');
select is(pg_temp.n('{"tipos": ["MPI", "SIN_COSTO"]}'), 3::bigint, 'dentro de un grupo se suman (MPI o sin costo)');
select is(pg_temp.n('{"unidades": ["g"]}'), 5::bigint, 'unidad base g');
select is(pg_temp.n('{"unidades": ["g"], "tipos": ["MPe"]}'), 3::bigint, 'entre grupos se cruzan (g y MPe)');
select is(pg_temp.n('{"categorias": ["INSUMO_SECO"]}'), 2::bigint, 'por categoría');
select is(pg_temp.n('{"conservacion": ["Refrigerado"]}'), 1::bigint, 'por conservación');
select is(pg_temp.n('{"conservacion": ["SIN"]}'), 6::bigint, 'sin conservación');
select is(pg_temp.n('{"estados": ["PROVISIONAL"]}'), 1::bigint, 'provisionales');
select is(pg_temp.n('{"faltas": ["tara"]}'), 1::bigint, 'le falta: tara');
select is(pg_temp.n('{"faltas": ["costo"], "tipos": ["MPe"]}'), 3::bigint, 'le falta: costo (el azúcar tiene costo de referencia)');
select is(pg_temp.n('{"q": "manuelita"}'), 1::bigint, 'búsqueda por marca, sin tildes ni mayúsculas');
select is(pg_temp.n('{"activos": "inactivos"}'), 0::bigint, 'inactivos: ninguno');
select is((select count(distinct grupo) from public.catalogo_filtrado('{}', 'nombre', 'unidad', 500, 0)), 2::bigint,
          'agrupar por unidad: g y ml');
select is((select total_grupo from public.catalogo_filtrado('{}', 'nombre', 'unidad', 500, 0) where grupo = 'ml' limit 1), 2::bigint,
          'cada grupo trae su total');

select pg_temp.como('a0000000-0000-0000-0000-000000000004');  -- servicio: ve el catálogo sin costos
select is((select costo_referencia from public.catalogo_filtrado('{"q": "manuelita"}') limit 1), null::numeric,
          'servicio no ve costos');

select * from finish();
rollback;
