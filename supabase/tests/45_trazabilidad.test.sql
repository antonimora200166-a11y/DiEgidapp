-- Trazabilidad: partidas por entrada, salida por lo que vence primero (o el lote escaneado),
-- cadena hacia atrás hasta la recepción y el proveedor en varios niveles, hacia adelante,
-- traslados que conservan el origen, existencia y estado del lote, y reversa.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);
\ir fixtures.inc

-- dos recepciones de limón (Frutería): la vieja vence después, la nueva vence antes
insert into public.recepciones (id, codigo, area, ubicacion, fecha, proveedor_id, tipo_soporte, documento, recibe_id) values
  ('f0000000-0000-0000-0000-000000000001', 'REC-BAR-TEST-001', 'BAR', 'BAR_BODEGA', privado.hoy() - 5, 'd0000000-0000-0000-0000-000000000002', 'FACTURA', 'FV-100', 'a0000000-0000-0000-0000-000000000002'),
  ('f0000000-0000-0000-0000-000000000002', 'REC-BAR-TEST-002', 'BAR', 'BAR_BODEGA', privado.hoy() - 1, 'd0000000-0000-0000-0000-000000000002', 'FACTURA', 'FV-101', 'a0000000-0000-0000-0000-000000000002');
insert into public.recepcion_lineas (id, recepcion_id, linea, producto_id, cantidad_recibida, contenido_base, valor_total, vencimiento, lote_proveedor) values
  ('f1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 1, 'c0000000-0000-0000-0000-000000000003', 3, 1000, 15000, privado.hoy() + 10, 'L-A'),
  ('f1000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000002', 1, 'c0000000-0000-0000-0000-000000000003', 3, 1000, 18000, privado.hoy() + 4, 'L-B');
select privado.registrar_movimiento('ENTRADA_COMPRA', 'c0000000-0000-0000-0000-000000000003', 'BAR_BODEGA', 3000, privado.hoy() - 5, 5, 'RECEPCION', 'f0000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001');
select privado.registrar_movimiento('ENTRADA_COMPRA', 'c0000000-0000-0000-0000-000000000003', 'BAR_BODEGA', 3000, privado.hoy() - 1, 6, 'RECEPCION', 'f0000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000002');
select privado.registrar_movimiento('SALDO_INICIAL', 'c0000000-0000-0000-0000-000000000002', 'BAR_BODEGA', 5000, privado.hoy() - 6, 4, 'CONTEO', null);

select is((select count(*) from public.partidas where producto_id = 'c0000000-0000-0000-0000-000000000003'), 2::bigint, 'cada recepción nace como partida');
select is((select vence from public.partidas where origen_linea = 'f1000000-0000-0000-0000-000000000002'), privado.hoy() + 4, 'con el vencimiento de su línea');

select pg_temp.como('a0000000-0000-0000-0000-000000000003');
-- Nivel 1 · Limonada base (b…08): 2.000 g de limón + 1.000 g de agua
create temp table l1 as select public.registrar_lote(jsonb_build_object(
  'area', 'BAR', 'fecha', privado.hoy()::text, 'producto_id', 'c0000000-0000-0000-0000-000000000008', 'responsable_id', 'a0000000-0000-0000-0000-000000000002',
  'ubicacion_destino', 'BAR_BODEGA', 'neto_g', 2700,
  'consumos', jsonb_build_array(
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000003', 'gramos', 2000, 'ubicacion', 'BAR_BODEGA'),
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000005', 'gramos', 1000)))) as r;
select is((select (r ->> 'ok')::boolean from l1), true, 'lote de limonada guardado');
select is((select c.partida_id from public.partida_consumos c join public.movimientos m on m.id = c.movimiento_id
            where m.documento_id = (select (r ->> 'id')::uuid from l1) and m.cantidad < 0),
          (select id from public.partidas where origen_linea = 'f1000000-0000-0000-0000-000000000002'),
          'el limón sale de la recepción que vence primero');

-- Nivel 2 · Sirope (b…04) hecho con 500 g de limonada + 1.000 g de azúcar
create temp table l2 as select public.registrar_lote(jsonb_build_object(
  'area', 'BAR', 'fecha', privado.hoy()::text, 'producto_id', 'c0000000-0000-0000-0000-000000000004', 'responsable_id', 'a0000000-0000-0000-0000-000000000002',
  'ubicacion_destino', 'BAR_BARRA', 'neto_g', 1400,
  'consumos', jsonb_build_array(
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000008', 'gramos', 500, 'ubicacion', 'BAR_BODEGA'),
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'gramos', 1000, 'ubicacion', 'BAR_BODEGA')))) as r;
select is((select (r ->> 'ok')::boolean from l2), true, 'lote de sirope con limonada guardado');

create temp table t2 as select public.traza_lote((select r ->> 'codigo' from l2)) as v;
select is((select v -> 'atras' -> 0 -> 'origenes' -> 0 ->> 'codigo' from t2), (select r ->> 'codigo' from l1), 'hacia atrás: la limonada viene de su lote');
select is((select v -> 'atras' -> 0 -> 'origenes' -> 0 -> 'cadena' -> 0 -> 'origenes' -> 0 ->> 'codigo' from t2), 'REC-BAR-TEST-002',
          'y ese lote, de la recepción del limón (segundo nivel)');
select is((select v -> 'atras' -> 0 -> 'origenes' -> 0 -> 'cadena' -> 0 -> 'origenes' -> 0 ->> 'proveedor' from t2), 'Frutería', 'con su proveedor');
select is((select v -> 'atras' -> 1 -> 'origenes' -> 0 ->> 'tipo' from t2), 'SALDO_INICIAL', 'el azúcar viene del conteo inicial');

create temp table t1 as select public.traza_lote((select r ->> 'codigo' from l1)) as v;
select is((select v -> 'adelante' -> 0 ->> 'codigo' from t1), (select r ->> 'codigo' from l2), 'hacia adelante: la limonada se usó en el sirope');
select is((select (v -> 'lote' ->> 'restante')::numeric from t1), 2200::numeric, 'quedan 2.700 − 500 = 2.200 g');
select is((select v -> 'lote' ->> 'estado' from t1), 'ACTIVO', 'y el lote sigue activo');

-- traslado de 700 g a la barra: la partida hija conserva el origen del lote
select privado.registrar_movimiento('TRASLADO_SALIDA', 'c0000000-0000-0000-0000-000000000008', 'BAR_BODEGA', 700, privado.hoy(), null, 'TRASLADO', 'f2000000-0000-0000-0000-000000000001');
select privado.registrar_movimiento('TRASLADO_ENTRADA', 'c0000000-0000-0000-0000-000000000008', 'BAR_BARRA', 700, privado.hoy(), null, 'TRASLADO', 'f2000000-0000-0000-0000-000000000001');
select is((select (origen_tipo, origen_doc, cantidad) from public.partidas where ubicacion = 'BAR_BARRA' and producto_id = 'c0000000-0000-0000-0000-000000000008'),
          ('LOTE'::text, (select (r ->> 'id')::uuid from l1), 700::numeric), 'el traslado conserva el lote de origen');
select is((select privado.restante_lote((select (r ->> 'id')::uuid from l1))), 2200::numeric, 'y no cambia lo que queda del lote');

-- baja de todo lo que queda: el lote queda consumido (parte se usó en producción)
select privado.registrar_movimiento('SALIDA_BAJA', 'c0000000-0000-0000-0000-000000000008', 'BAR_BODEGA', 1500, privado.hoy(), null, 'BAJA', null);
select privado.registrar_movimiento('SALIDA_BAJA', 'c0000000-0000-0000-0000-000000000008', 'BAR_BARRA', 700, privado.hoy(), null, 'BAJA', null);
select is((select privado.estado_lote((select (r ->> 'id')::uuid from l1))), 'CONSUMIDO', 'sin existencia, el lote queda consumido');

-- anular el sirope: la limonada vuelve a su partida y el sirope queda reversado
select pg_temp.como('a0000000-0000-0000-0000-000000000002');
select is((public.anular_documento('LOTE', (select (r ->> 'id')::uuid from l2), 'Se pesó mal el azúcar, se repite') ->> 'ok')::boolean, true, 'anula el lote de sirope');
select is((select privado.estado_lote((select (r ->> 'id')::uuid from l2))), 'REVERSADO', 'el sirope queda reversado');
select is((select privado.restante_lote((select (r ->> 'id')::uuid from l1))), 500::numeric, 'los 500 g de limonada vuelven a su lote');

-- con el lote escaneado, sale primero ese origen aunque no sea el que vence antes
select pg_temp.como('a0000000-0000-0000-0000-000000000003');
create temp table l3 as select public.registrar_lote(jsonb_build_object(
  'area', 'BAR', 'fecha', privado.hoy()::text, 'producto_id', 'c0000000-0000-0000-0000-000000000008', 'responsable_id', 'a0000000-0000-0000-0000-000000000002',
  'ubicacion_destino', 'BAR_BODEGA', 'neto_g', 700,
  'consumos', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000003', 'gramos', 800, 'ubicacion', 'BAR_BODEGA',
                                                   'lote_origen', 'f0000000-0000-0000-0000-000000000001')))) as r;
select is((select p.origen_doc from public.partida_consumos c join public.partidas p on p.id = c.partida_id join public.movimientos m on m.id = c.movimiento_id
            where m.documento_id = (select (r ->> 'id')::uuid from l3) and m.cantidad < 0),
          'f0000000-0000-0000-0000-000000000001'::uuid, 'lo escaneado sale primero');
select is((select count(*) from public.lotes_lista('BAR') where origen = 'APP'), 3::bigint, 'la lista trae los lotes de la app');

select * from finish();
rollback;
