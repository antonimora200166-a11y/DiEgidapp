-- Costo de MPI por lote (Σ consumos / neto), cascada de MPI y costo estándar de ficha y bebida.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);
\ir fixtures.inc

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar

-- Compras: azúcar 2 bolsas × 2.500 g por $26.300 ($5,26/g) · limón 10 kg por $80.000 ($8/g)
create temp table rec1 as select public.registrar_recepcion(jsonb_build_object(
  'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', (privado.hoy() - 2)::text,
  'proveedor_id', 'd0000000-0000-0000-0000-000000000002', 'tipo_soporte', 'FACTURA', 'documento', 'FV-1001',
  'recibe_id', 'a0000000-0000-0000-0000-000000000003',
  'lineas', jsonb_build_array(
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad_pedida', 2, 'cantidad_recibida', 2, 'valor_total', 26300),
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000003', 'cantidad_pedida', 10, 'cantidad_recibida', 10, 'valor_total', 80000)))) as r;
-- Ginebra: 1 botella de 700 ml por $140.000 ($200/ml), con sello
create temp table rec2 as select public.registrar_recepcion(jsonb_build_object(
  'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', (privado.hoy() - 2)::text,
  'proveedor_id', 'd0000000-0000-0000-0000-000000000001', 'tipo_soporte', 'FACTURA', 'documento', 'DL-2001',
  'recibe_id', 'a0000000-0000-0000-0000-000000000003',
  'lineas', jsonb_build_array(
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000001', 'cantidad_recibida', 1, 'valor_total', 140000, 'sello', 'SI')))) as r;

select is((select (r ->> 'ok')::boolean from rec1), true, 'recepción de azúcar y limón guardada');
select is((select costo_promedio from public.costos_producto where producto_id = 'c0000000-0000-0000-0000-000000000002'),
          5.26::numeric, 'azúcar: $26.300 / 5.000 g = $5,26/g');

-- Ficha #5 Sirope Simple: 2.000 g de azúcar + 2.000 ml de agua → 3.800 g
insert into public.fichas (id, codigo, generico_id, neto_esperado) values
  ('e0000000-0000-0000-0000-000000000005', '#5', 'b0000000-0000-0000-0000-000000000004', 3800);
insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad) values
  ('e0000000-0000-0000-0000-000000000005', 1, 'b0000000-0000-0000-0000-000000000002', 2000, 'g'),
  ('e0000000-0000-0000-0000-000000000005', 2, 'b0000000-0000-0000-0000-000000000005', 2000, 'ml');

-- Compuertas del lote
select is((select public.registrar_lote(jsonb_build_object(
  'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', (privado.hoy() - 1)::text,
  'producto_id', 'c0000000-0000-0000-0000-000000000004', 'responsable_id', 'a0000000-0000-0000-0000-000000000003',
  'consumos', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 2000))))
  -> 'fatales' ->> 0), 'F7 · Falta el PESO NETO FINAL.', 'F7: un lote sin peso neto no se guarda');

-- Lote 1 · Sirope Simple
create temp table lote1 as select public.registrar_lote(jsonb_build_object(
  'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', (privado.hoy() - 1)::text,
  'producto_id', 'c0000000-0000-0000-0000-000000000004', 'ficha_id', 'e0000000-0000-0000-0000-000000000005',
  'responsable_id', 'a0000000-0000-0000-0000-000000000003', 'neto', 3800,
  'consumos', jsonb_build_array(
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 2000),
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000005', 'cantidad', 2000)))) as r;

select is((select (r ->> 'ok')::boolean from lote1), true, 'lote de sirope guardado');
select is((select (r ->> 'costo_total')::numeric from lote1), 10520::numeric, 'costo del lote = 2.000 g × $5,26 (el agua vale $0)');
select is((select (r ->> 'costo_unitario')::numeric from lote1), 2.768421::numeric, 'costo por gramo = $10.520 / 3.800 g');
select is((select r ->> 'estado_costo' from lote1), 'COMPLETO', 'lote COMPLETO');
select is((select jsonb_array_length(r -> 'avisos') from lote1), 0, 'rendimiento igual a la ficha (95 %): sin aviso');
select is((select costo_promedio from public.costos_producto where producto_id = 'c0000000-0000-0000-0000-000000000004'),
          2.768421::numeric, 'el MPI entra al kardex con su costo por gramo');
select is((select cantidad from public.existencias where producto_id = 'c0000000-0000-0000-0000-000000000002' and ubicacion = 'BAR_BODEGA'),
          3000::numeric, 'el azúcar consumido sale del kardex');
select ok(not exists (select 1 from public.movimientos where producto_id = 'c0000000-0000-0000-0000-000000000005'),
          'el agua (SIN_COSTO) no mueve kardex');

-- Lote 2 · Limonada base: usa el MPI sirope → cascada
create temp table lote2 as select public.registrar_lote(jsonb_build_object(
  'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', privado.hoy()::text,
  'producto_id', 'c0000000-0000-0000-0000-000000000008', 'responsable_id', 'a0000000-0000-0000-0000-000000000003', 'neto', 1200,
  'consumos', jsonb_build_array(
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000004', 'cantidad', 500),
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000003', 'cantidad', 1, 'unidad', 'kg')))) as r;
select is((select (r ->> 'costo_total')::numeric from lote2), 9384.2105::numeric, 'cascada: 500 g × $2,768421 + 1.000 g × $8');
select is((select (r ->> 'costo_unitario')::numeric from lote2), 7.820175::numeric, 'costo por gramo de la limonada');

-- Lote 3 · insumo sin ninguna compra: B3 pide motivo y el lote queda PARCIAL
select is((select public.registrar_lote(jsonb_build_object(
  'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', privado.hoy()::text,
  'producto_id', 'c0000000-0000-0000-0000-000000000004', 'responsable_id', 'a0000000-0000-0000-0000-000000000003', 'neto', 100,
  'consumos', jsonb_build_array(
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000006', 'cantidad', 10),
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 100))))
  ->> 'ok')::boolean, false, 'B3: consumir sin saldo bloquea si no hay motivo');
create temp table lote3 as select public.registrar_lote(jsonb_build_object(
  'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', privado.hoy()::text,
  'producto_id', 'c0000000-0000-0000-0000-000000000004', 'responsable_id', 'a0000000-0000-0000-0000-000000000003', 'neto', 100,
  'motivo_forzado', 'Cardamomo comprado en efectivo, factura pendiente',
  'consumos', jsonb_build_array(
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000006', 'cantidad', 10),
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 100)))) as r;
select is((select r ->> 'estado_costo' from lote3), 'PARCIAL', 'con motivo se guarda, PARCIAL');
select is((select costo_promedio from public.costos_producto where producto_id = 'c0000000-0000-0000-0000-000000000004'),
          2.768421::numeric, 'un lote PARCIAL no altera el promedio del MPI');

-- Costo estándar de una bebida: Gin Sour = 60 ml de ginebra + 30 ml de sirope simple
insert into public.fichas (id, codigo, generico_id) values
  ('e0000000-0000-0000-0000-000000000099', 'C99', 'b0000000-0000-0000-0000-000000000007');
insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad) values
  ('e0000000-0000-0000-0000-000000000099', 1, 'b0000000-0000-0000-0000-000000000001', 60, 'ml'),
  ('e0000000-0000-0000-0000-000000000099', 2, 'b0000000-0000-0000-0000-000000000004', 30, 'ml');
insert into public.precios_venta (generico_id, precio_con_impuesto, vigente_desde) values
  ('b0000000-0000-0000-0000-000000000007', 32400, current_date - 1);

select is((select completa from public.v_costo_fichas where ficha_id = 'e0000000-0000-0000-0000-000000000099'),
          false, 'sin densidad del sirope la bebida queda incompleta');
select is((select faltantes[1] from public.v_costo_fichas where ficha_id = 'e0000000-0000-0000-0000-000000000099'),
          'Falta la conversión ml→g de Sirope Simple', 'y dice qué falta');

-- Medida de PESAJE: 1 ml de sirope simple pesa 1,3 g
insert into public.conversiones (generico_id, unidad, factor_a_base, estado) values
  ('b0000000-0000-0000-0000-000000000004', 'ml', 1.3, 'MEDIDO');
select is((select total from public.v_costo_fichas where ficha_id = 'e0000000-0000-0000-0000-000000000099'),
          12107.968419::numeric, 'Gin Sour = 60 ml × $200 + 39 g × $2,768421');
select is((select round(pct_costo, 4) from public.v_costo_fichas where ficha_id = 'e0000000-0000-0000-0000-000000000099'),
          0.4036::numeric, '% de costo sobre el precio sin impoconsumo ($32.400 / 1,08)');
select is((select round(costo_por_unidad_neta, 6) from public.v_costo_fichas where ficha_id = 'e0000000-0000-0000-0000-000000000005'),
          2.768421::numeric, 'costo estándar del sirope por gramo = el real del lote');

select * from finish();
rollback;
