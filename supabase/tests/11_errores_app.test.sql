-- Errores de la app: cualquiera reporta los suyos, solo administración los lee, nadie los edita.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
\ir fixtures.inc

select pg_temp.como('a0000000-0000-0000-0000-000000000003');
set local role authenticated;
select lives_ok($$ select public.reportar_error('/catalogo', 'TypeError: x is undefined', 'pila…', 'Chrome Android', 'abc123') $$,
                'el aux reporta un error de su celular');
select is((select count(*) from public.errores_app), 0::bigint, 'pero no lee los errores');
select throws_like($$ insert into public.errores_app (origen, mensaje) values ('SERVIDOR', 'falso') $$, '%permission denied%',
                   'ni escribe directo en la tabla');
reset role;

select pg_temp.como('a0000000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select usuario_id::text || '|' || origen || '|' || ruta from public.errores_app),
          'a0000000-0000-0000-0000-000000000003|NAVEGADOR|/catalogo', 'el admin lo ve, con quién y dónde');
reset role;
select throws_like($$ delete from public.errores_app $$, '%inmutable%', 'un error registrado no se borra');

select set_config('request.jwt.claims', '', true);
select public.reportar_error('/x', 'sin sesión');
select is((select count(*) from public.errores_app), 1::bigint, 'sin sesión no se registra nada');

select * from finish();
rollback;
