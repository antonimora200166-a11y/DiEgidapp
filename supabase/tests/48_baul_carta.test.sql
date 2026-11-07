-- Baúl de la carta: los cócteles y platos que no se venden guardan su ficha pero dejan de salir
-- en Carta y margen, Fichas técnicas y los tableros de validación. Se mueven varios a la vez y
-- se pueden sacar. Solo carta (BEBIDA / PLATO) y solo quien edita el área.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
\ir fixtures.inc

insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base) values
  ('b0000000-0000-0000-0000-000000000301', 'BAR_BEB_9301', 'Cóctel vigente',    'BEBIDA', null, 'BAR', 'und'),
  ('b0000000-0000-0000-0000-000000000302', 'BAR_BEB_9302', 'Cóctel retirado',   'BEBIDA', null, 'BAR', 'und'),
  ('b0000000-0000-0000-0000-000000000303', 'BAR_BEB_9303', 'Cóctel retirado 2', 'BEBIDA', null, 'BAR', 'und'),
  ('b0000000-0000-0000-0000-000000000304', 'BAR_MPi_9301', 'Sirope de prueba',  'MPI',    null, 'BAR', 'ml'),
  ('b0000000-0000-0000-0000-000000000305', 'COC_PLA_9301', 'Plato retirado',    'PLATO',  null, 'COCINA', 'und');

select pg_temp.como('a0000000-0000-0000-0000-000000000001');  -- admin
create temp table antes as select count(*) as n from public.carta_costos('BAR');

select is((public.mover_al_baul(array['b0000000-0000-0000-0000-000000000302', 'b0000000-0000-0000-0000-000000000303']::uuid[], 'Sale de carta') ->> 'movidos')::int,
          2, 'mueve dos cócteles a la vez');
select is((select count(*) from public.carta_costos('BAR')), (select n - 2 from antes), 'ya no salen en Carta y margen');
select ok(exists (select 1 from public.carta_costos('BAR') where nombre = 'Cóctel vigente'), 'el vigente sigue en la carta');
select ok(not exists (select 1 from public.lista_fichas('BAR') where nombre like 'Cóctel retirado%'), 'ni en Fichas técnicas');
select ok(not exists (select 1 from jsonb_array_elements(public.validacion_mpi('CARTA COCTELERÍA') -> 'mpis') m where m ->> 'nombre' like 'Cóctel retirado%'),
          'ni en Validar fichas');
select is((select array_agg(nombre order by nombre) from public.carta_baul('BAR')), array['Cóctel retirado', 'Cóctel retirado 2'], 'están en el baúl');
select is((select motivo from public.carta_baul('BAR') limit 1), 'Sale de carta', 'con su motivo');
select is((select count(*) from public.bitacora where accion = 'AL BAÚL'), 2::bigint, 'queda en bitácora');
select is((public.mover_al_baul(array['b0000000-0000-0000-0000-000000000302']::uuid[]) ->> 'movidos')::int, 0, 'moverlo otra vez no hace nada');
select is((public.mover_al_baul(array['b0000000-0000-0000-0000-000000000304']::uuid[]) ->> 'ok')::boolean, false, 'una MPI no va al baúl');

-- sacar uno: vuelve a la carta
select is((public.sacar_del_baul(array['b0000000-0000-0000-0000-000000000303']::uuid[]) ->> 'sacados')::int, 1, 'saca uno del baúl');
select ok(exists (select 1 from public.carta_costos('BAR') where nombre = 'Cóctel retirado 2'), 'y vuelve a la carta');

-- permisos: el chef no toca la carta del bar; el aux de barra tampoco
select pg_temp.como('a0000000-0000-0000-0000-000000000005');  -- chef
select throws_like($$ select public.mover_al_baul(array['b0000000-0000-0000-0000-000000000301']::uuid[]) $$, '%Sin permiso%', 'el chef no mueve cócteles');
select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de barra
select throws_like($$ select public.sacar_del_baul(array['b0000000-0000-0000-0000-000000000302']::uuid[]) $$, '%Sin permiso%', 'el aux de barra no saca del baúl');

select * from finish();
rollback;
