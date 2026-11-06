-- Carta de coctelería: la propuesta se empareja por código de ficha, la decide el jefe de barra
-- (no el chef) y al aprobar nace una versión nueva que conserva los ingredientes ya costeados.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
\ir fixtures.inc

-- Gin Sour (b…07) ya tiene su ficha C99 de SGI-COSTOS: 60 ml de ginebra
insert into public.fichas (id, codigo, generico_id, origen) values ('e0000000-0000-0000-0000-000000000099', 'C99', 'b0000000-0000-0000-0000-000000000007', 'SGI-COSTOS');
insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad) values
  ('e0000000-0000-0000-0000-000000000099', 1, 'b0000000-0000-0000-0000-000000000001', 60, 'ml');
insert into public.recetario_recetas (fuente, codigo, clase, nombre, rendimiento, unidad, componentes, propuesta) values
  ('CARTA COCTELERÍA', 'C99', 'bebida', 'GIN SOUR', 1, 'und',
   '[{"tipo": "ing", "codigo": "BAR-ginebra", "nombre": "Ginebra tanqueray", "cantidad": 60, "unidad": "ml"}, {"tipo": "ing", "codigo": "BAR-clara", "nombre": "clara de huevo", "cantidad": 1, "unidad": "und"}]',
   '{"pasos": ["Dry shake con la clara.", "Hard shake con hielo y doble colado."], "metodo": "Dry shake", "presentacion": "Copa coupé", "alergenos_sugeridos": ["Huevo"]}');
select privado.recetario_proponer('CARTA COCTELERÍA');
select is((select (propuesto_id, similitud) from public.recetario_recetas where codigo = 'C99'),
          ('b0000000-0000-0000-0000-000000000007'::uuid, 1::numeric), 'se empareja por el código de la ficha');

select pg_temp.como('a0000000-0000-0000-0000-000000000005');  -- chef
select throws_like($$ select public.elegir_receta_mpi('CARTA COCTELERÍA', 'C99', 'b0000000-0000-0000-0000-000000000007') $$,
                   '%Solo el jefe de barra%', 'el chef no decide las fichas del bar');
select throws_like($$ select public.validacion_mpi('CARTA COCTELERÍA') $$, '%Sin permiso%', 'ni las ve');

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
select is((select m -> 'candidatas' -> 0 ->> 'similitud' from jsonb_array_elements(public.validacion_mpi('CARTA COCTELERÍA') -> 'mpis') m), '1',
          'la bebida trae su cóctel como candidato al 100 %');
select is((public.validacion_recetario_resumen('CARTA COCTELERÍA') -> 'mpi' ->> 'total')::int, 1, 'el tablero cuenta las bebidas del bar');
select is((public.elegir_receta_mpi('CARTA COCTELERÍA', 'C99', 'b0000000-0000-0000-0000-000000000007') ->> 'ok')::boolean, true, 'el jefe de barra elige');
select is((public.propuesta_receta('CARTA COCTELERÍA', 'C99') -> 'lineas' -> 1 ->> 'nombre'), 'clara de huevo', 'la propuesta muestra los ingredientes de la carta');

create temp table ap as select public.aprobar_receta(jsonb_build_object(
  'fuente', 'CARTA COCTELERÍA', 'receta', 'C99', 'generico_id', 'b0000000-0000-0000-0000-000000000007', 'codigo', 'C99',
  'procedimiento', jsonb_build_array('Dry shake con la clara.', 'Hard shake con hielo y doble colado.'), 'metodo', 'Dry shake',
  'presentacion', 'Copa coupé', 'alergenos', jsonb_build_array('Huevo'),
  'lineas', jsonb_build_array(jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000001', 'cantidad', 60, 'unidad', 'ml')))) as v;
select is((select (v ->> 'ok')::boolean from ap), true, 'aprueba el cóctel');
select is((select (version, origen, metodo) from public.fichas where id = (select (v ->> 'id')::uuid from ap)),
          (2, 'CARTA COCTELERÍA'::text, 'Dry shake'::text), 'nace la versión 2 con lo de la carta');
select is((select count(*) from public.ficha_lineas where ficha_id = (select (v ->> 'id')::uuid from ap)), 1::bigint, 'con sus ingredientes ya costeados');

select * from finish();
rollback;
