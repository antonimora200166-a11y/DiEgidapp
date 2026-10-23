-- RLS por rol e inmutabilidad vista desde el rol authenticated de PostgREST.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
\ir fixtures.inc

select privado.registrar_movimiento('ENTRADA_COMPRA', 'c0000000-0000-0000-0000-000000000002', 'BAR_BODEGA', 5000, current_date, 5.26, 'PRUEBA');

-- aux de bar
select pg_temp.como('a0000000-0000-0000-0000-000000000003');
set local role authenticated;
select is((select count(*) from public.movimientos), 1::bigint, 'el aux de bar ve el kardex');
select throws_like($$ insert into public.movimientos (fecha, tipo, producto_id, ubicacion, cantidad, saldo_producto, saldo_ubicacion, documento_tipo)
                      values (current_date, 'ENTRADA_COMPRA', 'c0000000-0000-0000-0000-000000000002', 'BAR_BODEGA', 1, 1, 1, 'X') $$,
                   '%permission denied%', 'nadie escribe directo al kardex: solo por las RPC');
select throws_like($$ update public.existencias set cantidad = 0 $$, '%permission denied%', 'un saldo no se edita');
select throws_like($$ insert into public.genericos (codigo, nombre, tipo, area, unidad_base) values ('X1', 'X', 'MPe', 'BAR', 'g') $$,
                   '%row-level security%', 'el aux no crea genéricos');
select is((select count(*) from public.bitacora), 0::bigint, 'el aux no lee la bitácora');
select throws_like($$ select public.anular_documento('RECEPCION', gen_random_uuid(), 'motivo suficientemente largo') $$,
                   '%No existe el documento%', 'las RPC sí están a su alcance');
reset role;

-- jefe de bar: maestros de su área, no de cocina
select pg_temp.como('a0000000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ insert into public.genericos (codigo, nombre, tipo, area, unidad_base) values ('BAR_MPe_9001', 'Vermouth rosso', 'MPe', 'BAR', 'ml') $$,
                'el jefe de bar crea genéricos de bar');
select throws_like($$ insert into public.genericos (codigo, nombre, tipo, area, unidad_base) values ('COC_MPe_9001', 'Harina', 'MPe', 'COCINA', 'g') $$,
                   '%row-level security%', 'el jefe de bar no crea genéricos de cocina');
reset role;

-- servicio: no ve costos ni kardex, ni puede registrar
select pg_temp.como('a0000000-0000-0000-0000-000000000004');
set local role authenticated;
select is((select count(*) from public.movimientos), 0::bigint, 'servicio no ve el kardex');
select throws_like($$ select public.registrar_baja('{"area":"BAR"}') $$, '%Sin permiso%', 'servicio no registra bajas');
reset role;

-- anon: nada
set local role anon;
select throws_like($$ select * from public.perfiles $$, '%permission denied%', 'anon no lee perfiles');
reset role;

-- admin: lee la bitácora, pero no la edita
select pg_temp.como('a0000000-0000-0000-0000-000000000001');
select throws_like($$ update public.bitacora set accion = 'x' $$, '%inmutable%', 'la bitácora no se edita, ni siquiera como dueño');

select * from finish();
rollback;
