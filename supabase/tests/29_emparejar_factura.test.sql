-- Emparejar las líneas de una factura con lo que se recibe del catálogo.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
\ir fixtures.inc

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar
insert into public.alias (fuente, alias, generico_id, producto_id) values
  ('RECEPCION', 'AZUCAR MANUELITA X 2500 GR', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002');

create temp table e as select * from public.emparejar_factura('BAR', array[
  'LIMÓN TAHITÍ', 'LIMON TAHITI COMUN 2,5KG', 'SIROPE SIMPLE', 'HABICHUELA', 'AZUCAR MANUELITA X 2500 GR']);

select is((select parecido from e where n = 1 and producto_id = 'c0000000-0000-0000-0000-000000000003'), 1.00, 'mismo nombre: 1');
select is((select producto_id from e where n = 2 order by parecido desc limit 1), 'c0000000-0000-0000-0000-000000000003'::uuid,
          'el relleno de la factura (COMUN, 2,5KG) no estorba');
select is((select count(*)::int from e where n = 3), 0, 'lo que se produce (MPI) no sale: no se recibe');
select is((select count(*)::int from e where n = 4), 0, 'lo que no se parece a nada no sale');
select is((select parecido from e where n = 5 limit 1), 0.97, 'un nombre de factura ya aprendido vale casi como el nombre');

select pg_temp.como('a0000000-0000-0000-0000-000000000005');  -- chef
select throws_like($$ select * from public.emparejar_factura('BAR', array['x']) $$, '%Sin permiso%', 'el chef no recibe en bar');

select * from finish();
rollback;
