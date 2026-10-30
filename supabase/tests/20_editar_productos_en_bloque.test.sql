-- Cambios en bloque del catálogo (public.editar_productos) sobre las reglas de editar_producto.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);
\ir fixtures.inc

insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base, estado) values
  ('b0000000-0000-0000-0000-000000000201', 'BAR_MPe_0951', 'Hierbabuena', 'MPe', null, 'BAR', 'und', 'PROVISIONAL'),
  ('b0000000-0000-0000-0000-000000000202', 'BAR_MPe_0952', 'Menta', 'MPe', null, 'BAR', 'und', 'PROVISIONAL');
insert into public.productos (id, codigo, generico_id, marca, presentacion, unidad_compra, contenido_base, estado) values
  ('c0000000-0000-0000-0000-000000000201', 'BAR_MPe_0951-P01', 'b0000000-0000-0000-0000-000000000201', '', 'Atado', 'UND', 1, 'PROVISIONAL'),
  ('c0000000-0000-0000-0000-000000000202', 'BAR_MPe_0952-P01', 'b0000000-0000-0000-0000-000000000202', '', 'Atado', 'UND', 1, 'PROVISIONAL');
-- el sirope está en una ficha: su unidad no se puede cambiar
insert into public.fichas (codigo, generico_id) values ('#5', 'b0000000-0000-0000-0000-000000000004');

create or replace function pg_temp.bloque(p_ids text[], p_cambios jsonb, p_validar boolean default false) returns jsonb language sql as $$
  select public.editar_productos(p_ids::uuid[], p_cambios, p_validar)
$$;

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar
select is((pg_temp.bloque(array['c0000000-0000-0000-0000-000000000201'], '{}', true) -> 'detalle' -> 0 ->> 'ok')::boolean, false,
          'el aux no cambia productos: cada uno vuelve rechazado');

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
create temp table r1 as select pg_temp.bloque(array['c0000000-0000-0000-0000-000000000201', 'c0000000-0000-0000-0000-000000000202'],
  '{"generico": {"unidad_base": "g", "categoria": "FRUVER"}, "producto": {"unidad_compra": "KG", "contenido_base": 1000}}', true) as v;
select is((select (v ->> 'ok')::int from r1), 2, 'los dos productos cambian');
select is((select unidad_base::text from public.genericos where id = 'b0000000-0000-0000-0000-000000000201'), 'g', 'unidad base a g');
select is((select categoria from public.genericos where id = 'b0000000-0000-0000-0000-000000000202'), 'FRUVER', 'categoría asignada');
select is((select unidad_compra || ' ' || contenido_base from public.productos where id = 'c0000000-0000-0000-0000-000000000201'), 'KG 1000',
          'unidad de compra y contenido');
select is((select count(*) from public.productos where id in ('c0000000-0000-0000-0000-000000000201', 'c0000000-0000-0000-0000-000000000202')
             and estado = 'VALIDADO'), 2::bigint, 'y quedaron validados de una vez');

-- validar solamente
update public.productos set estado = 'PROVISIONAL' where id = 'c0000000-0000-0000-0000-000000000003';
select is((pg_temp.bloque(array['c0000000-0000-0000-0000-000000000003'], '{}', true) ->> 'ok')::int, 1, 'validar en bloque sin cambiar nada');

-- uno se puede y otro no: el que no, no detiene al otro
create temp table r2 as select pg_temp.bloque(array['c0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000006'],
  '{"generico": {"conservacion": "Ambiente", "unidad_base": "ml"}}') as v;
select is((select (v ->> 'fallidos')::int from r2), 1, 'el sirope (en una ficha) no cambia de unidad');
select ok((select x -> 'mensajes' ->> 0 from r2, jsonb_array_elements(v -> 'detalle') x where x ->> 'codigo' = 'BAR_MPi_0006-G')
          like '%está en una ficha técnica%', 'y dice por qué');
select is((select unidad_base::text from public.genericos where id = 'b0000000-0000-0000-0000-000000000006'), 'ml', 'el cardamomo sí cambia');
select is((select unidad_base::text from public.genericos where id = 'b0000000-0000-0000-0000-000000000004'), 'g', 'el sirope quedó como estaba');

select throws_like($$ select pg_temp.bloque(array['c0000000-0000-0000-0000-000000000006'], '{"generico": {"nombre": "Otro"}}') $$,
                   '%En bloque solo se cambia%', 'el nombre no se cambia en bloque');
select throws_like($$ select pg_temp.bloque(array[]::text[], '{}', true) $$, '%No hay productos%', 'sin selección no hace nada');

select * from finish();
rollback;
