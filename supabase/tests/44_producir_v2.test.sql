-- Producir v2: pesos en gramos, existencia que no alcanza bloquea sin motivo posible, desvío en
-- puntos, vencimiento por almacenamiento, código PRO-BAR-AAAA-0001 y kardex que cuadra.
-- Mismos números que web/lib/produccion.test.ts (lote PRO-2026-005 de SGI-COSTOS).
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);
\ir fixtures.inc

-- existencias con costo: limón $5/g, «ácido» (azúcar) $13/g, ginebra $200/ml
select privado.registrar_movimiento('SALDO_INICIAL', 'c0000000-0000-0000-0000-000000000003', 'BAR_BODEGA', 10000, privado.hoy(), 5, 'CONTEO', null);
select privado.registrar_movimiento('SALDO_INICIAL', 'c0000000-0000-0000-0000-000000000002', 'BAR_BODEGA', 1000, privado.hoy(), 13, 'CONTEO', null);
select privado.registrar_movimiento('SALDO_INICIAL', 'c0000000-0000-0000-0000-000000000001', 'BAR_BODEGA', 700, privado.hoy(), 200, 'CONTEO', null);

-- ficha de la Limonada base (b…08): 10.000 g limón + 800 g azúcar + 6.500 ml agua → 9.342 g (54 %)
insert into public.fichas (id, codigo, generico_id, neto_esperado) values ('e0000000-0000-0000-0000-000000000801', '#1', 'b0000000-0000-0000-0000-000000000008', 9342);
insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad) values
  ('e0000000-0000-0000-0000-000000000801', 1, 'b0000000-0000-0000-0000-000000000003', 10000, 'g'),
  ('e0000000-0000-0000-0000-000000000801', 2, 'b0000000-0000-0000-0000-000000000002', 800, 'g'),
  ('e0000000-0000-0000-0000-000000000801', 3, 'b0000000-0000-0000-0000-000000000005', 6500, 'ml');
