-- Producción: cada ingrediente sale de la zona de donde se cogió y el MPI entra a la zona
-- donde se guarda (ubicacion_destino).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
\ir fixtures.inc

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar

-- azúcar en la bodega (2 bolsas = 5.000 g); limón en la barra (1 kg)
select public.registrar_recepcion(jsonb_build_object(
  'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', (privado.hoy() - 2)::text,
  'proveedor_id', 'd0000000-0000-0000-0000-000000000002', 'tipo_soporte', 'FACTURA', 'documento', 'FV-8101',
  'recibe_id', 'a0000000-0000-0000-0000-000000000003',
  'lineas', jsonb_build_array(
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad_recibida', 2, 'valor_total', 26300),
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000003', 'cantidad_recibida', 1, 'valor_total', 4000,
                       'ubicacion', 'BAR_BARRA'))));

create or replace function pg_temp.lote(p_consumos jsonb, p_destino text, p_motivo text default null) returns jsonb language sql as $$
  select public.registrar_lote(jsonb_build_object(
    'area', 'BAR', 'ubicacion_destino', p_destino, 'fecha', privado.hoy()::text,
    'producto_id', 'c0000000-0000-0000-0000-000000000004', 'responsable_id', 'a0000000-0000-0000-0000-000000000003',
    'neto', 1400, 'consumos', p_consumos, 'motivo_forzado', p_motivo))
$$;

-- azúcar de la bodega, limón de la barra, agua sin zona; el sirope se guarda en la barra
create temp table l1 as select pg_temp.lote(jsonb_build_array(
  jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 1000, 'unidad', 'g', 'ubicacion', 'BAR_BODEGA'),
  jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000003', 'cantidad', 200, 'unidad', 'g', 'ubicacion', 'BAR_BARRA'),
  jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000005', 'cantidad', 300, 'unidad', 'ml')), 'BAR_BARRA') as r;

select ok((select (r ->> 'ok')::boolean from l1), 'con cada ingrediente en su zona el lote se guarda sin pedir motivo');
select is((select cantidad from public.existencias where producto_id = 'c0000000-0000-0000-0000-000000000002' and ubicacion = 'BAR_BODEGA'),
          4000::numeric, 'el azúcar sale de la bodega');
select is((select cantidad from public.existencias where producto_id = 'c0000000-0000-0000-0000-000000000003' and ubicacion = 'BAR_BARRA'),
          800::numeric, 'el limón sale de la barra');
select is((select cantidad from public.existencias where producto_id = 'c0000000-0000-0000-0000-000000000004' and ubicacion = 'BAR_BARRA'),
          1400::numeric, 'el sirope entra a la zona donde se guardó');
select is((select ubicacion from public.lotes_produccion where id = (select (r ->> 'id')::uuid from l1)),
          'BAR_BARRA', 'el lote queda con la zona donde se guardó');
select is((select array_agg(coalesce(ubicacion, '—') order by linea) from public.lote_consumos where lote_id = (select (r ->> 'id')::uuid from l1)),
          array['BAR_BODEGA', 'BAR_BARRA', '—'], 'cada línea guarda de dónde salió; el agua no tiene zona');

-- azúcar «de la barra», donde no hay: no se guarda y nombra la zona
create temp table l2 as select pg_temp.lote(jsonb_build_array(
  jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 500, 'unidad', 'g', 'ubicacion', 'BAR_BARRA')), 'BAR_BARRA') as r;
select ok((select r -> 'fatales' ->> 0 like 'F9 ·%en Barra hay 0%se necesitan 500%' from l2), 'si en esa zona no hay, no se guarda y dice qué zona');

-- falta la zona donde se guarda
select ok((select pg_temp.lote(jsonb_build_array(
  jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 100, 'unidad', 'g', 'ubicacion', 'BAR_BODEGA')), null)
  -> 'fatales' ? 'F1 · Falta la zona donde quedó guardado el lote.'), 'sin zona de guardado no se registra');

-- compatibilidad: un llamado viejo con una sola «ubicacion» sigue funcionando
select ok((select (public.registrar_lote(jsonb_build_object(
    'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', privado.hoy()::text,
    'producto_id', 'c0000000-0000-0000-0000-000000000004', 'responsable_id', 'a0000000-0000-0000-0000-000000000003',
    'neto', 400, 'consumos', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 500, 'unidad', 'g'))))
  ->> 'ok')::boolean), 'sin zonas por línea, todo sale y entra a la «ubicacion» del lote');

select * from finish();
rollback;
