-- Ficha completa: procedimiento, puntos críticos, alérgenos, vida útil por almacenamiento,
-- lista de Producción con rendimiento, costo de tanda y $/g, y quién edita (chef sí, sous chef no).
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);
\ir fixtures.inc

insert into auth.users (id, email) values ('a0000000-0000-0000-0000-000000000006', 'sous@prueba.test');
insert into public.perfiles (id, nombre, rol, areas) values ('a0000000-0000-0000-0000-000000000006', 'Sous Prueba', 'sous_chef', '{COCINA}');
insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base) values
  ('b0000000-0000-0000-0000-000000000101', 'COC_MPe_9001', 'Tomate chonto', 'MPe', null, 'COCINA', 'g'),
  ('b0000000-0000-0000-0000-000000000102', 'COC_MPi_9001', 'Salsa pomodoro', 'MPI', null, 'COCINA', 'g');
-- costos de referencia: azúcar $4/g, limón $5/g (sin kardex la ficha los estima)
insert into public.costos_referencia (producto_id, costo_unitario_base, fuente) values
  ('c0000000-0000-0000-0000-000000000002', 4, 'prueba'), ('c0000000-0000-0000-0000-000000000003', 5, 'prueba');

create or replace function pg_temp.limonada(p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000008', 'codigo', '#99', 'neto_esperado', 1800,
    'tiempo_min', 30, 'metodo', 'Licuado y colado',
    'procedimiento', jsonb_build_array('Lavar y desinfectar los limones.', '  ', 'Licuar con el azúcar y el agua; colar.'),
    'alergenos', jsonb_build_array('Sulfitos', 'Sulfitos'),
    'puntos', jsonb_build_array(jsonb_build_object('tipo', 'HIGIENE', 'texto', 'Desinfectar los limones 5 min antes de pelar.'),
                                jsonb_build_object('tipo', 'TEMPERATURA', 'texto', 'Guardar a 2-5 °C apenas se envase.')),
    'almacenamientos', jsonb_build_array(jsonb_build_object('conservacion', 'Refrigerado', 'vida_util_dias', 3, 'nota', '2-5 °C'),
                                         jsonb_build_object('conservacion', 'Congelado', 'vida_util_dias', 90)),
    'lineas', jsonb_build_array(
      jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000003', 'cantidad', 1000, 'unidad', 'g'),
      jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000002', 'cantidad', 200, 'unidad', 'g'),
      jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000005', 'cantidad', 1000, 'unidad', 'ml'))) || p_extra
$$;

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
create temp table r1 as select public.guardar_ficha(pg_temp.limonada()) as v;
select is((select (v ->> 'ok')::boolean from r1), true, 'guarda la ficha completa');
create temp table d as select public.ficha_para_editar('b0000000-0000-0000-0000-000000000008') as v;
select is((select jsonb_array_length(v -> 'ficha' -> 'procedimiento') from d), 2, 'los pasos vacíos se descartan');
select is((select v -> 'ficha' -> 'alergenos' from d), '["Sulfitos"]'::jsonb, 'alérgenos sin repetir');
select is((select v -> 'puntos' -> 0 ->> 'tipo' from d), 'HIGIENE', 'puntos críticos en orden');
select is((select jsonb_array_length(v -> 'almacenamientos') from d), 2, 'vida útil por almacenamiento');
select is((select (v -> 'ficha' ->> 'tiempo_min')::int from d), 30, 'tiempo de preparación');

-- lista de Producción: entrada 2.200, neto 1.800 → 81,8 %; costo 1000×5 + 200×4 = 5.800 → $3,22/g
create temp table l as select * from public.produccion_fichas('BAR') where ficha_codigo = '#99';
select is((select entrada_esperada from l), 2200::numeric, 'entrada esperada = suma de la receta');
select is((select round(rendimiento * 100, 1) from l), 81.8, 'rendimiento esperado = neto / entrada');
select is((select costo_tanda from l), 5800::numeric, 'costo de la tanda = Σ cantidad × costo');
select is((select round(costo_unidad, 2) from l), 3.22, '$/g = costo de la tanda / neto');
select is((select (estado, puntos, pasos) from l), ('VIGENTE'::text, 2, 2), 'vigente, con 2 puntos y 2 pasos');
select ok((select estimado from l), 'marca el costo como estimado (sin kardex)');
select is((select count(*) from public.produccion_fichas('BAR') where estado = 'SIN_FICHA'), 1::bigint, 'el sirope sin ficha sale como SIN_FICHA');

-- validaciones
select ok((public.guardar_ficha(pg_temp.limonada('{"motivo_cambio": "x", "almacenamientos": [{"conservacion": "Nevera", "vida_util_dias": 3}]}')) -> 'fatales' ->> 0)
          like '%ambiente, refrigerado o congelado%', 'almacenamiento válido');
select ok((public.guardar_ficha(pg_temp.limonada('{"motivo_cambio": "x", "puntos": [{"tipo": "HIGIENE", "texto": ""}]}')) -> 'fatales' ->> 0)
          like '%qué hay que controlar%', 'un punto crítico necesita texto');

-- cocina: el chef edita, el sous chef ya no
create or replace function pg_temp.pomodoro() returns jsonb language sql as $$
  select jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000102', 'codigo', 'MPi-900', 'neto_esperado', 800,
    'lineas', jsonb_build_array(jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000101', 'cantidad', 1000, 'unidad', 'g')))
$$;
select pg_temp.como('a0000000-0000-0000-0000-000000000006');
select throws_like($$ select public.guardar_ficha(pg_temp.pomodoro()) $$, '%Solo el chef%', 'el sous chef no edita fichas');
select is((public.ficha_para_editar('b0000000-0000-0000-0000-000000000102') ->> 'puede_editar')::boolean, false, 'y la ve en solo lectura');
select pg_temp.como('a0000000-0000-0000-0000-000000000005');
select is((public.guardar_ficha(pg_temp.pomodoro()) ->> 'ok')::boolean, true, 'el chef sí');

select * from finish();
rollback;