insert into public.ficha_almacenamientos (ficha_id, conservacion, vida_util_dias) values
  ('e0000000-0000-0000-0000-000000000801', 'Refrigerado', 3), ('e0000000-0000-0000-0000-000000000801', 'Congelado', 90);

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar
create or replace function pg_temp.lote(p_extra jsonb default '{}', p_consumos jsonb default null) returns jsonb language sql as $$
  select public.registrar_lote(jsonb_build_object(
    'area', 'BAR', 'fecha', privado.hoy()::text, 'producto_id', 'c0000000-0000-0000-0000-000000000008',
    'ficha_id', 'e0000000-0000-0000-0000-000000000801', 'responsable_id', 'a0000000-0000-0000-0000-000000000002',
    'ubicacion_destino', 'BAR_BARRA', 'conservacion', 'Congelado', 'neto_g', 7000, 'tandas', 0.657,
    'consumos', coalesce(p_consumos, jsonb_build_array(
      jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000003', 'gramos', 6570, 'ubicacion', 'BAR_BODEGA'),
      jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'gramos', 547, 'ubicacion', 'BAR_BODEGA'),
      jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000005', 'gramos', 4500)))) || p_extra)
$$;

-- obligatorios
select ok((pg_temp.lote('{"responsable_id": null}') -> 'fatales')::text like '%Falta el responsable%', 'sin responsable no se guarda');
select ok((pg_temp.lote('{"neto_g": null}') -> 'fatales')::text like '%Falta el PESO NETO%', 'sin neto no se guarda');
select ok((pg_temp.lote('{}', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000003', 'ubicacion', 'BAR_BODEGA'))) -> 'fatales')::text
          like '%falta el peso real%', 'sin peso real no se guarda');
-- existencia: 1.000 g de azúcar y se piden 1.500: bloquea aunque traiga motivo
select ok((pg_temp.lote('{"motivo_forzado": "Lo compré en efectivo, ya traigo la factura"}', jsonb_build_array(
            jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'gramos', 1500, 'ubicacion', 'BAR_BODEGA'))) -> 'fatales' ->> 0)
          like 'F9 ·%hay 1000%se necesitan 1500%', 'si no alcanza no se produce, ni con motivo');

-- el lote del Súper limón
create temp table l as select pg_temp.lote() as r;
select is((select (r ->> 'ok')::boolean from l), true, 'lote guardado');
select ok((select r ->> 'codigo' from l) ~ ('^PRO-BAR-' || to_char(privado.hoy(), 'YYYY') || '-0001$'), 'código PRO-BAR-AAAA-0001');
select is((select (r ->> 'entrada_g')::numeric from l), 11617::numeric, 'entrada = suma de pesos reales');
select is((select (r ->> 'merma_g')::numeric from l), 4617::numeric, 'merma = entrada − neto');
select is((select round((r ->> 'rendimiento')::numeric, 6) from l), 0.602565, 'rendimiento = neto / entrada');
select is((select (r ->> 'desvio_pp')::numeric from l), 6.26, 'desvío = rendimiento − ficha (54 %), en puntos');
select ok((select r -> 'avisos' from l)::text like '%+6.26 puntos%', 'avisa porque supera 5 puntos');
select is((select costo_total from public.lotes_produccion where codigo = (select r ->> 'codigo' from l)), 39961::numeric, 'costo = 6.570 × $5 + 547 × $13; el agua $0');
select is((select round(costo_unitario, 6) from public.lotes_produccion where codigo = (select r ->> 'codigo' from l)), 5.708714, '$/g = costo / neto');
select is((select (r ->> 'vence')::date from l), privado.hoy() + 90, 'vence = fecha + 90 días congelado');

-- el kardex cuadra: bajan los insumos y sube la MPI exactamente lo registrado
select is((select array_agg(m.cantidad order by m.id) from public.movimientos m where m.documento_id = (select (r ->> 'id')::uuid from l)),
          array[-6570, -547, 7000]::numeric[], 'consumos de producción y entrada de la MPI');
select is((select cantidad from public.existencias where producto_id = 'c0000000-0000-0000-0000-000000000003' and ubicacion = 'BAR_BODEGA'),
          3430::numeric, 'el limón baja 6.570 g');
select is((select cantidad from public.existencias where producto_id = 'c0000000-0000-0000-0000-000000000008' and ubicacion = 'BAR_BARRA'),
          7000::numeric, 'la limonada sube 7.000 g en la zona donde quedó');
select is((select (entrada_g, neto_g, merma_g, conservacion, responsable_id) from public.lotes_produccion where id = (select (r ->> 'id')::uuid from l)),
          (11617::numeric, 7000::numeric, 4617::numeric, 'Congelado'::text, 'a0000000-0000-0000-0000-000000000002'::uuid),
          'el lote guarda pesos, merma, almacenamiento y responsable');
select is((select usuario_id from public.lotes_produccion where id = (select (r ->> 'id')::uuid from l)),
          'a0000000-0000-0000-0000-000000000003'::uuid, 'y el usuario que lo registró');

-- un insumo en ml se pesa en g: la primera vez se declara su conversión
select ok((pg_temp.lote('{"neto_g": 900, "conservacion": "Refrigerado"}', jsonb_build_array(
            jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000001', 'gramos', 460, 'ubicacion', 'BAR_BODEGA'))) -> 'fatales' ->> 0)
          like 'F8 ·%falta cuántos ml son 1 g%', 'sin conversión g→ml pide declararla');
create temp table l2 as select pg_temp.lote('{"neto_g": 450, "conservacion": "Refrigerado"}', jsonb_build_array(
  jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000001', 'gramos', 460, 'factor', 1.087, 'ubicacion', 'BAR_BODEGA'))) as r;
select is((select m.cantidad from public.movimientos m where m.documento_id = (select (r ->> 'id')::uuid from l2) and m.cantidad < 0),
          -500.02::numeric, 'del kardex salen 460 g × 1,087 = 500,02 ml');
select is((select factor_a_base from public.conversiones where generico_id = 'b0000000-0000-0000-0000-000000000001' and unidad = 'g'),
          1.087::numeric, 'y la conversión queda registrada');

select * from finish();
rollback;
