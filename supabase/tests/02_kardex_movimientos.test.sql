-- Kardex: compras, traslado, salida, reversa e inmutabilidad, con privado.registrar_movimiento.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);
\ir fixtures.inc

-- Dos compras de 10 botellas de 700 ml: a $200/ml y a $230/ml
select privado.registrar_movimiento('ENTRADA_COMPRA', 'c0000000-0000-0000-0000-000000000001', 'BAR_BODEGA', 7000, current_date, 200, 'PRUEBA');
create temp table m2 as
select * from privado.registrar_movimiento('ENTRADA_COMPRA', 'c0000000-0000-0000-0000-000000000001', 'BAR_BODEGA', 7000, current_date, 230, 'PRUEBA');

select is((select costo_promedio from public.costos_producto where producto_id = 'c0000000-0000-0000-0000-000000000001'),
          215::numeric, 'promedio tras dos compras = $215/ml');
select is((select cantidad from public.costos_producto where producto_id = 'c0000000-0000-0000-0000-000000000001'),
          14000::numeric, 'saldo total = 14.000 ml');

-- Traslado bodega → barra: no cambia el promedio
select privado.registrar_movimiento('TRASLADO_SALIDA', 'c0000000-0000-0000-0000-000000000001', 'BAR_BODEGA', 1400, current_date, null, 'PRUEBA');
select privado.registrar_movimiento('TRASLADO_ENTRADA', 'c0000000-0000-0000-0000-000000000001', 'BAR_BARRA', 1400, current_date, null, 'PRUEBA');
select is((select costo_promedio from public.costos_producto where producto_id = 'c0000000-0000-0000-0000-000000000001'),
          215::numeric, 'el traslado no cambia el promedio');
select is((select cantidad from public.existencias where producto_id = 'c0000000-0000-0000-0000-000000000001' and ubicacion = 'BAR_BODEGA'),
          12600::numeric, 'bodega queda con 12.600 ml');
select is((select cantidad from public.existencias where producto_id = 'c0000000-0000-0000-0000-000000000001' and ubicacion = 'BAR_BARRA'),
          1400::numeric, 'barra queda con 1.400 ml');

-- Salida a producción de 700 ml: sale al promedio vigente
create temp table s1 as
select * from privado.registrar_movimiento('SALIDA_A_PRODUCCION', 'c0000000-0000-0000-0000-000000000001', 'BAR_BARRA', 700, current_date, null, 'PRUEBA');
select is((select cantidad from s1), -700::numeric, 'la salida se guarda con signo negativo');
select is((select costo_unitario from s1), 215::numeric, 'la salida se valora al promedio de $215');
select is((select costo_total from s1), -150500::numeric, 'costo de la salida = −700 × 215');
select is((select saldo_ubicacion from s1), 700::numeric, 'foto del saldo en barra después de la salida');

-- Reversa de la segunda compra: retira su costo del promedio
create temp table r1 as
select * from privado.registrar_movimiento('REVERSA', null, null, null, current_date, null, null, null, null,
                                     (select id from m2), 'Factura duplicada en la prueba');
select is((select cantidad from r1), -7000::numeric, 'la reversa tiene la cantidad opuesta');
select is((select costo_unitario from r1), 230::numeric, 'la reversa sale al costo de la compra original');
select is((select costo_promedio from public.costos_producto where producto_id = 'c0000000-0000-0000-0000-000000000001'),
          198.333333::numeric, 'promedio tras reversar: (13.300·215 − 7.000·230) / 6.300');

select throws_like(format($$ select privado.registrar_movimiento('REVERSA', null, null, null, current_date, null, null, null, null, %s) $$,
                          (select id from m2)),
                   '%ya fue reversado%', 'no se reversa dos veces el mismo movimiento');
select throws_like(format($$ select privado.registrar_movimiento('REVERSA', null, null, null, current_date, null, null, null, null, %s) $$,
                          (select id from r1)),
                   '%no se reversa%', 'una reversa no se reversa');

-- Inmutabilidad del libro mayor
select throws_like($$ update public.movimientos set cantidad = 1 $$, '%inmutable%', 'UPDATE en movimientos se rechaza');
select throws_like($$ delete from public.movimientos $$, '%inmutable%', 'DELETE en movimientos se rechaza');

-- Coherencia: el saldo es la suma del kardex, por producto y por ubicación
select is((select sum(cantidad) from public.movimientos where producto_id = 'c0000000-0000-0000-0000-000000000001'),
          (select cantidad from public.costos_producto where producto_id = 'c0000000-0000-0000-0000-000000000001'),
          'saldo total = suma de movimientos');
select ok(not exists (
  select 1 from public.existencias e
   where e.cantidad <> (select coalesce(sum(m.cantidad), 0) from public.movimientos m
                         where m.producto_id = e.producto_id and m.ubicacion = e.ubicacion)),
  'cada existencia = suma de sus movimientos');

select * from finish();
rollback;
