-- Compuertas de la recepción y anulación con reversa del kardex.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);
\ir fixtures.inc

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar

-- Recepción base válida: 4 bolsas de azúcar por $52.600 ($5,26/g)
create or replace function pg_temp.rec(p_doc text, p_lineas jsonb, p_extra jsonb default '{}') returns jsonb
language sql as $$
  select public.registrar_recepcion(jsonb_build_object(
    'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', (privado.hoy() - 1)::text,
    'proveedor_id', 'd0000000-0000-0000-0000-000000000002', 'tipo_soporte', 'FACTURA', 'documento', p_doc,
    'recibe_id', 'a0000000-0000-0000-0000-000000000003', 'lineas', p_lineas) || p_extra)
$$;
create or replace function pg_temp.azucar(p_cant numeric, p_valor numeric) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002',
                                              'cantidad_recibida', p_cant, 'valor_total', p_valor))
$$;
create or replace function pg_temp.tiene(p_lista jsonb, p_codigo text) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements_text(p_lista) x where x like p_codigo || ' ·%')
$$;

create temp table ok1 as select pg_temp.rec('FV-3001', pg_temp.azucar(4, 52600)) as r;
select is((select (r ->> 'ok')::boolean from ok1), true, 'recepción válida se guarda');
select is((select r ->> 'codigo' from ok1), 'REC-BAR-' || to_char(privado.hoy() - 1, 'YYYYMMDD') || '-001', 'código legible y consecutivo');

-- F4 · documento duplicado del mismo proveedor
select ok(pg_temp.tiene(pg_temp.rec('fv-3001', pg_temp.azucar(1, 13150)) -> 'fatales', 'F4'),
          'F4: el mismo documento del mismo proveedor se rechaza (sin importar mayúsculas)');
-- F2 · fecha futura
select ok(pg_temp.tiene(pg_temp.rec('FV-3002', pg_temp.azucar(1, 13150), jsonb_build_object('fecha', (privado.hoy() + 1)::text)) -> 'fatales', 'F2'),
          'F2: fecha futura se rechaza');
-- F5 · producto fuera del catálogo
select ok(pg_temp.tiene(pg_temp.rec('FV-3003', jsonb_build_array(jsonb_build_object('producto_id', gen_random_uuid(), 'cantidad_recibida', 1, 'valor_total', 1000))) -> 'fatales', 'F5'),
          'F5: un producto que no existe en el catálogo se rechaza');
-- F5 · un MPI no se recibe
select ok(pg_temp.tiene(pg_temp.rec('FV-3004', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000004', 'cantidad_recibida', 1, 'valor_total', 1000))) -> 'fatales', 'F5'),
          'F5: un MPI no entra por recepción');
-- B1 · sin documento
select ok(pg_temp.tiene(pg_temp.rec(null, pg_temp.azucar(1, 13150)) -> 'bloqueos', 'B1'), 'B1: sin N° de documento bloquea');
-- B4 · recibido 0 marcado OK
select ok(pg_temp.tiene(pg_temp.rec('FV-3005', pg_temp.azucar(0, null)) -> 'bloqueos', 'B4'), 'B4: recibido 0 marcado OK bloquea');
-- B7 · precio muy por encima de su mediana ($20/g contra $5,26/g)
select ok(pg_temp.tiene(pg_temp.rec('FV-3006', pg_temp.azucar(1, 50000)) -> 'bloqueos', 'B7'), 'B7: precio 3,8× la mediana del producto bloquea');
-- B10 · cantidad implausible para la unidad de compra
select ok(pg_temp.tiene(pg_temp.rec('FV-3007', pg_temp.azucar(800, 10520000)) -> 'bloqueos', 'B10'), 'B10: 800 bolsas no es plausible');
-- B8 · licor sin sello
select ok(pg_temp.tiene(public.registrar_recepcion(jsonb_build_object(
    'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', (privado.hoy() - 1)::text,
    'proveedor_id', 'd0000000-0000-0000-0000-000000000001', 'documento', 'DL-5001',
    'recibe_id', 'a0000000-0000-0000-0000-000000000003',
    'lineas', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000001',
                                                   'cantidad_recibida', 1, 'valor_total', 140000)))) -> 'bloqueos', 'B8'),
  'B8: licor sin marcar el sello bloquea');

-- B6 · sin valor: sin motivo no guarda; con motivo guarda, marca H03 y entra sin costo
select is((pg_temp.rec('FV-3008', pg_temp.azucar(1, null)) ->> 'ok')::boolean, false, 'B6: sin valor y sin motivo no guarda');
create temp table forz as select pg_temp.rec('FV-3008', pg_temp.azucar(1, null),
  jsonb_build_object('motivo_forzado', 'Factura llega mañana con el domiciliario')) as r;
select is((select (r ->> 'ok')::boolean from forz), true, 'B6 con motivo: guarda forzada');
select ok((select 'H03' = any (l.hallazgos) from public.recepcion_lineas l where l.recepcion_id = (select (r ->> 'id')::uuid from forz)),
          'la línea sin precio queda marcada H03');
select is((select costo_promedio from public.costos_producto where producto_id = 'c0000000-0000-0000-0000-000000000002'),
          5.26::numeric, 'una entrada sin costo no mueve el promedio');

-- Anular: el aux no puede; el jefe sí, con motivo; el kardex vuelve atrás
select throws_like(format($$ select public.anular_documento('RECEPCION', %L, 'Recepción registrada dos veces') $$, (select r ->> 'id' from ok1)),
                   '%Solo Administración o el jefe%', 'el aux de bar no puede anular');
select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
select is((public.anular_documento('RECEPCION', (select (r ->> 'id')::uuid from ok1), 'Recepción registrada dos veces') ->> 'ok')::boolean,
          true, 'el jefe de bar anula con motivo');
select is((select cantidad from public.existencias where producto_id = 'c0000000-0000-0000-0000-000000000002' and ubicacion = 'BAR_BODEGA'),
          2500::numeric, 'tras anular queda solo la bolsa forzada (2.500 g)');

select * from finish();
rollback;
