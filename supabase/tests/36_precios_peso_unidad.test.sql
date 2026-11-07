-- Precios desde fotos: peso por unidad como conversión y la misma factura sin duplicar.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);
\ir fixtures.inc

insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base) values
  ('b0000000-0000-0000-0000-000000000701', 'BAR_MPe_0701', 'Piña oromiel', 'MPe', 'FRUVER', 'BAR', 'g');
insert into public.productos (id, codigo, generico_id, marca, presentacion, unidad_compra, contenido_base, contenido_variable) values
  ('c0000000-0000-0000-0000-000000000701', 'BAR_MPe_0701-1', 'b0000000-0000-0000-0000-000000000701', '', 'Unidad', 'UND', null, true);

select pg_temp.como('a0000000-0000-0000-0000-000000000001');  -- admin: los pesos solo los ve administración (08/11)
-- 2 piñas a $3.500 c/u, de ~1.200 g cada una → 2.400 g por $7.000
create temp table r as select public.guardar_precios_foto(jsonb_build_object(
  'area', 'BAR', 'ruta', 'BAR/2026/' || gen_random_uuid() || '.jpg', 'proveedor', 'Frutería', 'documento', '47-A5449', 'fecha', '2026-11-03',
  'lineas', jsonb_build_array(jsonb_build_object('n', 1, 'producto_id', 'c0000000-0000-0000-0000-000000000701', 'descripcion', 'PIÑA OROMIEL',
                                                 'cantidad_base', 2400, 'valor_total', 7000, 'peso_unidad', 1200)))) as x;
select is((select (x ->> 'ok')::int from r), 1, 'la piña por unidad se guarda con su peso');
select is((select factor_a_base from public.conversiones where generico_id = 'b0000000-0000-0000-0000-000000000701' and unidad = 'und'),
          1200::numeric, 'queda que 1 und pesa 1.200 g');
select is((select round(costo_unitario_base, 4) from public.costos_referencia where producto_id = 'c0000000-0000-0000-0000-000000000701'),
          2.9167, 'y su costo por g');

-- otra foto de la misma factura: la misma línea no se duplica
create temp table r2 as select public.guardar_precios_foto(jsonb_build_object(
  'area', 'BAR', 'ruta', 'BAR/2026/' || gen_random_uuid() || '.jpg', 'proveedor', 'Frutería', 'documento', '47-A5449', 'fecha', '2026-11-03',
  'lineas', jsonb_build_array(jsonb_build_object('n', 1, 'producto_id', 'c0000000-0000-0000-0000-000000000701', 'descripcion', 'PIÑA OROMIEL',
                                                 'cantidad_base', 2400, 'valor_total', 7000)))) as x;
select is((select count(*) from public.compras_historicas where origen = 'FOTO'), 1::bigint, 'otra foto de la misma factura no duplica la línea');
select ok((select x -> 'detalle' -> 0 ->> 'mensaje' like '%ya se había guardado%' from r2), 'y lo dice');

select * from finish();
rollback;
