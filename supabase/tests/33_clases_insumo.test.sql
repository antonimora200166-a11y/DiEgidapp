-- Clases de insumo: desechable, aseo, menaje y herramienta; propuestas y fichas.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
\ir fixtures.inc

insert into public.categorias (codigo, nombre, area, exige_sello, es_perecedero)
  select 'MENAJE', 'Menaje', 'BAR', false, false where not exists (select 1 from public.categorias where codigo = 'MENAJE');
insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base) values
  ('b0000000-0000-0000-0000-000000000601', 'BAR_MPe_0601', 'Pitillo negro', 'MPe', 'INSUMO_SECO', 'BAR', 'und'),
  ('b0000000-0000-0000-0000-000000000602', 'BAR_MPe_0602', 'Copa de vino', 'MPe', 'MENAJE', 'BAR', 'und'),
  ('b0000000-0000-0000-0000-000000000603', 'BAR_MPe_0603', 'Cebolla ocañera', 'MPe', 'FRUVER', 'BAR', 'g');

select is(public.genericos.clase, 'MATERIA_PRIMA'::public.clase_insumo, 'por defecto todo es materia prima')
  from public.genericos where id = 'b0000000-0000-0000-0000-000000000001';

-- las reglas de la migración, sobre estos genéricos (se corren igual que en ella)
select ok('pitillo negro' ~ '(desechable|pitillo)', 'la palabra «pitillo» es inequívoca: desechable');
select ok(not ('cebolla ocanera' ~ '(desechable|pitillo|jabon)'), 'una cebolla no calza en nada (ni «olla» porque herramienta exige categoría no alimentaria)');

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar
select is((public.fijar_clase(array['b0000000-0000-0000-0000-000000000601']::uuid[], 'DESECHABLE') ->> 'ok')::int, 0, 'el aux no cambia la clase');

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
select public.fijar_clase(array['b0000000-0000-0000-0000-000000000601']::uuid[], 'DESECHABLE');
select is((select clase::text || ' ' || categoria from public.genericos where id = 'b0000000-0000-0000-0000-000000000601'),
          'DESECHABLE DESECHABLE', 'el pitillo pasa a desechable, con su categoría');
select is((public.fijar_clase(array['b0000000-0000-0000-0000-000000000004']::uuid[], 'MENAJE') -> 'detalle' -> 0 ->> 'ok')::boolean, false,
          'un MPI no puede ser menaje');

-- propuestas: aceptar y corregir
insert into public.propuestas_clase (id, generico_id, clase, seguridad, razon) values
  ('f0000000-0000-0000-0000-000000000601', 'b0000000-0000-0000-0000-000000000602', 'MENAJE', 'ALTA', 'copa'),
  ('f0000000-0000-0000-0000-000000000602', 'b0000000-0000-0000-0000-000000000006', 'ASEO', 'BAJA', 'prueba');
select is((select count(*) from public.lista_propuestas_clase()), 2::bigint, 'el jefe ve las propuestas de bar');
select public.decidir_propuestas_clase(array['f0000000-0000-0000-0000-000000000601']::uuid[], 'ACEPTAR');
select is((select clase from public.genericos where id = 'b0000000-0000-0000-0000-000000000602'), 'MENAJE'::public.clase_insumo, 'la copa queda como menaje');
select public.decidir_propuestas_clase(array['f0000000-0000-0000-0000-000000000602']::uuid[], 'RECHAZAR');
select is((select clase from public.genericos where id = 'b0000000-0000-0000-0000-000000000006'), 'MATERIA_PRIMA'::public.clase_insumo,
          'rechazada: el cardamomo sigue siendo materia prima');

-- fichas: el desechable sí, el menaje no
insert into public.fichas (id, codigo, generico_id) values ('e0000000-0000-0000-0000-000000000601', '#61', 'b0000000-0000-0000-0000-000000000007');
select lives_ok($$ insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad)
                   values ('e0000000-0000-0000-0000-000000000601', 1, 'b0000000-0000-0000-0000-000000000601', 1, 'und') $$,
                'un pitillo sí va en la ficha del cóctel');
select throws_like($$ insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad)
                      values ('e0000000-0000-0000-0000-000000000601', 2, 'b0000000-0000-0000-0000-000000000602', 1, 'und') $$,
                   '%no va en una ficha técnica%', 'una copa no');
select ok(not exists (select 1 from jsonb_array_elements(public.ficha_para_editar('b0000000-0000-0000-0000-000000000007') -> 'ingredientes') e
                       where e ->> 'id' = 'b0000000-0000-0000-0000-000000000602'),
          'ni aparece entre los ingredientes de la ficha');

select * from finish();
rollback;
