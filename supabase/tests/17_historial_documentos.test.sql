-- Historial y detalle de documentos (pantalla Historial) y anular desde ahí.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);
\ir fixtures.inc

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar

-- recepción (azúcar 4 bolsas $52.600 + limón 2 kg $16.000), un traslado y una baja
create temp table rec as select public.registrar_recepcion(jsonb_build_object(
  'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', (privado.hoy() - 1)::text,
  'proveedor_id', 'd0000000-0000-0000-0000-000000000002', 'tipo_soporte', 'FACTURA', 'documento', 'FV-9001',
  'recibe_id', 'a0000000-0000-0000-0000-000000000003',
  'lineas', jsonb_build_array(
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad_recibida', 4, 'valor_total', 52600),
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000003', 'cantidad_recibida', 2, 'valor_total', 16000)))) as r;
create temp table tra as select public.registrar_traslado(jsonb_build_object('fecha', privado.hoy()::text,
  'origen', 'BAR_BODEGA', 'destino', 'BAR_BARRA',
  'lineas', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 2500))))
  as r;
create temp table baj as select public.registrar_baja(jsonb_build_object('area', 'BAR', 'ubicacion', 'BAR_BARRA',
  'fecha', privado.hoy()::text, 'causa', 'DANADO',
  'lineas', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 100))))
  as r;

create temp table h as select * from public.historial_documentos('BAR');
select is((select count(*) from h), 3::bigint, 'el historial trae los 3 documentos');
select is((select count(*) from h where anulado), 0::bigint, 'al inicio ninguno está anulado');
select is((select valor from h where tipo = 'RECEPCION'), 68600::numeric, 'valor de la recepción: $52.600 + $16.000');
select is((select valor from h where tipo = 'TRASLADO'), 13150::numeric, 'valor del traslado: 2.500 g × $5,26 (solo la salida)');
select is((select detalle from h where tipo = 'RECEPCION'), 'Frutería · FV-9001', 'detalle: proveedor y documento');
select is((select detalle from h where tipo = 'BAJA'), 'Dañado · Barra', 'detalle de la baja: causa y zona');
select is((select usuario from h where tipo = 'RECEPCION'), 'Aux Bar Prueba', 'quién lo registró');
select is((select count(*) from public.historial_documentos('BAR', 'traslado')), 1::bigint, 'filtro por tipo');

create temp table d as select public.detalle_documento('RECEPCION', (select (r ->> 'id')::uuid from rec)) as v;
select is((select jsonb_array_length(v -> 'lineas') from d), 2, 'el detalle trae las 2 líneas');
select is((select (v -> 'lineas' -> 0 ->> 'costo_unitario')::numeric from d), 5.26::numeric, 'con su costo por unidad base');
select is((select (v ->> 'puede_anular')::boolean from d), false, 'el aux no puede anular');

-- el jefe anula la línea del limón y luego el traslado completo
select pg_temp.como('a0000000-0000-0000-0000-000000000002');
select is((public.detalle_documento('RECEPCION', (select (r ->> 'id')::uuid from rec)) ->> 'puede_anular')::boolean, true, 'el jefe sí');
select public.anular_documento('RECEPCION', (select (r ->> 'id')::uuid from rec), 'El limón se devolvió al proveedor',
                               (select (v -> 'lineas' -> 1 ->> 'id')::uuid from d));
select is((public.detalle_documento('RECEPCION', (select (r ->> 'id')::uuid from rec)) -> 'lineas' -> 1 ->> 'anulada')::boolean, true,
          'la línea anulada queda marcada');
select is((select anulado from public.historial_documentos('BAR') where tipo = 'RECEPCION'), false,
          'anular una línea no anula la recepción');
select public.anular_documento('TRASLADO', (select (r ->> 'id')::uuid from tra), 'Se registró en la zona equivocada');
select is((select anulado from public.historial_documentos('BAR') where tipo = 'TRASLADO'), true, 'el traslado aparece anulado');
select is((public.detalle_documento('TRASLADO', (select (r ->> 'id')::uuid from tra)) -> 'anulacion' ->> 'motivo'),
          'Se registró en la zona equivocada', 'el detalle dice por qué se anuló');

select pg_temp.como('a0000000-0000-0000-0000-000000000005');  -- chef (cocina)
select throws_like($$ select * from public.historial_documentos('BAR') $$, '%Sin permiso%', 'cocina no ve los documentos de bar');
select pg_temp.como('a0000000-0000-0000-0000-000000000004');  -- servicio
select throws_like($$ select * from public.historial_documentos('BAR') $$, '%Sin permiso%', 'servicio no ve documentos');

select * from finish();
rollback;
