-- Alta de productos desde la operación: búsqueda de parecidos, estado PROVISIONAL y validación.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
\ir fixtures.inc

insert into public.alias (fuente, alias, generico_id, producto_id) values
  ('RECEPCION', 'Azúcar blanca Manuelita', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002');

-- búsqueda
select pg_temp.como('a0000000-0000-0000-0000-000000000003');
set local role authenticated;
select is((select codigo from public.buscar_productos('azucar manuelita', 'BAR', 3) limit 1), 'BAR_MPe_0005-2500',
          'encuentra el producto por su alias de factura, sin tildes');
select is((select codigo from public.buscar_productos('Tanqueray', 'BAR', 3) limit 1), 'BAR_MPe_0079-700',
          'encuentra por marca');
select is((select count(*) from public.buscar_productos('Tanqueray', 'COCINA', 3)), 0::bigint, 'filtra por área');

-- alta con parecido: se bloquea hasta escribir un motivo
select is((public.crear_producto('{"area":"BAR","generico":{"nombre":"Azucar blanca","tipo":"MPe","unidad_base":"g"},
                                  "marca":"Incauca","presentacion":"Bolsa 1.000 g","unidad_compra":"PAQ","contenido_base":1000}') ->> 'ok')::boolean,
          false, 'no crea un genérico con el mismo nombre normalizado');
create temp table r1 as select public.crear_producto(jsonb_build_object(
  'area', 'BAR', 'generico_id', 'b0000000-0000-0000-0000-000000000002', 'marca', 'Manuelita', 'presentacion', 'Bolsa 1.000 g',
  'unidad_compra', 'PAQ', 'contenido_base', 1000)) as r;
select is(((select r from r1) ->> 'ok')::boolean, false, 'un parecido fuerte bloquea el alta');
select ok(jsonb_array_length((select r from r1) -> 'bloqueos') > 0, 'y dice a qué se parece');
create temp table r2 as select public.crear_producto(jsonb_build_object(
  'area', 'BAR', 'generico_id', 'b0000000-0000-0000-0000-000000000002', 'marca', 'Manuelita', 'presentacion', 'Bolsa 1.000 g',
  'unidad_compra', 'PAQ', 'contenido_base', 1000, 'motivo_forzado', 'Es la bolsa de un kilo, no la de 2.500 g')) as r;
select is(((select r from r2) ->> 'ok')::boolean, true, 'con motivo, el aux lo crea');
select is((select estado::text from public.productos where id = ((select r from r2) ->> 'id')::uuid), 'PROVISIONAL',
          'y queda PROVISIONAL');

-- genérico nuevo: código siguiente del área
create temp table r3 as select public.crear_producto('{"area":"BAR","generico":{"nombre":"Pimienta rosada","tipo":"MPe","unidad_base":"g"},
  "marca":"","presentacion":"Frasco 50 g","unidad_compra":"UND","contenido_base":50}') as r;
select is((select g.codigo || '|' || g.estado from public.productos p join public.genericos g on g.id = p.generico_id
            where p.id = ((select r from r3) ->> 'id')::uuid), 'BAR_MPe_0080|PROVISIONAL',
          'un genérico nuevo toma el siguiente código del área y también es provisional');
select throws_like($$ select public.validar_producto(((select r from r3) ->> 'id')::uuid) $$, '%Solo el jefe%',
                   'el aux no valida');
select throws_like($$ select public.crear_producto('{"area":"COCINA","generico":{"nombre":"Harina","unidad_base":"g"},"presentacion":"Granel","unidad_compra":"KG","contenido_base":1000}') $$,
                   '%Sin permiso%', 'el aux de bar no crea productos de cocina');
reset role;

-- el jefe valida
select pg_temp.como('a0000000-0000-0000-0000-000000000002');
set local role authenticated;
select is((public.validar_producto(((select r from r3) ->> 'id')::uuid) ->> 'ok')::boolean, true, 'el jefe de bar valida');
reset role;
select is((select p.estado::text || '|' || g.estado::text from public.productos p join public.genericos g on g.id = p.generico_id
            where p.id = ((select r from r3) ->> 'id')::uuid), 'VALIDADO|VALIDADO', 'producto y genérico quedan validados');

-- servicio no crea
select pg_temp.como('a0000000-0000-0000-0000-000000000004');
set local role authenticated;
select throws_like($$ select public.crear_producto('{"area":"BAR","generico":{"nombre":"Hielo","unidad_base":"g"},"presentacion":"Bolsa","unidad_compra":"UND","contenido_base":2000}') $$,
                   '%Sin permiso%', 'servicio no crea productos');
reset role;

select * from finish();
rollback;
