-- Unir dos genéricos con unidad base distinta (decidir_par con factor): «Limón» por unidad es
-- el mismo insumo que «Limón Tahití» en gramos, con 1 und = 100 g.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
\ir fixtures.inc

insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base, estado) values
  ('b0000000-0000-0000-0000-000000000102', 'BAR_MPe_0902', 'Limón', 'MPe', 'FRUVER', 'BAR', 'und', 'PROVISIONAL'),
  ('b0000000-0000-0000-0000-000000000103', 'BAR_MPe_0903', 'Naranja', 'MPe', 'FRUVER', 'BAR', 'und', 'PROVISIONAL'),
  ('b0000000-0000-0000-0000-000000000104', 'BAR_MPe_0904', 'Naranja Valencia', 'MPe', 'FRUVER', 'BAR', 'g', 'PROVISIONAL');
insert into public.productos (id, codigo, generico_id, marca, presentacion, unidad_compra, contenido_base) values
  ('c0000000-0000-0000-0000-000000000102', 'BAR_MPe_0902-UND', 'b0000000-0000-0000-0000-000000000102', '', 'Unidad', 'UND', 1),
  ('c0000000-0000-0000-0000-000000000103', 'BAR_MPe_0903-UND', 'b0000000-0000-0000-0000-000000000103', '', 'Unidad', 'UND', 1),
  ('c0000000-0000-0000-0000-000000000104', 'BAR_MPe_0904-KG', 'b0000000-0000-0000-0000-000000000104', '', 'Granel', 'KG', 1000);
insert into public.costos_referencia (producto_id, costo_unitario_base, fuente) values
  ('c0000000-0000-0000-0000-000000000102', 500, 'REC-BAR');
insert into public.conversiones (generico_id, unidad, factor_a_base) values
  ('b0000000-0000-0000-0000-000000000102', 'docena', 12);
-- una ficha pedía 2 limones por unidad
insert into public.fichas (id, codigo, generico_id) values ('e0000000-0000-0000-0000-000000000009', '#9', 'b0000000-0000-0000-0000-000000000008');
insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad) values
  ('e0000000-0000-0000-0000-000000000009', 1, 'b0000000-0000-0000-0000-000000000102', 2, 'und');
-- su compra histórica a $500 por limón
insert into public.compras_historicas (id, origen, id_origen, fecha, nombre_factura, generico_id, producto_id, cantidad_base, valor_total, computable) values
  (gen_random_uuid(), 'REC-BAR', 'H-L1', privado.hoy() - 10, 'Limón', 'b0000000-0000-0000-0000-000000000102', 'c0000000-0000-0000-0000-000000000102', 20, 10000, true);
-- la naranja por unidad ya tiene kardex
select privado.registrar_movimiento('SALDO_INICIAL', 'c0000000-0000-0000-0000-000000000103', 'BAR_BODEGA', 6, privado.hoy(), 800, 'CONTEO');

insert into public.revision_catalogo (id, area, tipo, parecido, propuesta, a_fuente, a_nombre, a_generico_id, b_fuente, b_nombre, b_generico_id) values
  ('U1', 'BAR', 'CASI-DUPLICADO', 0.8, 'REVISAR', 'CATALOGO_MAESTRO', 'Limón Tahití', 'b0000000-0000-0000-0000-000000000003', 'REC-BAR', 'Limón', 'b0000000-0000-0000-0000-000000000102'),
  ('U2', 'BAR', 'CASI-DUPLICADO', 0.8, 'REVISAR', 'CATALOGO_MAESTRO', 'Naranja Valencia', 'b0000000-0000-0000-0000-000000000104', 'REC-BAR', 'Naranja', 'b0000000-0000-0000-0000-000000000103'),
  ('U3', 'BAR', 'CASI-DUPLICADO', 0.8, 'REVISAR', 'CATALOGO_MAESTRO', 'Cardamomo', 'b0000000-0000-0000-0000-000000000006', 'REC-BAR', 'Azúcar blanca', 'b0000000-0000-0000-0000-000000000002');

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar

select is((select count(*) from privado.precios_compra where producto_id = 'c0000000-0000-0000-0000-000000000102'), 1::bigint,
          'antes de unir, la compra histórica del limón cuenta para su banda');
select ok((public.decidir_par('U1', 'FUSIONAR', 'A') -> 'fatales' ->> 0) like '%di cuántos g son 1 und%',
          'sin factor, pide cuántos g son 1 und');
select is((select decision from public.revision_catalogo where id = 'U1'), null, 'y el par sigue pendiente');

create temp table r as select public.decidir_par('U1', 'FUSIONAR', 'A', null, 100) as v;
select is((select (v ->> 'ok')::boolean from r), true, 'con 1 und = 100 g se unen');
select is((select generico_id from public.productos where id = 'c0000000-0000-0000-0000-000000000102'),
          'b0000000-0000-0000-0000-000000000003'::uuid, 'el producto del limón pasa a Limón Tahití');
select is((select contenido_base from public.productos where id = 'c0000000-0000-0000-0000-000000000102'), 100::numeric,
          'su contenido queda en gramos: 1 und = 100 g');
select is((select costo_unitario_base from public.costos_referencia where producto_id = 'c0000000-0000-0000-0000-000000000102'),
          5::numeric, 'su costo de referencia pasa de $500/und a $5/g');
select is((select factor_a_base from public.conversiones where generico_id = 'b0000000-0000-0000-0000-000000000003' and unidad = 'und'),
          100::numeric, 'queda la conversión 1 und = 100 g en el que se conserva');
select is((select factor_a_base from public.conversiones where generico_id = 'b0000000-0000-0000-0000-000000000003' and unidad = 'docena'),
          1200::numeric, 'la docena pasa de 12 und a 1.200 g');
select is(privado.a_base((select generico_id from public.ficha_lineas where ficha_id = 'e0000000-0000-0000-0000-000000000009'), 2, 'und'),
          200::numeric, 'la ficha que pedía 2 und ahora da 200 g');
select is((select activo from public.genericos where id = 'b0000000-0000-0000-0000-000000000102'), false, 'el genérico por unidad queda inactivo');
select ok((select v -> 'avisos' from r)::text like '%1 und = 100 g%', 'el resultado dice la conversión aplicada');
select is((select count(*) from privado.precios_compra where producto_id = 'c0000000-0000-0000-0000-000000000102'), 0::bigint,
          'la compra vieja en und ya no cuenta para la banda en g');

select ok((public.decidir_par('U2', 'FUSIONAR', 'A', null, 180) -> 'fatales' ->> 0) like '%ya tiene movimientos en el kardex%',
          'un genérico con kardex no cambia de unidad');
select is((public.decidir_par('U2', 'FUSIONAR', 'B') -> 'fatales' ->> 0) like '%di cuántos und son 1 g%', true,
          'conservar el lado por unidad también pide el factor');
select ok((public.decidir_par('U3', 'FUSIONAR', 'A', null, 5) -> 'fatales') ? 'Los dos van en la misma unidad: no hace falta factor.',
          'con la misma unidad no se acepta factor');

select * from finish();
rollback;
