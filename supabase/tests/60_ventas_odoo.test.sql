-- Ventas de Odoo y Consulta (bloques 0 y 1): carga con cuadre, días que no se cuentan dos veces,
-- equivalencias (producto, combo a $0, propina, sin equivalencia) y las cifras del período.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);
\ir fixtures.inc

-- carta: Gin Sour (100 g de azúcar = $400, carta $10.800) y un mocktail (50 g = $200, carta $5.400)
insert into public.costos_referencia (producto_id, costo_unitario_base, fuente) values ('c0000000-0000-0000-0000-000000000002', 4, 'prueba');
insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base, nota) values
  ('b0000000-0000-0000-0000-000000000601', 'BAR_BEB_9601', 'Mocktail de prueba', 'BEBIDA', 'COCTEL', 'BAR', 'und', 'Carta: MOCKTAIL');
insert into public.fichas (id, codigo, generico_id) values
  ('e0000000-0000-0000-0000-000000000601', 'C99', 'b0000000-0000-0000-0000-000000000007'),
  ('e0000000-0000-0000-0000-000000000602', 'C96', 'b0000000-0000-0000-0000-000000000601');
insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad) values
  ('e0000000-0000-0000-0000-000000000601', 1, 'b0000000-0000-0000-0000-000000000002', 100, 'g'),
  ('e0000000-0000-0000-0000-000000000602', 1, 'b0000000-0000-0000-0000-000000000002', 50, 'g');
insert into public.precios_venta (generico_id, precio_con_impuesto, vigente_desde) values
  ('b0000000-0000-0000-0000-000000000007', 10800, '2026-01-01'), ('b0000000-0000-0000-0000-000000000601', 5400, '2026-01-01');

create or replace function pg_temp.reporte(p_huella text, p_lineas jsonb, p_total numeric) returns jsonb language sql as $$
  select public.cargar_ventas(jsonb_build_object('formato', 'TABLA_DINAMICA', 'archivo', 'semana.xlsx', 'huella', p_huella,
    'desde', '2026-11-09', 'hasta', '2026-11-15', 'por_dia', true, 'total_odoo', p_total, 'lineas', p_lineas))
$$;
create temp table lin as select jsonb_build_array(
  jsonb_build_object('fecha', '2026-11-09', 'codigo', 'QUAF_BEB_1_099', 'nombre', 'Clasica Gin Sour', 'cantidad', 10, 'valor_neto', 100000),
  jsonb_build_object('fecha', '2026-11-09', 'codigo', '', 'nombre', 'moktel''s de prueba', 'cantidad', 4, 'valor_neto', 20000),
  jsonb_build_object('fecha', '2026-11-09', 'codigo', 'TIPS', 'nombre', 'Propinas', 'cantidad', 1, 'valor_neto', 5000),
  jsonb_build_object('fecha', '2026-11-09', 'codigo', '', 'nombre', 'Cosa rara', 'cantidad', 2, 'valor_neto', 9000),
  jsonb_build_object('fecha', '2026-11-10', 'codigo', '', 'nombre', 'Menú Yuga de prueba', 'cantidad', 3, 'valor_neto', 0)) as v;

-- ---------------------------------------------------------------- permisos
select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
select throws_like($$ select pg_temp.reporte('h0', (select v from lin), 134000) $$, '%Sin permiso%', 'el jefe de barra no carga ventas');
select throws_like($$ select public.consulta_ventas('2026-11-09', '2026-11-15') $$, '%Sin permiso%', 'ni ve Consulta');

-- ---------------------------------------------------------------- carga con cuadre
select pg_temp.como('a0000000-0000-0000-0000-000000000001');  -- admin
select ok(not (pg_temp.reporte('h1', (select v from lin), 999999) ->> 'ok')::boolean, 'si las líneas no suman el total del reporte, no se guarda');
create temp table c1 as select pg_temp.reporte('h1', (select v from lin), 134000) as r;
select is((select (r ->> 'lineas')::int from c1), 5, 'carga las 5 líneas');
select is((select (r ->> 'sin_equivalencia')::int from c1), 5, 'al principio nada tiene equivalencia');
select ok(not (pg_temp.reporte('h1', (select v from lin), 134000) ->> 'ok')::boolean, 'el mismo archivo no se carga dos veces');
select throws_like($$ update public.ventas_lineas set cantidad = 1 $$, '%', 'las ventas cargadas no se editan');

