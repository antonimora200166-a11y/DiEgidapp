-- Fórmula del promedio ponderado móvil (privado.nuevo_promedio), aislada del kardex.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select is(privado.nuevo_promedio(0, null, 10, 100), 100::numeric,
  'primera entrada: el promedio es su costo');
select is(privado.nuevo_promedio(10, 100, 10, 200), 150::numeric,
  'entrada con costo: (10·100 + 10·200) / 20 = 150');
select is(privado.nuevo_promedio(7000, 200, 7000, 230), 215::numeric,
  'dos compras de 7.000 ml a $200 y $230 dejan $215');
select is(privado.nuevo_promedio(20, 150, -5, 150), 150::numeric,
  'salida al promedio: no cambia el promedio');
select is(privado.nuevo_promedio(10, 150, 5, null), 150::numeric,
  'entrada sin costo (lote PARCIAL o compra forzada sin precio): conserva el promedio');
select is(privado.nuevo_promedio(0, null, -5, null), null::numeric,
  'salida sin ninguna compra previa: no hay promedio');
select is(privado.nuevo_promedio(-3, 120, 10, 200), 200::numeric,
  'entrada con saldo negativo: el promedio arranca en el costo de la entrada');
select is(privado.nuevo_promedio(20, 150, -10, 200, true), 100::numeric,
  'retirar una entrada de $200: (20·150 − 10·200) / 10 = 100');
select is(privado.nuevo_promedio(10, 150, -10, 200, true), 150::numeric,
  'retirar todo el saldo: conserva el último promedio');
select is(privado.nuevo_promedio(10, 10, -5, 100, true), 10::numeric,
  'retiro que daría promedio negativo: conserva el promedio');
select is(privado.nuevo_promedio(2, 1, 1, 2), 1.333333::numeric,
  'redondeo a 6 decimales');
select throws_like($$ select privado.nuevo_promedio(10, 100, 0, 100) $$, '%no puede ser cero%',
  'un movimiento de cantidad cero se rechaza');

select * from finish();
rollback;
