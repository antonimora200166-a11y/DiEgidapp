-- Los pesos solo los ve administración (06–07/11/2026): el jefe de barra y los auxiliares ven
-- cantidades, recetas y registros, pero los costos, valores y precios les llegan vacíos. Por
-- dentro la base calcula igual (el lote que registra el aux queda con su costo real).
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);
\ir fixtures.inc

-- ---------------------------------------------------------------- qué es un campo de pesos
select ok(privado.es_campo_pesos('costo_total') and privado.es_campo_pesos('valor') and privado.es_campo_pesos('pct_costo')
          and privado.es_campo_pesos('ultimo_costo_base') and privado.es_campo_pesos('precio_con_impuesto'), 'costos, valores y precios son pesos');
select ok(not privado.es_campo_pesos('lineas_con_costo') and not privado.es_campo_pesos('estado_costo') and not privado.es_campo_pesos('cantidad'),
          'conteos, estados y cantidades no');
select is(privado.sin_pesos('{"costo_total": 5260, "lineas": [{"costo": 10, "cantidad": 2}], "estado_costo": "COMPLETO", "lineas_con_costo": 3}'),
          '{"costo_total": null, "lineas": [{"costo": null, "cantidad": 2}], "estado_costo": "COMPLETO", "lineas_con_costo": 3}'::jsonb,
          'sin_pesos vacía los pesos, también dentro de listas, y deja lo demás');

-- ---------------------------------------------------------------- datos: 2 bolsas de azúcar por $26.300 y una ficha
select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar
select public.registrar_recepcion(jsonb_build_object(
  'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', privado.hoy()::text,
  'proveedor_id', 'd0000000-0000-0000-0000-000000000002', 'tipo_soporte', 'FACTURA', 'documento', 'FV-5001',
  'recibe_id', 'a0000000-0000-0000-0000-000000000003',
  'lineas', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002',
                                                 'cantidad_recibida', 2, 'valor_total', 26300))));
insert into public.fichas (id, codigo, generico_id) values ('e0000000-0000-0000-0000-000000000501', 'C50', 'b0000000-0000-0000-0000-000000000007');
insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad) values
  ('e0000000-0000-0000-0000-000000000501', 1, 'b0000000-0000-0000-0000-000000000002', 100, 'g'),
  ('e0000000-0000-0000-0000-000000000501', 2, 'b0000000-0000-0000-0000-000000000006', 2, 'g');   -- cardamomo sin costo

-- ---------------------------------------------------------------- el jefe de barra
select pg_temp.como('a0000000-0000-0000-0000-000000000002');
select ok((select costo is null and costo_unitario is null from public.costo_ficha('e0000000-0000-0000-0000-000000000501') where linea = 1),
          'la ficha le llega sin costos');
select ok((select falta is not null from public.costo_ficha('e0000000-0000-0000-0000-000000000501') where linea = 2),
          'pero sí le dice qué ingrediente no tiene costo (sin decir cuánto)');
select is((select cantidad from public.v_existencias where producto_codigo = 'BAR_MPe_0005-2500'), 5000::numeric, 've la cantidad en existencias');
select ok((select valor is null and costo_promedio is null from public.v_existencias where producto_codigo = 'BAR_MPe_0005-2500'), 'pero no su valor');
select ok((select costo_promedio is null from public.saldos_area('BAR') where codigo = 'BAR_MPe_0005-2500'), 'ni el costo promedio de los saldos');
select ok((select valor is null from public.historial_documentos('BAR') where tipo = 'RECEPCION'), 'ni el valor de la recepción en el historial');
select ok((select costo_unidad is null from public.pedido_sugerido('BAR') limit 1) is not false, 'ni el costo en el pedido sugerido');

set local role authenticated;
select throws_like($$ select costo_total from public.movimientos limit 1 $$, '%permission denied%', 'leer el kardex directo: sin columnas de pesos');
select is((select count(*) from public.movimientos), 1::bigint, 'las filas del kardex sí las ve');
select is((select count(*) from public.costos_producto), 0::bigint, 'los costos de los productos no');
select is((select count(*) from public.precios_venta), 0::bigint, 'ni los precios de carta');
reset role;

-- ---------------------------------------------------------------- administración
select pg_temp.como('a0000000-0000-0000-0000-000000000001');
select is((select costo from public.costo_ficha('e0000000-0000-0000-0000-000000000501') where linea = 1), 526::numeric,
          'administración ve el costo: 100 g × $5,26');
select is((select valor from public.v_existencias where producto_codigo = 'BAR_MPe_0005-2500'), 26300::numeric, 'y el valor del inventario');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '%\_completo'),
          'las versiones completas no quedan a la vista de la app');

select * from finish();
rollback;
