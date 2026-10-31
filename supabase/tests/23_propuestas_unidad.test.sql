-- Propuestas de unidad del catálogo: aceptar, corregir, rechazar y lo que no se puede aplicar.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
\ir fixtures.inc

insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base, estado) values
  ('b0000000-0000-0000-0000-000000000301', 'BAR_MPe_0961', 'Uva verde', 'MPe', null, 'BAR', 'und', 'PROVISIONAL');
insert into public.productos (id, codigo, generico_id, marca, presentacion, unidad_compra, contenido_base) values
  ('c0000000-0000-0000-0000-000000000301', 'BAR_MPe_0961-P01', 'b0000000-0000-0000-0000-000000000301', '', 'Bolsa', 'PAQUETE', 1),
  ('c0000000-0000-0000-0000-000000000302', 'BAR_MPe_0961-P02', 'b0000000-0000-0000-0000-000000000301', '', 'Granel', 'GR', 1);
-- el sirope (b…04) está en una ficha: su unidad no cambia
insert into public.fichas (codigo, generico_id) values ('#5', 'b0000000-0000-0000-0000-000000000004');

insert into public.propuestas_unidad (id, producto_id, cambios, actual, seguridad, razon) values
  ('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000301',
   '{"unidad_base": "g", "contenido_variable": true, "categoria": "FRUVER"}', '{"unidad_base": "und"}', 'MEDIA', 'se pesa'),
  ('f0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000302',
   '{"unidad_base": "g", "contenido_base": 1}', '{"unidad_base": "und"}', 'ALTA', 'se compra por GR'),
  ('f0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000004',
   '{"unidad_base": "ml"}', '{"unidad_base": "g"}', 'MEDIA', 'es líquido'),
  ('f0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000006',
   '{"unidad_base": "und"}', '{"unidad_base": "g"}', 'BAJA', 'prueba'),
  ('f0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000003',
   '{"categoria": "INSUMO_SECO"}', '{"categoria": "FRUVER"}', 'BAJA', 'prueba');

create or replace function pg_temp.decidir(p_ids text[], p_dec text, p_corr jsonb default null) returns jsonb language sql as $$
  select public.decidir_propuestas_unidad(p_ids::uuid[], p_dec, p_corr)
$$;

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar
set local role authenticated;
select is((select count(*) from public.propuestas_unidad), 0::bigint, 'el aux no ve las propuestas');
reset role;
select is((pg_temp.decidir(array['f0000000-0000-0000-0000-000000000001'], 'ACEPTAR') ->> 'fallidos')::int, 1, 'ni las decide');

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
select is((select count(*) from public.lista_propuestas_unidad()), 5::bigint, 'el jefe ve las 5 de bar');

-- aceptar dos a la vez: la uva pasa a g, la bolsa queda variable y la unidad de compra larga se acorta
create temp table r1 as select pg_temp.decidir(array['f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002'], 'ACEPTAR') as v;
select is((select (v ->> 'ok')::int from r1), 2, 'las dos se aplican');
select is((select unidad_base::text from public.genericos where id = 'b0000000-0000-0000-0000-000000000301'), 'g', 'la uva queda en g');
select is((select contenido_variable from public.productos where id = 'c0000000-0000-0000-0000-000000000301'), true, 'la bolsa se pesa al recibir');
select is((select unidad_compra from public.productos where id = 'c0000000-0000-0000-0000-000000000301'), 'PAQ', 'PAQUETE → PAQ');
select is((select categoria from public.genericos where id = 'b0000000-0000-0000-0000-000000000301'), 'FRUVER', 'y queda su categoría');
select is((select estado from public.propuestas_unidad where id = 'f0000000-0000-0000-0000-000000000001'), 'ACEPTADA', 'la propuesta queda aceptada');

-- lo que no se puede: queda pendiente con el motivo
create temp table r2 as select pg_temp.decidir(array['f0000000-0000-0000-0000-000000000003'], 'ACEPTAR') as v;
select is((select (v ->> 'fallidos')::int from r2), 1, 'el sirope en una ficha no cambia de unidad');
select ok((select estado = 'PENDIENTE' and mensaje like '%ficha técnica%' from public.propuestas_unidad where id = 'f0000000-0000-0000-0000-000000000003'),
          'y la propuesta sigue pendiente con el motivo');

-- corregir: en vez de und, el cardamomo se deja en g pero se le da categoría
create temp table r3 as select pg_temp.decidir(array['f0000000-0000-0000-0000-000000000004'], 'ACEPTAR', '{"categoria": "FRUVER"}') as v;
select is((select estado from public.propuestas_unidad where id = 'f0000000-0000-0000-0000-000000000004'), 'CORREGIDA', 'la corrección queda como CORREGIDA');
select is((select unidad_base::text || ' ' || categoria from public.genericos where id = 'b0000000-0000-0000-0000-000000000006'), 'g FRUVER',
          'se aplicó la corrección, no la propuesta');

-- rechazar
select pg_temp.decidir(array['f0000000-0000-0000-0000-000000000005'], 'RECHAZAR');
select is((select estado from public.propuestas_unidad where id = 'f0000000-0000-0000-0000-000000000005'), 'RECHAZADA', 'rechazada');
select is((select categoria from public.genericos where id = 'b0000000-0000-0000-0000-000000000003'), 'FRUVER', 'y el producto no cambió');

select * from finish();
rollback;
