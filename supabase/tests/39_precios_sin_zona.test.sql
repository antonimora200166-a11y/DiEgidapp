-- Precios desde fotos: una foto con líneas de bar y de cocina; cada una a su área.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);
\ir fixtures.inc

insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base) values
  ('b0000000-0000-0000-0000-000000000801', 'COC_MPe_0801', 'Zanahoria', 'MPe', null, 'COCINA', 'g');
insert into public.productos (id, codigo, generico_id, marca, presentacion, unidad_compra, contenido_base) values
  ('c0000000-0000-0000-0000-000000000801', 'COC_MPe_0801-1', 'b0000000-0000-0000-0000-000000000801', '', 'Granel', 'KG', 1000);

create temp table lineas as select jsonb_build_array(
  jsonb_build_object('n', 1, 'producto_id', 'c0000000-0000-0000-0000-000000000001', 'descripcion', 'TANQUERAY', 'cantidad_base', 700, 'valor_total', 98000),
  jsonb_build_object('n', 2, 'producto_id', 'c0000000-0000-0000-0000-000000000801', 'descripcion', 'ZANAHORIA', 'cantidad_base', 1000, 'valor_total', 3000)) as v;

select pg_temp.como('a0000000-0000-0000-0000-000000000001');  -- admin: las dos áreas
create temp table r as select public.guardar_precios_foto(jsonb_build_object('ruta', 'BAR/2026/' || gen_random_uuid() || '.jpg',
  'proveedor', 'Makro', 'lineas', (select v from lineas))) as x;
select is((select (x ->> 'ok')::int from r), 2, 'el admin guarda el licor (bar) y la zanahoria (cocina) de la misma foto');

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar: solo bar
select throws_like(format($f$ select public.guardar_precios_foto(jsonb_build_object('ruta', 'BAR/2026/x.jpg', 'proveedor', 'Makro', 'lineas', %L::jsonb)) $f$, (select v from lineas)),
                   '%Sin permiso%', 'el jefe de bar ya no carga precios: solo administración');

select * from finish();
rollback;
