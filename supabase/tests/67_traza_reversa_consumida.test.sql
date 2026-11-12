-- Trazabilidad: anular una entrada ya consumida en parte no deja la partida en negativo;
-- lo que ya había salido queda «sin partida» y la existencia por partidas = kardex.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
\ir fixtures.inc

-- 5 kg de limón comprados; se usan 2 kg en un lote de limonada
insert into public.recepciones (id, codigo, area, ubicacion, fecha, proveedor_id, tipo_soporte, documento, recibe_id) values
  ('f0000000-0000-0000-0000-000000000001', 'REC-BAR-TEST-001', 'BAR', 'BAR_BODEGA', privado.hoy() - 3, 'd0000000-0000-0000-0000-000000000002', 'FACTURA', 'FV-100', 'a0000000-0000-0000-0000-000000000002');
insert into public.recepcion_lineas (id, recepcion_id, linea, producto_id, cantidad_recibida, contenido_base, valor_total) values
  ('f1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 1, 'c0000000-0000-0000-0000-000000000003', 5, 1000, 30000);
create temp table e as select privado.registrar_movimiento('ENTRADA_COMPRA', 'c0000000-0000-0000-0000-000000000003', 'BAR_BODEGA', 5000, privado.hoy() - 3, 6,
  'RECEPCION', 'f0000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001') as m;

select pg_temp.como('a0000000-0000-0000-0000-000000000003');
create temp table l1 as select public.registrar_lote(jsonb_build_object(
  'area', 'BAR', 'fecha', privado.hoy()::text, 'producto_id', 'c0000000-0000-0000-0000-000000000008', 'responsable_id', 'a0000000-0000-0000-0000-000000000002',
  'ubicacion_destino', 'BAR_BODEGA', 'neto_g', 1800,
  'consumos', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000003', 'gramos', 2000, 'ubicacion', 'BAR_BODEGA')))) as r;
select is((select (r ->> 'ok')::boolean from l1), true, 'lote de limonada con 2 kg de la compra');

-- se anula la recepción: el kardex queda en −2.000 g
select pg_temp.como('a0000000-0000-0000-0000-000000000002');
select is((public.anular_documento('RECEPCION', 'f0000000-0000-0000-0000-000000000001', 'Factura equivocada') ->> 'ok')::boolean, true, 'se anula la recepción');
select is((select sum(cantidad) from public.existencias where producto_id = 'c0000000-0000-0000-0000-000000000003'), -2000::numeric, 'el kardex queda en −2.000 g');
select is((select privado.restante_partida(p.id) from public.partidas p where p.movimiento_id = (select (m).id from e)), 0::numeric,
          'la partida de la compra queda en 0, no en negativo');
select is((select sum(c.cantidad) from public.partida_consumos c join public.movimientos m on m.id = c.movimiento_id
            where m.reversa_de = (select (m).id from e) and c.partida_id is not null), 3000::numeric, 'la reversa saca de la partida los 3 kg que le quedaban');
select is((select sum(c.cantidad) from public.partida_consumos c join public.movimientos m on m.id = c.movimiento_id
            where m.reversa_de = (select (m).id from e) and c.partida_id is null), 2000::numeric, 'y los 2 kg ya usados quedan sin partida');

-- anular el lote de limonada después de usarla en parte: el lote queda en 0, no en negativo
select privado.registrar_movimiento('SALIDA_BAJA', 'c0000000-0000-0000-0000-000000000008', 'BAR_BODEGA', 600, privado.hoy(), null, 'BAJA', null);
select is((public.anular_documento('LOTE', (select (r ->> 'id')::uuid from l1), 'Se pesó mal, se repite el lote') ->> 'ok')::boolean, true, 'se anula el lote ya usado en parte');
select is(privado.restante_lote((select (r ->> 'id')::uuid from l1)), 0::numeric, 'lo que queda del lote es 0, no −600');

select * from finish();
rollback;
