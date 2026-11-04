-- Precios desde fotos: referencia de precio y costo, sin recepción ni kardex.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
\ir fixtures.inc

create temp table v as select 'BAR/2026/' || gen_random_uuid() || '.jpg' as ruta;

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar
select throws_like(format($$ select public.guardar_precios_foto('{"area": "BAR", "ruta": "%s", "lineas": []}') $$, (select ruta from v)),
                   '%Solo el jefe%', 'el aux no guarda precios');

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
-- azúcar: $20.000 por 2.500 g → $8 por g, con la presentación corregida; ginebra con un precio absurdo
create temp table r as select public.guardar_precios_foto(jsonb_build_object(
  'area', 'BAR', 'ruta', (select ruta from v), 'proveedor', 'Makro', 'fecha', '2026-11-01',
  'lineas', jsonb_build_array(
    jsonb_build_object('n', 1, 'producto_id', 'c0000000-0000-0000-0000-000000000002', 'descripcion', 'AZUCAR MANUELITA 2500G',
                       'cantidad_base', 2500, 'valor_total', 20000, 'fijar_costo', true,
                       'presentacion', jsonb_build_object('presentacion', 'Bolsa 2.500 g', 'unidad_compra', 'BOLSA', 'contenido_base', 2500)),
    jsonb_build_object('n', 2, 'producto_id', 'c0000000-0000-0000-0000-000000000001', 'descripcion', 'TANQUERAY',
                       'cantidad_base', 1, 'valor_total', 150000, 'fijar_costo', true)))) as x;

select is((select (x ->> 'ok')::int from r), 1, 'se guarda la línea buena');
select ok((select x -> 'detalle' -> 1 ->> 'mensaje' like '%no es creíble%' from r), 'la absurda se rechaza con el motivo');
select is((select costo_unitario_base from public.costos_referencia where producto_id = 'c0000000-0000-0000-0000-000000000002'), 8::numeric,
          'el costo de referencia queda en $8 por g');
select ok((select fuente like 'Foto · Makro · 01/11/2026%' from public.costos_referencia where producto_id = 'c0000000-0000-0000-0000-000000000002'),
          'y dice de qué foto salió');
select is((select count(*) from public.compras_historicas where origen = 'FOTO'), 1::bigint, 'queda una compra de referencia');
select is((select unidad_compra from public.productos where id = 'c0000000-0000-0000-0000-000000000002'), 'BOLSA', 'presentación corregida');
select is((select count(*) from public.movimientos), 0::bigint, 'no hay ningún movimiento en el kardex');
select is((select count(*) from public.recepciones), 0::bigint, 'ni recepción');

-- la misma foto otra vez no duplica
select public.guardar_precios_foto(jsonb_build_object('area', 'BAR', 'ruta', (select ruta from v), 'lineas', jsonb_build_array(
  jsonb_build_object('n', 1, 'producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad_base', 2500, 'valor_total', 20000))));
select is((select count(*) from public.compras_historicas where origen = 'FOTO'), 1::bigint, 'guardar dos veces la misma línea no la duplica');

select * from finish();
rollback;
