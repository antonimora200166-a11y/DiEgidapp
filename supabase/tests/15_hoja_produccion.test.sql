-- Hoja de producción (public.datos_produccion) y un lote armado como lo arma la pantalla Producir:
-- la ficha escalada por tandas, el producto con saldo de cada genérico y el neto pesado.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
\ir fixtures.inc

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar

-- 2 bolsas de azúcar por $26.300 ($5,26/g) en la bodega
select public.registrar_recepcion(jsonb_build_object(
  'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', (privado.hoy() - 2)::text,
  'proveedor_id', 'd0000000-0000-0000-0000-000000000002', 'tipo_soporte', 'FACTURA', 'documento', 'FV-7001',
  'recibe_id', 'a0000000-0000-0000-0000-000000000003',
  'lineas', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002',
                                                 'cantidad_recibida', 2, 'valor_total', 26300))));

-- Ficha #5 Sirope Simple: 2.000 g de azúcar + 2.000 ml de agua + 1 cda de cardamomo (sin conversión) → 3.800 g
insert into public.fichas (id, codigo, generico_id, neto_esperado) values
  ('e0000000-0000-0000-0000-000000000005', '#5', 'b0000000-0000-0000-0000-000000000004', 3800);
insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad) values
  ('e0000000-0000-0000-0000-000000000005', 1, 'b0000000-0000-0000-0000-000000000002', 2000, 'g'),
  ('e0000000-0000-0000-0000-000000000005', 2, 'b0000000-0000-0000-0000-000000000005', 2000, 'ml'),
  ('e0000000-0000-0000-0000-000000000005', 3, 'b0000000-0000-0000-0000-000000000006', 1, 'cda');
-- una ficha vencida no aparece
insert into public.fichas (id, codigo, generico_id, version, neto_esperado, vigente_desde, vigente_hasta) values
  ('e0000000-0000-0000-0000-000000000099', '#99', 'b0000000-0000-0000-0000-000000000008', 1, 100,
   privado.hoy() - 30, privado.hoy() - 1);

create temp table d as select public.datos_produccion('BAR') as v;
create or replace function pg_temp.mpi(p_codigo text) returns jsonb language sql as $$
  select x from d, jsonb_array_elements(v -> 'mpis') x where x ->> 'codigo' = p_codigo
$$;
create or replace function pg_temp.linea(p_n int) returns jsonb language sql as $$
  select l from d, jsonb_array_elements(v -> 'fichas') f, jsonb_array_elements(f -> 'lineas') l
   where f ->> 'codigo' = '#5' and (l ->> 'linea')::int = p_n
$$;

select is(pg_temp.mpi('BAR_MPi_0006-G') ->> 'ficha_codigo', '#5', 'el MPI trae su ficha vigente');
select is(pg_temp.mpi('BAR_MPi_0099-G') ->> 'ficha_id', null, 'una ficha vencida no cuenta como vigente');
select is((select jsonb_array_length(f -> 'lineas') from d, jsonb_array_elements(v -> 'fichas') f where f ->> 'codigo' = '#5'),
          3, 'la ficha trae sus 3 líneas');
select is((pg_temp.linea(1) ->> 'factor')::numeric, 1::numeric, 'azúcar en g: factor 1');
select is((pg_temp.linea(2) ->> 'tipo'), 'SIN_COSTO', 'el agua llega marcada sin costo');
select is(pg_temp.linea(3) ->> 'factor', null, 'cucharada de cardamomo sin conversión medida: factor vacío');
select ok((select bool_and(x ->> 'tipo' in ('MPe', 'MPI', 'SIN_COSTO')) from d, jsonb_array_elements(v -> 'insumos') x),
          'los insumos son lo que un lote puede consumir (no bebidas ni platos)');
select is((select (x ->> 'cantidad')::numeric from d, jsonb_array_elements(v -> 'saldos') x
            where x ->> 'producto_id' = 'c0000000-0000-0000-0000-000000000002' and x ->> 'ubicacion' = 'BAR_BODEGA'),
          5000::numeric, 'el saldo de azúcar en la bodega está en la hoja');

-- media tanda, como la arma la pantalla (sin el cardamomo, que no tiene conversión)
create temp table lote as select public.registrar_lote(jsonb_build_object(
  'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', privado.hoy()::text,
  'producto_id', 'c0000000-0000-0000-0000-000000000004', 'ficha_id', 'e0000000-0000-0000-0000-000000000005',
  'responsable_id', 'a0000000-0000-0000-0000-000000000003', 'neto', 1900, 'unidades', 2, 'tiempo_min', 20,
  'consumos', jsonb_build_array(
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 1000, 'unidad', 'g'),
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000005', 'cantidad', 1000, 'unidad', 'ml')))) as r;
select is((select (r ->> 'costo_total')::numeric from lote), 5260::numeric, 'media tanda: 1.000 g × $5,26 (el agua vale $0)');
select is((select (r ->> 'costo_unitario')::numeric from lote), 2.768421::numeric, 'costo por gramo = $5.260 / 1.900 g');
select is((select costo_promedio from public.costos_producto where producto_id = 'c0000000-0000-0000-0000-000000000004'),
          2.768421::numeric, 'el sirope entra al kardex con ese costo');
select is((pg_temp.mpi('BAR_MPi_0006-G') ->> 'ultimo_lote'), null, 'la foto anterior no tenía lotes');
select is((select (x ->> 'ultimo_lote')::date from jsonb_array_elements(public.datos_produccion('BAR') -> 'mpis') x
            where x ->> 'codigo' = 'BAR_MPi_0006-G'), privado.hoy(), 'y ahora el MPI dice cuándo fue su último lote');

select pg_temp.como('a0000000-0000-0000-0000-000000000004');  -- servicio
select throws_like($$ select public.datos_produccion('BAR') $$, '%Sin permiso%', 'servicio no produce');

select * from finish();
rollback;
