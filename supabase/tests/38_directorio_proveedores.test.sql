-- Directorio de proveedores: renombrar deja alias, desactivar, y lo que no se puede.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
\ir fixtures.inc

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar
select throws_like($$ select public.editar_proveedor('d0000000-0000-0000-0000-000000000002', 'Frutería La 14', null, true) $$,
                   '%Solo administración%', 'el aux no organiza proveedores');

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
select ok((public.editar_proveedor('d0000000-0000-0000-0000-000000000002', 'Frutería La 14', '900.123.456-7', true) ->> 'ok')::boolean, 'se renombra');
select is(privado.proveedor_por_nombre('Frutería'), 'd0000000-0000-0000-0000-000000000002'::uuid, 'el nombre viejo sigue reconociéndose');
select is((select nit from public.proveedores where id = 'd0000000-0000-0000-0000-000000000002'), '900123456-7', 'NIT limpio');
select ok((public.editar_proveedor('d0000000-0000-0000-0000-000000000002', 'Dislicores', null, true) -> 'fatales' ->> 0) like '%Ya hay otro proveedor%',
          'no se repite el nombre de otro');
select public.editar_proveedor('d0000000-0000-0000-0000-000000000002', 'Frutería La 14', null, false);
select is((select activo from public.lista_proveedores() where id = 'd0000000-0000-0000-0000-000000000002'), false, 'se desactiva');

select * from finish();
rollback;
