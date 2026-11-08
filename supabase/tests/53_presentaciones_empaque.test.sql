-- La ficha dice cómo se porciona y empaca lo que sale: se guarda, cuenta como cambio y Producir la recibe.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
\ir fixtures.inc

create or replace function pg_temp.ficha(p_pres jsonb, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000008', 'codigo', '#98', 'neto_esperado', 1800,
    'empaque', 'Bolsa de vacío',
    'puntos', jsonb_build_array(jsonb_build_object('tipo', 'HIGIENE', 'texto', 'Desinfectar los limones.')),
    'presentaciones', p_pres,
    'lineas', jsonb_build_array(
      jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000003', 'cantidad', 1000, 'unidad', 'g'),
      jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000005', 'cantidad', 1000, 'unidad', 'ml'))) || p_extra
$$;

select pg_temp.como('a0000000-0000-0000-0000-000000000001');
create temp table r1 as select public.guardar_ficha(pg_temp.ficha(
  '[{"contenido": "200"}, {"contenido": "150", "empaque": "Bolsa de vacío pequeña"}, {"detalle": "3 tapas", "por_tanda": "4"}]')) as v;
select is((select (v ->> 'ok')::boolean from r1), true, 'guarda la ficha con 3 presentaciones');

create temp table d as select public.ficha_para_editar('b0000000-0000-0000-0000-000000000008') as v;
select is((select jsonb_array_length(v -> 'presentaciones') from d), 3, 'la ficha trae sus presentaciones');
select is((select v -> 'presentaciones' -> 1 ->> 'empaque' from d), 'Bolsa de vacío pequeña', 'en orden, con su empaque propio');
select is((select (v -> 'presentaciones' -> 2 ->> 'por_tanda')::int from d), 4, 'porciones fijas por tanda');

select is((select jsonb_array_length(f -> 'presentaciones') from jsonb_array_elements(public.datos_produccion('BAR') -> 'fichas') f
            where f ->> 'codigo' = '#98'), 3, 'Producir sabe cómo se empaca');

-- cambiar solo las presentaciones es versión nueva
create temp table r2 as select public.guardar_ficha(pg_temp.ficha('[{"contenido": "200"}]', '{"motivo_cambio": "solo de 200"}')) as v;
select ok((select v ->> 'ok' = 'true' and not (v -> 'avisos')::text like '%No había cambios%' from r2), 'cambiar presentaciones crea versión nueva');

-- validaciones
select ok((public.guardar_ficha(pg_temp.ficha('[{"por_tanda": "22"}]', '{"motivo_cambio": "x"}')) -> 'fatales' ->> 0)
          like '%escribe cuánto lleva cada empaque%', 'una presentación sin contenido ni detalle no se acepta');
select ok((public.guardar_ficha(pg_temp.ficha('[{"contenido": "200"}, {"contenido": "200"}]', '{"motivo_cambio": "x"}')) -> 'fatales' ->> 0)
          like '%repetida%', 'no acepta presentaciones repetidas');
select ok((public.guardar_ficha(pg_temp.ficha('[{"contenido": "200", "por_tanda": "10"}]', '{"motivo_cambio": "x"}')) -> 'avisos')::text
          like '%suman 2000 g y la tanda da 1800 g%', 'avisa si las porciones fijas pesan más que la tanda');

select * from finish();
rollback;
