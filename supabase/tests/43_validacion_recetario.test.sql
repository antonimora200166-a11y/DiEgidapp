-- Validar MPI de cocina con el recetario: propuesta por parecido, emparejar ingredientes, elegir la
-- receta de una MPI, aprobarla como ficha v1 (origen RECETARIO COCINA), marcar MPI y crear la que falta.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);
\ir fixtures.inc

insert into auth.users (id, email) values ('a0000000-0000-0000-0000-000000000006', 'sous@prueba.test');
insert into public.perfiles (id, nombre, rol, areas) values ('a0000000-0000-0000-0000-000000000006', 'Sous Prueba', 'sous_chef', '{COCINA}');
insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base) values
  ('b0000000-0000-0000-0000-000000000101', 'COC_MPe_9001', 'Tomate Chonto (rojo)', 'MPe', null, 'COCINA', 'g'),
  ('b0000000-0000-0000-0000-000000000103', 'COC_MPe_9002', 'Albahaca genovesa', 'MPe', null, 'COCINA', 'g'),
  ('b0000000-0000-0000-0000-000000000102', 'COC_MPi_9001', 'Salsa Pomodoro', 'MPI', null, 'COCINA', 'g'),
  ('b0000000-0000-0000-0000-000000000104', 'COC_MPi_9002', 'Sopa del día porción', 'MPI', null, 'COCINA', 'g');

insert into public.recetario_ingredientes (fuente, codigo, nombre, unidad) values
  ('RECETARIO COCINA', 'INS001', 'Tomate Chonto', 'g'), ('RECETARIO COCINA', 'HIE001', 'Albahaca', 'g'),
  ('RECETARIO COCINA', 'OTR999', 'Harina de trigo', 'g');
insert into public.recetario_recetas (fuente, codigo, clase, nombre, rendimiento, unidad, componentes, propuesta) values
  ('RECETARIO COCINA', 'PR001', 'subreceta', 'Salsa pomodoro', 4, 'porciones',
   '[{"tipo": "ing", "codigo": "INS001", "cantidad": 1000, "unidad": "g"}, {"tipo": "ing", "codigo": "HIE001", "cantidad": 20, "unidad": "g"}]',
   '{"pasos": ["Lavar y desinfectar los tomates.", "Cocinar 40 min a fuego bajo."], "puntos": [{"tipo": "HIGIENE", "texto": "Lavar y desinfectar los tomates.", "de": "paso"}]}'),
  ('RECETARIO COCINA', 'PR002', 'subreceta', 'Poolish', 1, 'porciones', '[{"tipo": "ing", "codigo": "OTR999", "cantidad": 500, "unidad": "g"}]', '{}');
select privado.recetario_proponer('RECETARIO COCINA');

select is((select propuesto_id from public.recetario_ingredientes where codigo = 'INS001'), 'b0000000-0000-0000-0000-000000000101'::uuid,
          'propone el genérico más parecido para el ingrediente');
select is((select propuesto_id from public.recetario_recetas where codigo = 'PR001'), 'b0000000-0000-0000-0000-000000000102'::uuid,
          'y la MPI más parecida para la receta');
select is((select propuesto_id from public.recetario_recetas where codigo = 'PR002'), null, 'el Poolish no se parece a ninguna MPI');

-- el sous chef ve pero no decide
select pg_temp.como('a0000000-0000-0000-0000-000000000006');
select is((public.validacion_recetario_resumen() -> 'mpi' ->> 'total')::int, 2, 'el sous chef ve el avance');
select throws_like($$ select public.decidir_ingredientes_recetario('RECETARIO COCINA', array['INS001'], 'CONFIRMAR') $$,
                   '%Solo el chef%', 'pero no decide');

select pg_temp.como('a0000000-0000-0000-0000-000000000005');  -- chef
select is((public.decidir_ingredientes_recetario('RECETARIO COCINA', array['INS001', 'HIE001'], 'CONFIRMAR') ->> 'n')::int, 2,
          'confirma las propuestas en bloque');
