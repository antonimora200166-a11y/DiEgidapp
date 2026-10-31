-- Eliminar (dar de baja) y reactivar productos: solo administración, sin saldo, sin romper fichas.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
\ir fixtures.inc

-- el limón tiene saldo; el cardamomo está en la ficha del sirope; el azúcar tiene una propuesta pendiente
select privado.registrar_movimiento('SALDO_INICIAL', 'c0000000-0000-0000-0000-000000000003', 'BAR_BODEGA', 500, privado.hoy(), 8, 'CONTEO');
insert into public.fichas (id, codigo, generico_id) values ('e0000000-0000-0000-0000-000000000005', '#5', 'b0000000-0000-0000-0000-000000000004');
insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad) values
  ('e0000000-0000-0000-0000-000000000005', 1, 'b0000000-0000-0000-0000-000000000006', 1, 'g');
insert into public.propuestas_unidad (id, producto_id, cambios, actual, seguridad) values
  ('f0000000-0000-0000-0000-000000000201', 'c0000000-0000-0000-0000-000000000002', '{"categoria": "FRUVER"}', '{}', 'BAJA');

create or replace function pg_temp.eliminar(p_ids text[], p_motivo text default 'Producto que no se usa') returns jsonb language sql as $$
  select public.eliminar_productos(p_ids::uuid[], p_motivo)
$$;

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
select throws_like($$ select pg_temp.eliminar(array['c0000000-0000-0000-0000-000000000002']) $$, '%Solo administración%', 'el jefe de bar no elimina');

select pg_temp.como('a0000000-0000-0000-0000-000000000001');  -- admin
select throws_like($$ select pg_temp.eliminar(array['c0000000-0000-0000-0000-000000000002'], 'x') $$, '%por qué%', 'pide motivo');

create temp table r as select pg_temp.eliminar(array['c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003',
                                                     'c0000000-0000-0000-0000-000000000006']) as v;
select is((select (v ->> 'ok')::int from r), 1, 'se elimina solo el azúcar');
select is((select activo from public.productos where id = 'c0000000-0000-0000-0000-000000000002'), false, 'el azúcar queda inactivo');
select is((select activo from public.genericos where id = 'b0000000-0000-0000-0000-000000000002'), false, 'y su genérico, que no tenía más productos');
select ok((select nota from public.productos where id = 'c0000000-0000-0000-0000-000000000002') like '%Eliminado por administración%Producto que no se usa',
          'la nota dice quién y por qué');
select is((select estado from public.propuestas_unidad where id = 'f0000000-0000-0000-0000-000000000201'), 'RECHAZADA', 'su propuesta pendiente se cierra');
select ok((select x ->> 'mensaje' from r, jsonb_array_elements(v -> 'detalle') x where x ->> 'codigo' = 'BAR_MPe_0030-KG') like 'Tiene saldo en el kardex%',
          'el limón con saldo no se elimina');
select ok((select x ->> 'mensaje' from r, jsonb_array_elements(v -> 'detalle') x where x ->> 'codigo' = 'BAR_MPe_0011-G') like '%está en la(s) ficha(s) #5%',
          'el cardamomo de una ficha vigente no se elimina');
select is((select count(*) from public.productos), 7::bigint, 'nada se borró de verdad: siguen los 7 productos');

select is((public.reactivar_productos(array['c0000000-0000-0000-0000-000000000002']::uuid[]) ->> 'ok')::int, 1, 'se reactiva');
select is((select activo from public.genericos where id = 'b0000000-0000-0000-0000-000000000002'), true, 'con su genérico');

select * from finish();
rollback;
