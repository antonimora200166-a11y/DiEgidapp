-- Merma por insumo en el lote y lista de lotes sin costo completo (de la app y del histórico).
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);
\ir fixtures.inc

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar

-- 2 bolsas de azúcar por $26.300 ($5,26/g) en la bodega
select public.registrar_recepcion(jsonb_build_object(
  'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', (privado.hoy() - 2)::text,
  'proveedor_id', 'd0000000-0000-0000-0000-000000000002', 'tipo_soporte', 'FACTURA', 'documento', 'FV-7101',
  'recibe_id', 'a0000000-0000-0000-0000-000000000003',
  'lineas', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002',
                                                 'cantidad_recibida', 2, 'valor_total', 26300))));

create or replace function pg_temp.lote(p_consumos jsonb, p_motivo text default null) returns jsonb language sql as $$
  select public.registrar_lote(jsonb_build_object(
    'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', privado.hoy()::text,
    'producto_id', 'c0000000-0000-0000-0000-000000000004', 'responsable_id', 'a0000000-0000-0000-0000-000000000003',
    'neto', 800, 'consumos', p_consumos, 'motivo_forzado', p_motivo))
$$;

-- merma mayor que lo usado: no se guarda
select ok(not (pg_temp.lote(jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002',
                                                                  'cantidad', 1, 'unidad', 'kg', 'merma', 2))) ->> 'ok')::boolean,
          'la merma no puede ser mayor que la cantidad usada');

-- 1 kg de azúcar con 0,1 kg de merma
create temp table l1 as select pg_temp.lote(jsonb_build_array(jsonb_build_object(
  'producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 1, 'unidad', 'kg', 'merma', 0.1))) as r;
select ok((select (r ->> 'ok')::boolean from l1), 'el lote con merma se guarda');
select is((select (r ->> 'merma_base')::numeric from l1), 100::numeric, 'responde la merma total en unidad base');
select is((select array[c.merma, c.merma_base, c.cantidad_base] from public.lote_consumos c where c.lote_id = (select (r ->> 'id')::uuid from l1)),
          array[0.1, 100, 1000]::numeric[], 'la línea guarda la merma escrita y en gramos; del kardex sale el kilo completo');
select is((select (r ->> 'costo_total')::numeric from l1), 5260::numeric, 'la merma no cambia el costo: 1.000 g × $5,26');

-- limón sin compra ni conteo: sin costo; el kardex no tiene saldo, se fuerza con motivo
create temp table l2 as select pg_temp.lote(jsonb_build_array(
  jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 500, 'unidad', 'g'),
  jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000003', 'cantidad', 300, 'unidad', 'g')),
  'El limón llegó sin factura del mercado') as r;
select is((select r ->> 'estado_costo' from l2), 'PARCIAL', 'con un insumo sin costo el lote queda parcial');

-- un lote histórico del .gs sin costo completo (el agua no cuenta como faltante)
insert into public.lotes_historicos (id, codigo, fecha, generico_id, entrada_g, neto_g, costo_total, estado_costo, estado_lote, hallazgos, lineas_sin_precio)
values ('f0000000-0000-0000-0000-000000000001', 'PRO-2026-900', privado.hoy() - 40, 'b0000000-0000-0000-0000-000000000004',
        1500, 1200, 3000, 'PARCIAL', 'REVISAR', '{LINEA_REVISAR}', 1);
insert into public.lote_historico_consumos (id, lote_id, linea, generico_id, tipo, cantidad, unidad, costo_unitario, costo, fuente_costo) values
  ('f1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 1, 'b0000000-0000-0000-0000-000000000002', 'MPe', 1000, 'g', 3, 3000, 'PROMEDIO 1 COMPRA(S) ≤90d'),
  ('f1000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', 2, 'b0000000-0000-0000-0000-000000000006', 'MPe', 20, 'g', null, null, 'SIN COMPRAS REGISTRADAS'),
  ('f1000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001', 3, 'b0000000-0000-0000-0000-000000000005', 'SIN_COSTO', 500, 'ml', null, null, 'SIN COSTO');

create temp table sc as select * from public.lotes_sin_costo('BAR');
select is((select count(*)::int from sc), 2, 'salen el lote parcial de la app y el histórico; no el completo');
select is((select motivos from sc where origen = 'APP'),
          array['Limón Tahití: sin costo en el kardex al producir (falta el conteo inicial o una compra).'],
          'el de la app dice qué insumo no tenía costo');
select is((select motivos from sc where origen = 'HISTÓRICO'),
          array['El .gs marcó líneas por revisar en este lote.', 'Cardamomo: Sin compras registradas.'],
          'el histórico dice por qué, sin contar el agua');

select throws_like($$ update public.lotes_historicos set costo_total = 0 where codigo = 'PRO-2026-900' $$,
                   '%', 'un lote histórico no se edita');

select pg_temp.como('a0000000-0000-0000-0000-000000000005');  -- chef
select throws_like($$ select * from public.lotes_sin_costo('BAR') $$, '%Sin permiso%', 'el chef no ve los costos de bar');

select * from finish();
rollback;