select is((select generico_id from public.recetario_ingredientes where codigo = 'HIE001'), 'b0000000-0000-0000-0000-000000000103'::uuid,
          'cada uno queda con su genérico');
select is((public.decidir_ingredientes_recetario('RECETARIO COCINA', array['OTR999'], 'NUEVO') ->> 'n')::int, 1, 'o lo marca como nuevo');

-- MPI ↔ receta
select is((select jsonb_array_length(public.validacion_mpi() -> 'mpis')), 2, 'lista las MPI de cocina');
select is((select m -> 'candidatas' -> 0 ->> 'codigo' from jsonb_array_elements(public.validacion_mpi() -> 'mpis') m
            where m ->> 'nombre' = 'Salsa Pomodoro'), 'PR001', 'con su receta candidata');
select is((public.elegir_receta_mpi('RECETARIO COCINA', 'PR001', 'b0000000-0000-0000-0000-000000000102') ->> 'ok')::boolean, true, 'elige la receta');
create temp table pr as select public.propuesta_receta('RECETARIO COCINA', 'PR001') as v;
select is((select v -> 'lineas' -> 0 ->> 'generico_id' from pr), 'b0000000-0000-0000-0000-000000000101', 'la propuesta trae los ingredientes emparejados');

-- aprobar: nace la ficha v1 de la MPI con origen RECETARIO COCINA
create temp table ap as select public.aprobar_receta(jsonb_build_object(
  'fuente', 'RECETARIO COCINA', 'receta', 'PR001', 'generico_id', 'b0000000-0000-0000-0000-000000000102', 'codigo', 'PR001', 'neto_esperado', 900,
  'procedimiento', jsonb_build_array('Lavar y desinfectar los tomates.', 'Cocinar 40 min a fuego bajo.'),
  'puntos', jsonb_build_array(jsonb_build_object('tipo', 'HIGIENE', 'texto', 'Lavar y desinfectar los tomates.')),
  'almacenamientos', jsonb_build_array(jsonb_build_object('conservacion', 'Refrigerado', 'vida_util_dias', 4)),
  'lineas', jsonb_build_array(jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000101', 'cantidad', 1000, 'unidad', 'g'),
                              jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000103', 'cantidad', 20, 'unidad', 'g')))) as v;
select is((select (v ->> 'ok')::boolean from ap), true, 'aprueba la receta');
select is((select (origen, version) from public.fichas where id = (select (v ->> 'id')::uuid from ap)), ('RECETARIO COCINA'::text, 1),
          'la ficha nace v1 con origen RECETARIO COCINA');
select is((select estado from public.recetario_recetas where codigo = 'PR001'), 'APROBADA', 'la receta queda aprobada');
select is((select estado from public.produccion_fichas('COCINA') where generico_id = 'b0000000-0000-0000-0000-000000000102'), 'VIGENTE',
          'y la MPI sale vigente en Producción');

-- marcar y crear
select is((public.marcar_mpi('b0000000-0000-0000-0000-000000000104', 'NO_ES_MPI', 'Es porción de plato') ->> 'ok')::boolean, true, 'marca lo que no es MPI');
create temp table cm as select public.crear_mpi_desde_receta('RECETARIO COCINA', 'PR002') as v;
select is((select (v ->> 'ok')::boolean from cm), true, 'crea la MPI que faltaba');
select is((select (g.tipo, g.estado) from public.genericos g where g.id = (select (v ->> 'generico_id')::uuid from cm)),
          ('MPI'::public.tipo_generico, 'PROVISIONAL'::public.estado_catalogo), 'como MPI provisional, asignada a la receta');
select is((public.validacion_recetario_resumen() -> 'mpi'), '{"total": 3, "con_ficha": 1, "aprobadas": 1, "no_es_mpi": 1, "sin_receta": 0, "receta_elegida": 1}'::jsonb,
          'el tablero cuenta el avance');

select * from finish();
rollback;