-- otra semana que repite el día 10: ese día se omite
create temp table c2 as select pg_temp.reporte('h2', jsonb_build_array(
  jsonb_build_object('fecha', '2026-11-10', 'codigo', '', 'nombre', 'Menú Yuga de prueba', 'cantidad', 3, 'valor_neto', 0),
  jsonb_build_object('fecha', '2026-11-16', 'codigo', 'QUAF_BEB_1_099', 'nombre', 'Clasica Gin Sour', 'cantidad', 1, 'valor_neto', 10000)), 10000) as r;
select is((select r -> 'omitidos' ->> 0 from c2), '2026-11-10', 'el día que ya estaba cargado se omite');
select is((select (r ->> 'lineas')::int from c2), 1, 'y solo entra el día nuevo');

-- ---------------------------------------------------------------- equivalencias
select is((select count(*) from public.ventas_sin_equivalencia()), 5::bigint, 'cinco productos de Odoo sin equivalencia');
select ok((public.fijar_equivalencia(jsonb_build_object('clave', 'QUAF_BEB_1_099', 'nombre_odoo', 'Clasica Gin Sour', 'tipo', 'PRODUCTO',
  'partes', jsonb_build_array(jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000007')))) ->> 'ok')::boolean, 'Gin Sour por su código');
select public.fijar_equivalencia(jsonb_build_object('clave', privado.clave_odoo('', 'moktel''s de prueba'), 'nombre_odoo', 'moktel''s de prueba',
  'tipo', 'PRODUCTO', 'partes', jsonb_build_array(jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000601'))));
select public.fijar_equivalencia(jsonb_build_object('clave', 'TIPS', 'nombre_odoo', 'Propinas', 'tipo', 'PROPINA'));
select ok((public.fijar_equivalencia(jsonb_build_object('clave', privado.clave_odoo('', 'Menú Yuga de prueba'), 'nombre_odoo', 'Menú Yuga de prueba', 'tipo', 'COMBO',
  'partes', jsonb_build_array(jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000007'),
                              jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000601')))) ->> 'ok')::boolean, 'el menú es un combo de las dos bebidas');
select ok(not (public.fijar_equivalencia(jsonb_build_object('clave', 'X', 'tipo', 'PRODUCTO',
  'partes', jsonb_build_array(jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000002')))) ->> 'ok')::boolean,
  'un insumo no es producto de carta');

-- ---------------------------------------------------------------- Consulta del 9 al 15
-- Gin Sour 10 + 3 del combo = 13 × $400; mocktail 4 + 3 = 7 × $200 → $6.600 sobre $120.000 = 5,5 %
create temp table q as select public.consulta_ventas('2026-11-09', '2026-11-15', 'BAR') as v;
select is((select (v ->> 'ventas_netas')::numeric from q), 120000::numeric, 'ventas netas del bar: sin propinas ni lo que no tiene equivalencia');
select is((select (v ->> 'costo_teorico')::numeric from q), 6600::numeric, 'costo teórico: el combo a $0 también consume');
select is((select (v ->> 'pct_teorico')::numeric from q), 5.5, '% teórico = $6.600 / $120.000');
select is((select array[(v ->> 'costo_sin_venta')::numeric, (v ->> 'pct_teorico_con_venta')::numeric] from q), array[1800, 4.0]::numeric[],
          'el menú a $0 cuesta $1.800 (3 × $400 + 3 × $200); sin él, el % es 4,0');
select is((select (p ->> 'unidades')::numeric from q, jsonb_array_elements(v -> 'productos') p where p ->> 'nombre' = 'Gin Sour'), 13::numeric,
          'Gin Sour: 10 vendidos + 3 del menú');
create temp table qt as select public.consulta_ventas('2026-11-09', '2026-11-15') as v;
select is((select (v ->> 'cobertura_pct')::numeric from qt), 93.0, 'cobertura: $120.000 con ficha de $129.000 vendidos (la «cosa rara» no tiene)');
select is((select (v -> 'sin_equivalencia' ->> 'valor')::numeric from qt), 9000::numeric, 'lo vendido sin equivalencia se reporta aparte');

select * from finish();
rollback;
