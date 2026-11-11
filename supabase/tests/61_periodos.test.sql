-- Bloque 2: real vs. teórico. Teórico + pérdidas + no explicado = real, exacto; el cierre congela
-- las cifras (cambiar un precio después no altera el período cerrado); detalle por insumo.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);
\ir fixtures.inc

-- Gin Sour: 100 g de azúcar. Azúcar a $4/g en el kardex.
insert into public.fichas (id, codigo, generico_id) values ('e0000000-0000-0000-0000-000000000611', 'C99', 'b0000000-0000-0000-0000-000000000007');
insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad) values
  ('e0000000-0000-0000-0000-000000000611', 1, 'b0000000-0000-0000-0000-000000000002', 100, 'g');
insert into public.precios_venta (generico_id, precio_con_impuesto, vigente_desde) values ('b0000000-0000-0000-0000-000000000007', 10800, '2026-01-01');

-- kardex del bar: 5.000 g iniciales ($20.000) el 01/10; compra de 2.500 g ($10.000) el 10/10
select privado.registrar_movimiento('SALDO_INICIAL', 'c0000000-0000-0000-0000-000000000002', 'BAR_BODEGA', 5000, '2026-10-01', 4, 'CONTEO');
select privado.registrar_movimiento('ENTRADA_COMPRA', 'c0000000-0000-0000-0000-000000000002', 'BAR_BODEGA', 2500, '2026-10-10', 4, 'RECEPCION');
-- baja de 100 g dañados ($400) el 12/10
insert into public.bajas (id, codigo, area, ubicacion, fecha, causa) values
  ('f0000000-0000-0000-0000-000000000611', 'BAJ-T1', 'BAR', 'BAR_BODEGA', '2026-10-12', 'DANADO');
select privado.registrar_movimiento('SALIDA_BAJA', 'c0000000-0000-0000-0000-000000000002', 'BAR_BODEGA', 100, '2026-10-12', null, 'BAJA',
                                    'f0000000-0000-0000-0000-000000000611');
-- un traslado dentro del bar no cuenta
insert into public.traslados (id, codigo, fecha, origen, destino) values
  ('f0000000-0000-0000-0000-000000000612', 'TRA-T1', '2026-10-13', 'BAR_BODEGA', 'BAR_BARRA');
select privado.registrar_movimiento('TRASLADO_SALIDA', 'c0000000-0000-0000-0000-000000000002', 'BAR_BODEGA', 1000, '2026-10-13', null, 'TRASLADO', 'f0000000-0000-0000-0000-000000000612');
select privado.registrar_movimiento('TRASLADO_ENTRADA', 'c0000000-0000-0000-0000-000000000002', 'BAR_BARRA', 1000, '2026-10-13', null, 'TRASLADO', 'f0000000-0000-0000-0000-000000000612');
-- conteo del 15/10: el libro dice 7.400 g, se cuentan 5.200 → faltan 2.200 g ($8.800)
select privado.registrar_movimiento('AJUSTE_CONTEO_NEGATIVO', 'c0000000-0000-0000-0000-000000000002', 'BAR_BODEGA', 2200, '2026-10-15', null, 'CONTEO');

-- ventas de Odoo: 20 Gin Sour por $200.000 netos entre el 9 y el 15 → teórico 20 × $400 = $8.000
insert into public.ventas_cargas (id, formato, archivo, huella, desde, hasta, por_dia, lineas, unidades, total_odoo)
values ('f0000000-0000-0000-0000-000000000613', 'TABLA_DINAMICA', 's.xlsx', 'h-per', '2026-10-09', '2026-10-15', true, 1, 20, 200000);
insert into public.ventas_lineas (carga_id, fecha, codigo_odoo, nombre_odoo, clave, cantidad, valor_neto)
values ('f0000000-0000-0000-0000-000000000613', '2026-10-12', 'GS', 'Gin Sour', 'GS', 20, 200000);
insert into public.equivalencias_odoo (clave, nombre_odoo, tipo) values ('GS', 'Gin Sour', 'PRODUCTO');
insert into public.equivalencia_partes (clave, generico_id) values ('GS', 'b0000000-0000-0000-0000-000000000007');

