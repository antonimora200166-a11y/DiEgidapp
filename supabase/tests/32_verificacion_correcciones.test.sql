-- Hoja de verificación: unir desde la hoja, precio a mano, presentaciones repetidas y costo heredado.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);
\ir fixtures.inc

-- «Conejo» (con compra y costo) y «Conejo entero» (se pesa, sin precio): son el mismo
insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base) values
  ('b0000000-0000-0000-0000-000000000501', 'BAR_MPe_0501', 'Conejo entero', 'MPe', 'FRUVER', 'BAR', 'g'),
  ('b0000000-0000-0000-0000-000000000502', 'BAR_MPe_0502', 'Conejo', 'MPe', 'FRUVER', 'BAR', 'g');
insert into public.productos (id, codigo, generico_id, marca, presentacion, unidad_compra, contenido_base, contenido_variable) values
  ('c0000000-0000-0000-0000-000000000501', 'BAR_MPe_0501-1', 'b0000000-0000-0000-0000-000000000501', '', 'Unidad', 'UND', null, true),
  ('c0000000-0000-0000-0000-000000000502', 'BAR_MPe_0502-1', 'b0000000-0000-0000-0000-000000000502', '', 'Unidad 5060 g', 'UND', 5060, false);
insert into public.costos_referencia (producto_id, costo_unitario_base, fuente, n_compras) values
  ('c0000000-0000-0000-0000-000000000502', 53.41, 'REC-COC: promedio', 2);
insert into public.compras_historicas (id, origen, id_origen, fecha, nombre_factura, generico_id, producto_id, cantidad_base, valor_total, computable) values
  (gen_random_uuid(), 'REC-COC', 'C1', '2026-10-01', 'Conejo', 'b0000000-0000-0000-0000-000000000502', null, 5060, 270311, true);

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar
select throws_like($$ select public.unir_genericos('b0000000-0000-0000-0000-000000000501', 'b0000000-0000-0000-0000-000000000502') $$,
                   '%Solo el jefe%', 'el aux no une');
select throws_like($$ select public.fijar_costo('c0000000-0000-0000-0000-000000000002', 20000, 'COMPRA') $$,
                   '%Sin permiso%', 'ni pone precios');

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
create temp table u as select public.unir_genericos('b0000000-0000-0000-0000-000000000501', 'b0000000-0000-0000-0000-000000000502') as v;
select ok((select (v ->> 'ok')::boolean from u), 'se unen desde la hoja, sin pasar por Revisar duplicados');
select is((select generico_id from public.productos where id = 'c0000000-0000-0000-0000-000000000502'),
          'b0000000-0000-0000-0000-000000000501'::uuid, 'la presentación con precio pasa a Conejo entero');
select is((select unido_en from public.genericos where id = 'b0000000-0000-0000-0000-000000000502'),
          'b0000000-0000-0000-0000-000000000501'::uuid, 'el absorbido sabe en qué se unió');
select is((select costo_unitario_base from public.costos_referencia where producto_id = 'c0000000-0000-0000-0000-000000000501'),
          53.41::numeric, 'la presentación que se pesa hereda el costo por g');
select ok((select fuente like 'Mismo genérico%' from public.costos_referencia where producto_id = 'c0000000-0000-0000-0000-000000000501'),
          'y dice de dónde salió');
create temp table h as select * from public.lista_verificacion('BAR');
select is((select n_compras from h where codigo = 'BAR_MPe_0501-1'), 1, 'la compra del absorbido cuenta para el que queda');
select ok((select 'VARIAS_PRESENTACIONES' = any (alertas) from h where codigo = 'BAR_MPe_0501-1'), 'avisa que hay dos presentaciones');
select is((select costo_fuente from h where codigo = 'BAR_MPe_0501-1'), 'de otra presentación', 'fuente del costo en la hoja');
select is((public.unir_genericos('b0000000-0000-0000-0000-000000000501', 'b0000000-0000-0000-0000-000000000502') ->> 'ok')::boolean, false,
          'unir otra vez no hace nada');

-- cadena: «Conejo criollo» se había unido en «Conejo», que ahora está unido en «Conejo entero»
insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base, activo, unido_en) values
  ('b0000000-0000-0000-0000-000000000503', 'BAR_MPe_0503', 'Conejo criollo', 'MPe', 'FRUVER', 'BAR', 'g', false,
   'b0000000-0000-0000-0000-000000000502');
insert into public.compras_historicas (id, origen, id_origen, fecha, nombre_factura, generico_id, producto_id, cantidad_base, valor_total, computable) values
  (gen_random_uuid(), 'REC-COC', 'C2', '2026-09-01', 'Conejo criollo', 'b0000000-0000-0000-0000-000000000503', null, 3000, 150000, true);
select is((select n_compras from public.lista_verificacion('BAR') where codigo = 'BAR_MPe_0501-1'), 2,
          'también cuentan las compras de una unión encadenada');

-- quitar la repetida
create temp table q as select public.quitar_repetido('c0000000-0000-0000-0000-000000000501', 'c0000000-0000-0000-0000-000000000502') as v;
select ok((select (v ->> 'ok')::boolean from q) and not (select activo from public.productos where id = 'c0000000-0000-0000-0000-000000000501'),
          'la presentación repetida queda inactiva');
select is((public.quitar_repetido('c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001') ->> 'ok')::boolean, false,
          'no se quita «repetido» entre genéricos distintos');

-- precio a mano: azúcar a $20.000 la bolsa de 2.500 g → $8 por g
select pg_temp.como('a0000000-0000-0000-0000-000000000001');  -- admin: los pesos solo los ve administración (08/11)
create temp table f as select public.fijar_costo('c0000000-0000-0000-0000-000000000002', 20000, 'COMPRA') as v;
select is((select costo_unitario_base from public.costos_referencia where producto_id = 'c0000000-0000-0000-0000-000000000002'), 8::numeric,
          'precio por bolsa → costo por g');
select ok((select fuente like 'A mano · Admin Prueba%' from public.costos_referencia where producto_id = 'c0000000-0000-0000-0000-000000000002'),
          'queda como puesto a mano, con quién');
select ok((public.fijar_costo('c0000000-0000-0000-0000-000000000002', 20000, 'BASE') -> 'fatales' ->> 0) like '%no es creíble%',
          'un costo absurdo no se acepta');
select public.fijar_costo('c0000000-0000-0000-0000-000000000003', 3500, 'KILO');
select is((select costo_unitario_base from public.costos_referencia where producto_id = 'c0000000-0000-0000-0000-000000000003'), 3.5,
          'por kilo también');

select * from finish();
rollback;
