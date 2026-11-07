-- La línea de la ficha puede pedir una marca: se guarda, se costea con esa marca y Producir la recibe.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
\ir fixtures.inc

-- segunda marca de azúcar, más cara: $6/g (Manuelita $4/g)
insert into public.productos (id, codigo, generico_id, marca, presentacion, unidad_compra, contenido_base) values
  ('c0000000-0000-0000-0000-000000000902', 'BAR_MPe_0005-1000', 'b0000000-0000-0000-0000-000000000002', 'Incauca', 'Bolsa 1.000 g', 'PAQ', 1000);
insert into public.costos_referencia (producto_id, costo_unitario_base, fuente) values
  ('c0000000-0000-0000-0000-000000000002', 4, 'prueba'), ('c0000000-0000-0000-0000-000000000003', 5, 'prueba'),
  ('c0000000-0000-0000-0000-000000000902', 6, 'prueba');

create or replace function pg_temp.limonada(p_marca text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000008', 'codigo', '#99', 'neto_esperado', 1800,
    'puntos', jsonb_build_array(jsonb_build_object('tipo', 'HIGIENE', 'texto', 'Desinfectar los limones.')),
    'lineas', jsonb_build_array(
      jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000003', 'cantidad', 1000, 'unidad', 'g'),
      jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000002', 'cantidad', 200, 'unidad', 'g', 'producto_id', p_marca),
      jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000005', 'cantidad', 1000, 'unidad', 'ml'))) || p_extra
$$;

select pg_temp.como('a0000000-0000-0000-0000-000000000001');  -- admin: ve los pesos
create temp table r1 as select public.guardar_ficha(pg_temp.limonada('c0000000-0000-0000-0000-000000000902')) as v;
select is((select (v ->> 'ok')::boolean from r1), true, 'guarda la ficha con la marca Incauca');
create temp table d as select public.ficha_para_editar('b0000000-0000-0000-0000-000000000008') as v;
select is((select v -> 'lineas' -> 1 ->> 'marca' from d), 'Incauca · Bolsa 1.000 g', 'la línea dice la marca');
select is((select (v -> 'lineas' -> 1 ->> 'costo')::numeric from d), 1200::numeric, 'se costea con la marca: 200 g × $6');
select is((select jsonb_array_length(x -> 'productos') from d, jsonb_array_elements(v -> 'ingredientes') x
            where x ->> 'id' = 'b0000000-0000-0000-0000-000000000002'), 2, 'el editor ofrece las 2 marcas del azúcar');
select is((select costo_tanda from public.produccion_fichas('BAR') where ficha_codigo = '#99'), 6200::numeric,
          'costo de la tanda con la marca: 1000×5 + 200×6');

-- Producir recibe la marca de la línea
select is((select l ->> 'producto_id' from jsonb_array_elements(public.datos_produccion('BAR') -> 'fichas') f,
                  jsonb_array_elements(f -> 'lineas') l
            where f ->> 'codigo' = '#99' and l ->> 'generico_id' = 'b0000000-0000-0000-0000-000000000002'),
          'c0000000-0000-0000-0000-000000000902', 'Producir sabe qué marca pide la ficha');

-- cambiar solo la marca es versión nueva; sin marca, el costo del genérico
create temp table r2 as select public.guardar_ficha(pg_temp.limonada(null, '{"motivo_cambio": "cualquier azúcar"}')) as v;
select ok((select v ->> 'ok' = 'true' and not (v -> 'avisos')::text like '%No había cambios%' from r2), 'quitar la marca crea versión nueva');

-- una marca de otro ingrediente no se acepta
select ok((public.guardar_ficha(pg_temp.limonada('c0000000-0000-0000-0000-000000000001', '{"motivo_cambio": "x"}')) -> 'fatales' ->> 0)
          like '%esa marca no es de este ingrediente%', 'rechaza una marca de otro ingrediente');

-- si la marca se elimina, la línea vuelve a «cualquiera»
create temp table r3 as select public.guardar_ficha(pg_temp.limonada('c0000000-0000-0000-0000-000000000902', '{"motivo_cambio": "otra vez Incauca"}')) as v;
update public.productos set activo = false where id = 'c0000000-0000-0000-0000-000000000902';
select ok((select v -> 'lineas' -> 1 -> 'producto_id' = 'null'::jsonb and v -> 'lineas' -> 1 -> 'marca' = 'null'::jsonb
             from (select public.ficha_para_editar('b0000000-0000-0000-0000-000000000008') as v) x),
          'marca eliminada: la línea queda sin marca');

select * from finish();
rollback;
