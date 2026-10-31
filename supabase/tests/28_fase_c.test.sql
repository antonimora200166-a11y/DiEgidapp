-- Fase C: Hoy, carta con margen, pedido sugerido, etiqueta de lote y códigos de barras.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);
\ir fixtures.inc

update public.productos set stock_minimo = 3 where id = 'c0000000-0000-0000-0000-000000000002';   -- azúcar: mínimo 3 bolsas
update public.genericos set vida_util_dias = 1 where id = 'b0000000-0000-0000-0000-000000000004';  -- sirope: 1 día

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar
-- 2 bolsas de azúcar de la Frutería por $26.300
select public.registrar_recepcion(jsonb_build_object(
  'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', (privado.hoy() - 2)::text,
  'proveedor_id', 'd0000000-0000-0000-0000-000000000002', 'tipo_soporte', 'FACTURA', 'documento', 'FV-8001',
  'recibe_id', 'a0000000-0000-0000-0000-000000000003',
  'lineas', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002',
                                                 'cantidad_recibida', 2, 'valor_total', 26300))));
-- un lote de sirope de ayer: vence hoy
create temp table l as select public.registrar_lote(jsonb_build_object(
  'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', (privado.hoy() - 1)::text,
  'producto_id', 'c0000000-0000-0000-0000-000000000004', 'responsable_id', 'a0000000-0000-0000-0000-000000000003',
  'neto', 900, 'consumos', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 1000, 'unidad', 'g')))) as r;

-- pedido: quedan 4.000 g = 1,6 bolsas ≤ 3 → pedir hasta 6 (sin máximo: el doble del mínimo)
create temp table ped as select * from public.pedido_sugerido('BAR');
select is((select array[saldo_unidades, pedir] from ped where codigo = 'BAR_MPe_0005-2500'), array[1.6, 5]::numeric[], 'azúcar: 1,6 bolsas, pedir 5');
select is((select proveedor from ped where codigo = 'BAR_MPe_0005-2500'), 'Frutería', 'a quién se le compró la última vez');
select is((select costo_unidad from ped where codigo = 'BAR_MPe_0005-2500'), 13150::numeric, 'costo de la última bolsa');

-- etiqueta del lote
create temp table et as select public.lote_etiqueta((select r ->> 'codigo' from l)) as e;
select is((select (e ->> 'vence')::date from et), privado.hoy(), 'vence = fecha del lote + vida útil');
select is((select e ->> 'mpi' from et), 'Sirope Simple', 'la etiqueta trae el MPI');

-- Hoy
create temp table h as select public.resumen_hoy() as v;
select is((select (x ->> 'bajo_minimo')::int from h, jsonb_array_elements(v -> 'areas') x where x ->> 'area' = 'BAR'), 1, 'Hoy: un producto en el mínimo');
select is((select x -> 'por_vencer' -> 0 ->> 'producto' from h, jsonb_array_elements(v -> 'areas') x where x ->> 'area' = 'BAR'),
          'Sirope Simple', 'Hoy: el sirope vence');
select ok((select not (x ? 'provisionales') from h, jsonb_array_elements(v -> 'areas') x where x ->> 'area' = 'BAR'),
          'el aux no ve los pendientes de revisión del catálogo');

-- códigos de barras
select ok((public.asociar_codigo_barras('7702001043', 'c0000000-0000-0000-0000-000000000002') ->> 'ok')::boolean, 'el aux asocia un código');
select is((select generico from public.producto_por_codigo('7702001043')), 'Azúcar blanca', 'el código lleva al producto');
select ok(not (public.asociar_codigo_barras('7702001043', 'c0000000-0000-0000-0000-000000000003') ->> 'ok')::boolean,
          'un código no se reasigna a otro producto');

-- carta: Gin Sour con 100 g de azúcar ($526) a $10.800 con impoconsumo
insert into public.fichas (id, codigo, generico_id) values ('e0000000-0000-0000-0000-000000000007', 'C99', 'b0000000-0000-0000-0000-000000000007');
insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad) values
  ('e0000000-0000-0000-0000-000000000007', 1, 'b0000000-0000-0000-0000-000000000002', 100, 'g');
select throws_like($$ select public.fijar_precio('b0000000-0000-0000-0000-000000000007', 10800) $$, '%Sin permiso%', 'el aux no fija precios');
select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
select ok((public.fijar_precio('b0000000-0000-0000-0000-000000000007', 10800) ->> 'ok')::boolean, 'el jefe fija el precio');
select is((select array[costo, pct_costo, margen] from public.carta_costos('BAR') where nombre = 'Gin Sour'),
          array[526, 5.3, 9474]::numeric[], 'costo, % de costo sobre el precio sin impoconsumo y margen');
select ok(not (public.fijar_precio('b0000000-0000-0000-0000-000000000007', 11000) ->> 'ok')::boolean, 'un precio por día: no se edita');

-- mínimo y máximo
select ok(not (public.fijar_stock('c0000000-0000-0000-0000-000000000002', 4, 2) ->> 'ok')::boolean, 'el máximo no puede ser menor que el mínimo');
select ok((public.fijar_stock('c0000000-0000-0000-0000-000000000002', 2, 6) ->> 'ok')::boolean, 'el jefe fija mínimo y máximo');
select is((select pedir from public.pedido_sugerido('BAR') where codigo = 'BAR_MPe_0005-2500'), 5::numeric, 'con máximo 6: pedir 5 (hay 1,6)');

select pg_temp.como('a0000000-0000-0000-0000-000000000005');  -- chef
select throws_like($$ select * from public.carta_costos('BAR') $$, '%Sin permiso%', 'el chef no ve la carta del bar');

select * from finish();
rollback;
