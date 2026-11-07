-- Platos de la carta de cocina (fuente CARTA COCINA): leen las recetas de plato del recetario de cocina,
-- validan genéricos PLATO, sus componentes salen de las MPI elegidas para las subrecetas y la ficha nace
-- con origen RECETARIO COCINA. Las MPI siguen en su fuente sin mezclarse con los platos.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
\ir fixtures.inc

insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base) values
  ('b0000000-0000-0000-0000-000000000201', 'COC_MPe_9101', 'Queso parmesano', 'MPe', null, 'COCINA', 'g'),
  ('b0000000-0000-0000-0000-000000000202', 'COC_MPi_9101', 'Salsa Pomodoro', 'MPI', null, 'COCINA', 'g'),
  ('b0000000-0000-0000-0000-000000000203', 'COC_PLA_9001', 'Pasta Pomodoro', 'PLATO', null, 'COCINA', 'und'),
  ('b0000000-0000-0000-0000-000000000204', 'COC_PLA_9002', 'Burrata', 'PLATO', null, 'COCINA', 'und');
insert into public.recetario_ingredientes (fuente, codigo, nombre, unidad, generico_id, estado) values
  ('RECETARIO COCINA', 'LAC001', 'Queso parmesano', 'g', 'b0000000-0000-0000-0000-000000000201', 'CONFIRMADO');
insert into public.recetario_recetas (fuente, codigo, clase, nombre, rendimiento, unidad, componentes, propuesta, generico_id) values
  ('RECETARIO COCINA', 'PR001', 'subreceta', 'Salsa pomodoro', 1000, 'g', '[]', '{}', 'b0000000-0000-0000-0000-000000000202'),
  ('RECETARIO COCINA', 'PR002', 'subreceta', 'Pesto', 300, 'g', '[]', '{}', null);
insert into public.recetario_recetas (fuente, codigo, clase, nombre, rendimiento, unidad, componentes, propuesta) values
  ('RECETARIO COCINA', 'P001', 'plato', 'PASTA POMODORO', 1, 'porciones',
   '[{"tipo": "sub", "codigo": "PR001", "cantidad": 1, "unidad": "porciones"}, {"tipo": "ing", "codigo": "LAC001", "cantidad": 15, "unidad": "g"}]',
   '{"pasos": ["Calentar la salsa.", "Servir con parmesano."]}'),
  ('RECETARIO COCINA', 'P002', 'plato', 'PASTA AL PESTO', 1, 'porciones', '[{"tipo": "sub", "codigo": "PR002", "cantidad": 1, "unidad": "porciones"}]', '{}');

-- el tablero de platos cuenta platos y recetas de plato; el de MPI no se mezcla
select pg_temp.como('a0000000-0000-0000-0000-000000000005');  -- chef
select is((public.validacion_recetario_resumen('CARTA COCINA') -> 'mpi' ->> 'total')::int, 2, 'el tablero cuenta los 2 platos');
select is((public.validacion_recetario_resumen('CARTA COCINA') -> 'recetas' ->> 'subrecetas')::int, 2, 'y las 2 recetas de plato');
select is((public.validacion_recetario_resumen('RECETARIO COCINA') -> 'recetas' ->> 'subrecetas')::int, 2, 'las subrecetas siguen en su fuente');
select is((select count(*) from jsonb_array_elements(public.validacion_mpi('CARTA COCINA') -> 'recetas')), 2::bigint, 'la lista trae solo recetas de plato');
select is((select m -> 'candidatas' -> 0 ->> 'codigo' from jsonb_array_elements(public.validacion_mpi('CARTA COCINA') -> 'mpis') m
            where m ->> 'nombre' = 'Pasta Pomodoro'), 'P001', 'el plato trae su receta como candidata');

-- elegir: solo un plato de cocina, y solo recetas de plato
select throws_like($$ select public.elegir_receta_mpi('CARTA COCINA', 'P001', 'b0000000-0000-0000-0000-000000000202') $$,
                   '%un plato%', 'una MPI no es un plato');
select throws_like($$ select public.elegir_receta_mpi('CARTA COCINA', 'PR001', 'b0000000-0000-0000-0000-000000000203') $$,
                   '%no está en CARTA COCINA%', 'una subreceta no se elige como plato');
select is((public.elegir_receta_mpi('CARTA COCINA', 'P001', 'b0000000-0000-0000-0000-000000000203') ->> 'ok')::boolean, true, 'el chef elige el plato');

-- la propuesta resuelve la subreceta con su MPI y el ingrediente con su insumo
select is((select array_agg(l ->> 'generico_id' order by n) from jsonb_array_elements(public.propuesta_receta('CARTA COCINA', 'P001') -> 'lineas') with ordinality e(l, n)),
          array['b0000000-0000-0000-0000-000000000202', 'b0000000-0000-0000-0000-000000000201'], 'subreceta → MPI e ingrediente → insumo');
select is((select l ->> 'estado' from jsonb_array_elements(public.propuesta_receta('CARTA COCINA', 'P002') -> 'lineas') l), 'SIN_MPI',
          'una subreceta sin MPI se avisa');

-- marcar «sin receta» un plato
select is((public.marcar_mpi('b0000000-0000-0000-0000-000000000204', 'SIN_RECETA', null, 'CARTA COCINA') ->> 'ok')::boolean, true, 'marca un plato sin receta');
select is((public.validacion_recetario_resumen('CARTA COCINA') -> 'mpi' ->> 'sin_receta')::int, 1, 'y el tablero lo cuenta');

-- aprobar: ficha v1 del plato con origen RECETARIO COCINA
create temp table ap as select public.aprobar_receta(jsonb_build_object(
  'fuente', 'CARTA COCINA', 'receta', 'P001', 'generico_id', 'b0000000-0000-0000-0000-000000000203', 'codigo', 'P001', 'porciones', '1',
  'procedimiento', jsonb_build_array('Calentar la salsa.', 'Servir con parmesano.'),
  'lineas', jsonb_build_array(
    jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000202', 'cantidad', 1, 'unidad', 'porcion', 'factor', 180),
    jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000201', 'cantidad', 15, 'unidad', 'g')))) as v;
select is((select (v ->> 'ok')::boolean from ap), true, 'aprueba el plato');
select is((select (version, origen) from public.fichas where id = (select (v ->> 'id')::uuid from ap)), (1, 'RECETARIO COCINA'::text), 'nace la ficha v1');
select is((select estado from public.recetario_recetas where fuente = 'RECETARIO COCINA' and codigo = 'P001'), 'APROBADA', 'la receta queda aprobada');
select throws_like($$ select public.aprobar_receta(jsonb_build_object('fuente', 'CARTA COCINA', 'receta', 'PR001', 'generico_id', 'b0000000-0000-0000-0000-000000000202')) $$,
                   '%No existe esa receta%', 'por la fuente de platos no se aprueba una subreceta');

select * from finish();
rollback;
