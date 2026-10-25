-- Corregir un producto (y validarlo en el mismo paso) y la contraseña temporal.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);
\ir fixtures.inc

insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base, estado) values
  ('b0000000-0000-0000-0000-000000000201', 'BAR_MPe_0950', 'Manzana gala', 'MPe', null, 'BAR', 'und', 'PROVISIONAL');
insert into public.productos (id, codigo, generico_id, marca, presentacion, unidad_compra, contenido_base, estado) values
  ('c0000000-0000-0000-0000-000000000201', 'BAR_MPe_0950-P01', 'b0000000-0000-0000-0000-000000000201', '', 'Unidad 6 g', 'UND', 1, 'PROVISIONAL');

-- el aux no corrige
select pg_temp.como('a0000000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_like($$ select public.editar_producto('{"id":"c0000000-0000-0000-0000-000000000201","producto":{"presentacion":"Granel"}}') $$,
                   '%Solo el jefe%', 'el aux no corrige productos');
reset role;

-- el jefe corrige unidad base, categoría, cadena de frío y presentación, y valida en el mismo paso
select pg_temp.como('a0000000-0000-0000-0000-000000000002');
set local role authenticated;
create temp table r1 as select public.editar_producto('{"id":"c0000000-0000-0000-0000-000000000201","validar":true,
  "generico":{"nombre":"Manzana Gala","unidad_base":"g","categoria":"FRUVER","conservacion":"Refrigerado","temp_max_llegada":8},
  "producto":{"presentacion":"Granel","unidad_compra":"GR","contenido_base":1}}') as r;
select is(((select r from r1) ->> 'ok')::boolean, true, 'el jefe corrige y valida');
reset role;
select is((select unidad_base::text || '|' || categoria || '|' || conservacion || '|' || temp_max_llegada || '|' || estado
             from public.genericos where id = 'b0000000-0000-0000-0000-000000000201'), 'g|FRUVER|Refrigerado|8|VALIDADO',
          'el genérico queda corregido y validado');
select is((select presentacion || '|' || unidad_compra || '|' || contenido_base || '|' || estado
             from public.productos where id = 'c0000000-0000-0000-0000-000000000201'), 'Granel|GR|1|VALIDADO',
          'el producto queda corregido y validado');
select ok((select validado_por from public.productos where id = 'c0000000-0000-0000-0000-000000000201') = 'a0000000-0000-0000-0000-000000000002',
          'queda quién validó');

-- reglas
select pg_temp.como('a0000000-0000-0000-0000-000000000002');
set local role authenticated;
select is((public.editar_producto('{"id":"c0000000-0000-0000-0000-000000000201","generico":{"nombre":"Azúcar blanca"}}') ->> 'ok')::boolean,
          false, 'no toma el nombre de otro genérico del área');
select is((public.editar_producto('{"id":"c0000000-0000-0000-0000-000000000201","producto":{"contenido_base":""}}') ->> 'ok')::boolean,
          false, 'sin contenido ni contenido variable no se guarda');
select is((public.editar_producto('{"id":"c0000000-0000-0000-0000-000000000201","generico":{"tipo":"BEBIDA"}}') ->> 'ok')::boolean,
          false, 'no convierte un insumo en bebida de carta');
reset role;
-- con movimientos, la unidad base ya no cambia
select privado.registrar_movimiento('ENTRADA_COMPRA', 'c0000000-0000-0000-0000-000000000201', 'BAR_BODEGA', 2000, current_date, 3, 'PRUEBA');
select pg_temp.como('a0000000-0000-0000-0000-000000000002');
set local role authenticated;
select is((public.editar_producto('{"id":"c0000000-0000-0000-0000-000000000201","generico":{"unidad_base":"und"}}') ->> 'ok')::boolean,
          false, 'con movimientos en el kardex la unidad base no cambia');
select is((public.editar_producto('{"id":"c0000000-0000-0000-0000-000000000201","producto":{"marca":"Frutería"}}') ->> 'ok')::boolean,
          true, 'pero la marca sí se corrige');
reset role;
select set_config('request.jwt.claims', '', true);
select throws_like($$ select public.editar_producto('{"id":"c0000000-0000-0000-0000-000000000201"}') $$, '%Solo el jefe%',
                   'sin usuario no se corrige nada');

-- contraseña temporal
update public.perfiles set debe_cambiar_clave = true where id = 'a0000000-0000-0000-0000-000000000003';
select pg_temp.como('a0000000-0000-0000-0000-000000000003');
set local role authenticated;
select lives_ok($$ select public.clave_cambiada() $$, 'el aux avisa que cambió su contraseña');
reset role;
select is((select debe_cambiar_clave from public.perfiles where id = 'a0000000-0000-0000-0000-000000000003'), false,
          'y deja de pedírsela');

select * from finish();
rollback;
