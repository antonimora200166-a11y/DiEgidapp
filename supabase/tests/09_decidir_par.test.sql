-- Revisión de pares del catálogo: separar, unir genéricos, producto repetido y lo que se rechaza.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);
\ir fixtures.inc

-- «Azúcar» suelto (provisional, de una recepción) es el mismo insumo que «Azúcar blanca»
insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base, estado) values
  ('b0000000-0000-0000-0000-000000000101', 'BAR_MPe_0901', 'Azúcar refinada', 'MPe', 'INSUMO_SECO', 'BAR', 'g', 'PROVISIONAL'),
  ('b0000000-0000-0000-0000-000000000102', 'BAR_MPe_0902', 'Limón', 'MPe', 'FRUVER', 'BAR', 'und', 'PROVISIONAL');
insert into public.productos (id, codigo, generico_id, marca, presentacion, unidad_compra, contenido_base, estado) values
  ('c0000000-0000-0000-0000-000000000101', 'BAR_MPe_0901-P01', 'b0000000-0000-0000-0000-000000000101', 'Incauca', 'Bolsa 1.000 g', 'PAQ', 1000, 'PROVISIONAL'),
  ('c0000000-0000-0000-0000-000000000102', 'BAR_MPe_0901-P02', 'b0000000-0000-0000-0000-000000000101', 'Manuelita', 'Bolsa 2.500 g', 'PAQ', 2500, 'PROVISIONAL');
insert into public.alias (fuente, alias, generico_id) values ('RECEPCION', 'Azúcar refinada Incauca', 'b0000000-0000-0000-0000-000000000101');
-- producto repetido dentro de Ginebra Tanqueray
insert into public.productos (id, codigo, generico_id, marca, presentacion, unidad_compra, contenido_base) values
  ('c0000000-0000-0000-0000-000000000103', 'BAR_MPe_0079-700B', 'b0000000-0000-0000-0000-000000000001', 'Tanqueray', 'Botella 700 ml (factura)', 'BOT', 700);
insert into public.alias (fuente, alias, generico_id, producto_id) values
  ('INVENTARIO', 'Tanqueray clásica', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001'),
  ('RECEPCION', 'Ginebra Tanqueray x700', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000103');

insert into public.revision_catalogo (id, area, tipo, parecido, propuesta, a_fuente, a_nombre, a_generico_id, b_fuente, b_nombre, b_generico_id) values
  ('P1', 'BAR', 'CASI-DUPLICADO', 0.8, 'REVISAR', 'CATALOGO_MAESTRO', 'Azúcar blanca', 'b0000000-0000-0000-0000-000000000002', 'REC-BAR', 'Azúcar refinada Incauca', 'b0000000-0000-0000-0000-000000000101'),
  ('P2', 'BAR', 'CASI-DUPLICADO', 0.8, 'SEPARAR', 'CATALOGO_MAESTRO', 'Limón Tahití', 'b0000000-0000-0000-0000-000000000003', 'REC-BAR', 'Limón', 'b0000000-0000-0000-0000-000000000102'),
  ('P3', 'BAR', 'DUPLICADO', 1, 'FUSIONAR', 'INV-COC-001', 'Tanqueray clásica', 'b0000000-0000-0000-0000-000000000001', 'REC-BAR', 'Ginebra Tanqueray x700', 'b0000000-0000-0000-0000-000000000001'),
  ('P4', 'BAR', 'CASI-DUPLICADO', 0.75, 'REVISAR', 'REC-BAR', 'Azúcar refinada Incauca', 'b0000000-0000-0000-0000-000000000101', 'CATALOGO_MAESTRO', 'Cardamomo', 'b0000000-0000-0000-0000-000000000006');

-- el aux no decide; el jefe sí ve y decide
select pg_temp.como('a0000000-0000-0000-0000-000000000003');
set local role authenticated;
select is((select count(*) from public.revision_catalogo), 0::bigint, 'el aux de bar no ve los pares');
select throws_like($$ select public.decidir_par('P1', 'FUSIONAR') $$, '%Solo el jefe%', 'el aux no decide pares');
reset role;

select pg_temp.como('a0000000-0000-0000-0000-000000000002');
set local role authenticated;
select is((select count(*) from public.revision_catalogo where decision is null), 4::bigint, 'el jefe de bar ve los pares de bar');
select throws_like($$ update public.revision_catalogo set decision = 'SEPARAR' $$, '%permission denied%', 'nadie edita la tabla directo');

-- unir genéricos distintos: conserva A (Azúcar blanca)
create temp table r1 as select public.decidir_par('P1', 'FUSIONAR', 'A', 'Es el mismo azúcar') as r;
select is(((select r from r1) ->> 'ok')::boolean, true, 'el jefe une los dos genéricos');
reset role;
select is((select generico_id from public.productos where id = 'c0000000-0000-0000-0000-000000000101'),
          'b0000000-0000-0000-0000-000000000002'::uuid, 'el producto nuevo pasa al genérico que queda (mismo código de kardex)');
select is((select activo from public.productos where id = 'c0000000-0000-0000-0000-000000000102'), false,
          'el que repite marca y presentación del que queda se desactiva');
select is((select generico_id from public.alias where alias = 'Azúcar refinada Incauca'), 'b0000000-0000-0000-0000-000000000002'::uuid,
          'el nombre de factura apunta ahora al genérico que queda');
select is((select activo from public.genericos where id = 'b0000000-0000-0000-0000-000000000101'), false, 'el genérico absorbido queda inactivo, no se borra');
select is((select a_generico_id from public.revision_catalogo where id = 'P4'), 'b0000000-0000-0000-0000-000000000002'::uuid,
          'los otros pares del absorbido miran al que queda');
select is((select decision || '|' || (decidido_por is not null)::text from public.revision_catalogo where id = 'P1'), 'FUSIONAR|true',
          'queda la decisión y quién la tomó');

-- unidad base distinta: se rechaza y el par sigue pendiente
select pg_temp.como('a0000000-0000-0000-0000-000000000002');
set local role authenticated;
select is((public.decidir_par('P2', 'FUSIONAR') ->> 'ok')::boolean, false, 'no une g con und');
select is((select decision from public.revision_catalogo where id = 'P2'), null, 'el par rechazado sigue pendiente');
select is((public.decidir_par('P2', 'SEPARAR') ->> 'ok')::boolean, true, 'sí se puede marcar como distintos');
select is((public.decidir_par('P2', 'FUSIONAR') ->> 'ok')::boolean, false, 'un par decidido no se vuelve a decidir');

-- producto repetido en el mismo genérico: se desactiva el absorbido
select is((public.decidir_par('P3', 'FUSIONAR', 'A') ->> 'ok')::boolean, true, 'une el producto repetido');
reset role;
select is((select activo::text || '|' || (select producto_id::text from public.alias where alias = 'Ginebra Tanqueray x700')
             from public.productos where id = 'c0000000-0000-0000-0000-000000000103'),
          'false|c0000000-0000-0000-0000-000000000001', 'el repetido queda inactivo y su nombre apunta al producto que queda');

select * from finish();
rollback;
