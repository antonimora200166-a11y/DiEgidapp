-- Hoja de conteo: qué se recorre en cada zona y quién la puede pedir.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);
\ir fixtures.inc

-- bodega de bar sin asignaciones: trae todo lo inventariable del área, sin bebidas ni agua
select pg_temp.como('a0000000-0000-0000-0000-000000000003');
set local role authenticated;
select is((select count(*) from public.hoja_conteo('BAR_BODEGA')), 6::bigint,
          'zona sin asignaciones: todo lo inventariable de bar (sin cóctel ni agua)');
select is((select bool_or(tiene_kardex) from public.hoja_conteo('BAR_BODEGA')), false, 'sin movimientos, nada tiene kardex');
select throws_like($$ select * from public.hoja_conteo('COC_BODEGA') $$, '%Sin permiso%', 'el aux de bar no pide hojas de cocina');
reset role;

-- con un producto asignado, la zona trae solo lo suyo y lo que tenga saldo ahí
insert into public.ubicacion_productos (ubicacion, producto_id, orden) values ('BAR_BARRA', 'c0000000-0000-0000-0000-000000000001', 1);
select privado.registrar_movimiento('ENTRADA_COMPRA', 'c0000000-0000-0000-0000-000000000002', 'BAR_BARRA', 2500, current_date, 4, 'PRUEBA');
select pg_temp.como('a0000000-0000-0000-0000-000000000003');
set local role authenticated;
select is((select array_agg(codigo order by asignado desc) from public.hoja_conteo('BAR_BARRA')),
          array['BAR_MPe_0079-700', 'BAR_MPe_0005-2500'], 'asignado primero, luego el que tiene saldo en la zona');
select is((select tiene_kardex from public.hoja_conteo('BAR_BARRA') where codigo = 'BAR_MPe_0005-2500'), true,
          'marca lo que ya tiene kardex');
select is((select count(*) from public.hoja_conteo('BAR_BARRA') h where h.codigo like 'BAR_MPe_0011%'), 0::bigint,
          'lo no asignado y sin saldo no aparece');
reset role;

select pg_temp.como('a0000000-0000-0000-0000-000000000004');
set local role authenticated;
select throws_like($$ select * from public.hoja_conteo('BAR_BARRA') $$, '%Sin permiso%', 'servicio no cuenta');
reset role;

select * from finish();
rollback;
