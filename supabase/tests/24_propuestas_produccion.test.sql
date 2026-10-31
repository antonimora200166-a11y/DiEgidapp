-- Propuestas del registro de producción: presentación por porción, conservación y vida útil.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
\ir fixtures.inc

insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base) values
  ('b0000000-0000-0000-0000-000000000401', 'COC_MPi_9001', 'Bechamel de coco', 'MPI', null, 'BAR', 'g');
insert into public.productos (id, codigo, generico_id, marca, presentacion, unidad_compra, contenido_variable) values
  ('c0000000-0000-0000-0000-000000000401', 'COC_MPi_9001-P', 'b0000000-0000-0000-0000-000000000401', '', 'Porción', 'PORCION', true);
insert into public.propuestas_unidad (id, producto_id, cambios, actual, seguridad, razon, fuente) values
  ('f0000000-0000-0000-0000-000000000101', 'c0000000-0000-0000-0000-000000000401',
   '{"presentacion": "Porción 200 g", "unidad_compra": "PORC", "contenido_base": 200, "contenido_variable": false,
     "conservacion": "Congelado", "vida_util_dias": 90}', '{}', 'MEDIA', 'registro', 'REGISTRO-PRODUCCION'),
  ('f0000000-0000-0000-0000-000000000102', 'c0000000-0000-0000-0000-000000000401',
   '{"contenido_variable": true}', '{}', 'MEDIA', 'unidad', 'CLAUDE');

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar

-- lo que hace el archivo de datos: la propuesta de unidad pendiente queda reemplazada
update public.propuestas_unidad set estado = 'REEMPLAZADA', mensaje = 'Reemplazada por la propuesta del registro de producción.'
 where fuente = 'CLAUDE' and estado = 'PENDIENTE' and producto_id = 'c0000000-0000-0000-0000-000000000401';
select is((select estado from public.propuestas_unidad where id = 'f0000000-0000-0000-0000-000000000102'), 'REEMPLAZADA', 'la de unidad queda reemplazada');
select is((select fuente from public.lista_propuestas_unidad() where id = 'f0000000-0000-0000-0000-000000000101'), 'REGISTRO-PRODUCCION', 'la lista dice la fuente');

create temp table r as select public.decidir_propuestas_unidad(array['f0000000-0000-0000-0000-000000000101']::uuid[], 'ACEPTAR') as v;
select is((select (v ->> 'ok')::int from r), 1, 'se acepta');
select is((select presentacion || ' · ' || unidad_compra || ' · ' || contenido_base from public.productos where id = 'c0000000-0000-0000-0000-000000000401'),
          'Porción 200 g · PORC · 200', 'la presentación queda por porción de 200 g');
select is((select contenido_variable from public.productos where id = 'c0000000-0000-0000-0000-000000000401'), false, 'con contenido fijo');
select is((select conservacion from public.genericos where id = 'b0000000-0000-0000-0000-000000000401'), 'Congelado', 'se guarda congelado');
select is((select vida_util_dias from public.genericos where id = 'b0000000-0000-0000-0000-000000000401'), 90, 'vida útil 90 días');
select is((select aplicado -> 'generico' ->> 'vida_util_dias' from public.propuestas_unidad where id = 'f0000000-0000-0000-0000-000000000101'), '90',
          'y queda registrado lo que se aplicó');

select * from finish();
rollback;