-- ---------------------------------------------------------------- permisos
select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
select throws_like($$ select public.cerrar_periodo('{"area": "BAR", "desde": "2026-10-09", "hasta": "2026-10-15"}') $$, '%Sin permiso%', 'el jefe de barra no cierra');
select throws_like($$ select public.consulta_periodos('BAR') $$, '%Sin permiso%', 'ni ve los períodos');

-- ---------------------------------------------------------------- cálculo
select pg_temp.como('a0000000-0000-0000-0000-000000000001');  -- admin
create temp table c as select privado.periodo_calcular('BAR', '2026-10-09', '2026-10-15') -> 'resumen' as r;
select is((select array[(r ->> 'inv_inicial')::numeric, (r ->> 'compras')::numeric, (r ->> 'inv_final')::numeric] from c),
          array[20000, 10000, 20800]::numeric[], 'inventario inicial $20.000 + compras $10.000; final $20.800');
select is((select array[(r ->> 'traslados_entrada')::numeric, (r ->> 'traslados_salida')::numeric] from c), array[0, 0]::numeric[],
          'el traslado entre zonas del bar no cuenta');
select is((select (r ->> 'cmv_real')::numeric from c), 9200::numeric, 'CMV real = 20.000 + 10.000 − 20.800');
select is((select (r ->> 'cmv_teorico')::numeric from c), 8000::numeric, 'CMV teórico = 20 × $400');
select is((select (r ->> 'perdidas')::numeric from c), 400::numeric, 'pérdidas reportadas: la baja de $400');
select is((select (r ->> 'no_explicado')::numeric from c), 800::numeric, 'no explicado = 9.200 − 8.000 − 400');
select is((select (r ->> 'cmv_teorico')::numeric + (r ->> 'perdidas')::numeric + (r ->> 'no_explicado')::numeric from c),
          (select (r ->> 'cmv_real')::numeric from c), 'teórico + pérdidas + no explicado = real, exacto');
select is((select array[(r ->> 'pct_teorico')::numeric, (r ->> 'pct_real')::numeric, (r ->> 'variacion_pp')::numeric] from c),
          array[4.0, 4.6, 0.6]::numeric[], '% teórico 4,0 · % real 4,6 · 0,6 puntos');
select is((select r ->> 'semaforo' from c), 'VERDE', 'hasta 1 punto: verde');
select is((select r -> 'perdidas_por_causa' ->> 'DANADO' from c), '400', 'pérdidas por causa');
select is((select array[(x ->> 'teorico_q')::numeric, (x ->> 'real_q')::numeric, (x ->> 'dif_valor')::numeric]
             from jsonb_array_elements(privado.periodo_calcular('BAR', '2026-10-09', '2026-10-15') -> 'insumos') x where x ->> 'nombre' = 'Azúcar blanca'),
          array[2000, 2200, 800]::numeric[], 'azúcar: teórico 2.000 g, el conteo encontró 2.200 g de menos, $800 sin explicar');

-- ---------------------------------------------------------------- cierre
select ok(not (public.cerrar_periodo('{"area": "BAR", "desde": "2026-10-09", "hasta": "2026-10-15"}') ->> 'ok')::boolean,
          'sin el conteo de todas las zonas no cierra');
select ok((public.cerrar_periodo('{"area": "BAR", "desde": "2026-10-09", "hasta": "2026-10-15", "forzar": true, "motivo": "prueba"}') ->> 'ok')::boolean,
          'con motivo, cierra');
-- después del cierre el azúcar sube: una compra a $10 el 20/10 cambia el costo de la ficha
select privado.registrar_movimiento('ENTRADA_COMPRA', 'c0000000-0000-0000-0000-000000000002', 'BAR_BODEGA', 5000, '2026-10-20', 10, 'RECEPCION');
select isnt((privado.periodo_calcular('BAR', '2026-10-09', '2026-10-15') -> 'resumen' ->> 'cmv_teorico')::numeric, 8000::numeric,
            'en vivo, el teórico del mismo rango ya cambió con el precio nuevo');
select is((select (p ->> 'cmv_teorico')::numeric from jsonb_array_elements(public.consulta_periodos('BAR') -> 'cerrados') p), 8000::numeric,
          'el período cerrado conserva su teórico de $8.000');
select ok(not (public.cerrar_periodo('{"area": "BAR", "desde": "2026-10-17", "hasta": "2026-10-20", "forzar": true, "motivo": "x"}') ->> 'ok')::boolean,
          'el siguiente período empieza el día después del último cierre');

select * from finish();
rollback;
