-- Una factura de fruver con productos de cocina y de bar: una recepción por área, mismo número.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);
\ir fixtures.inc

insert into public.categorias (codigo, nombre, area) values ('COC_FRUVER', 'Frutas y verduras', 'COCINA');
insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base) values
  ('b0000000-0000-0000-0000-0000000000c1', 'COC_MPe_0900', 'Yuca', 'MPe', 'COC_FRUVER', 'COCINA', 'g');
insert into public.productos (id, codigo, generico_id, presentacion, unidad_compra, contenido_base) values
  ('c0000000-0000-0000-0000-0000000000c1', 'COC_MPe_0900-GR', 'b0000000-0000-0000-0000-0000000000c1', 'Granel', 'GR', 1);

select pg_temp.como('a0000000-0000-0000-0000-000000000001');  -- administración opera en las dos áreas
create or replace function pg_temp.rec(p_area text, p_ubic text, p_prod uuid, p_cant numeric, p_valor numeric) returns jsonb
language sql as $$
  select public.registrar_recepcion(jsonb_build_object(
    'area', p_area, 'ubicacion', p_ubic, 'fecha', (privado.hoy() - 1)::text,
    'proveedor_id', 'd0000000-0000-0000-0000-000000000002', 'tipo_soporte', 'FACTURA', 'documento', '47-A5449',
    'recibe_id', 'a0000000-0000-0000-0000-000000000001',
    'lineas', jsonb_build_array(jsonb_build_object('producto_id', p_prod, 'cantidad_recibida', p_cant, 'valor_total', p_valor))))
$$;

select ok((pg_temp.rec('BAR', 'BAR_BODEGA', 'c0000000-0000-0000-0000-000000000003', 0.5, 1100) ->> 'ok')::boolean, 'lo de bar de la factura se registra en bar');
select ok((pg_temp.rec('COCINA', 'COC_BODEGA', 'c0000000-0000-0000-0000-0000000000c1', 500, 1600) ->> 'ok')::boolean,
          'la misma factura se registra también en cocina con lo suyo');
create temp table otra as select pg_temp.rec('COCINA', 'COC_BODEGA', 'c0000000-0000-0000-0000-0000000000c1', 500, 1600) as r;
select ok((select r -> 'fatales' ->> 0 from otra) like 'F4 ·%en cocina%', 'pero no dos veces en la misma área (F4)');
select is((select count(*)::int from public.recepciones where documento = '47-A5449'), 2, 'quedan dos recepciones, una por área');

-- cada artículo a su zona
create temp table z as select public.registrar_recepcion(jsonb_build_object(
  'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', (privado.hoy() - 1)::text,
  'proveedor_id', 'd0000000-0000-0000-0000-000000000002', 'tipo_soporte', 'FACTURA', 'documento', 'ZONA-0001',
  'recibe_id', 'a0000000-0000-0000-0000-000000000001',
  'lineas', jsonb_build_array(
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad_recibida', 1, 'valor_total', 13150),
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000003', 'cantidad_recibida', 1, 'valor_total', 2200, 'ubicacion', 'BAR_BARRA')))) as r;
select is((select cantidad from public.existencias where producto_id = 'c0000000-0000-0000-0000-000000000003' and ubicacion = 'BAR_BARRA'),
          1000::numeric, 'la línea con zona propia entra a esa zona (el limón a la barra)');
select is((select cantidad from public.existencias where producto_id = 'c0000000-0000-0000-0000-000000000002' and ubicacion = 'BAR_BODEGA'),
          2500::numeric, 'la que no trae zona entra a la del encabezado');
select ok(pg_temp.rec('BAR', 'BAR_BODEGA', 'c0000000-0000-0000-0000-000000000003', 1, 1) is not null
          and (public.registrar_recepcion(jsonb_build_object('area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', (privado.hoy() - 1)::text,
            'proveedor_id', 'd0000000-0000-0000-0000-000000000002', 'tipo_soporte', 'FACTURA', 'documento', 'ZONA-0002',
            'recibe_id', 'a0000000-0000-0000-0000-000000000001',
            'lineas', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad_recibida', 1,
              'valor_total', 13150, 'ubicacion', 'COC_BODEGA')))) -> 'fatales' ->> 0) like 'F1 ·%zona%',
          'una zona de otra área en la línea se rechaza (F1)');

select * from finish();
rollback;
