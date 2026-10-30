-- Bajas y traslados como los registran las pantallas Bajas y Trasladar, y public.saldos_area.
-- Una baja saca al promedio vigente; un traslado mueve saldo entre zonas sin tocar el promedio.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);
\ir fixtures.inc

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar

-- 4 bolsas de azúcar (10.000 g) a $5,26/g y 2 botellas de ginebra (1.400 ml) a $200/ml, en la bodega
select public.registrar_recepcion(jsonb_build_object(
  'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', (privado.hoy() - 1)::text,
  'proveedor_id', 'd0000000-0000-0000-0000-000000000002', 'tipo_soporte', 'FACTURA', 'documento', 'FV-8001',
  'recibe_id', 'a0000000-0000-0000-0000-000000000003',
  'lineas', jsonb_build_array(
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad_recibida', 4, 'valor_total', 52600),
    jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000001', 'cantidad_recibida', 2, 'valor_total', 280000, 'sello', 'SI'))));

create or replace function pg_temp.saldo(p_prod text, p_ubic text) returns numeric language sql as $$
  select coalesce((select cantidad from public.existencias where producto_id = p_prod::uuid and ubicacion = p_ubic), 0)
$$;
create or replace function pg_temp.prom(p_prod text) returns numeric language sql as $$
  select costo_promedio from public.costos_producto where producto_id = p_prod::uuid
$$;
create or replace function pg_temp.baja(p_causa text, p_lineas jsonb, p_extra jsonb default '{}') returns jsonb language sql as $$
  select public.registrar_baja(jsonb_build_object('area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', privado.hoy()::text,
                                                  'causa', p_causa, 'lineas', p_lineas) || p_extra)
$$;
create or replace function pg_temp.traslado(p_lineas jsonb, p_extra jsonb default '{}') returns jsonb language sql as $$
  select public.registrar_traslado(jsonb_build_object('fecha', privado.hoy()::text, 'origen', 'BAR_BODEGA',
                                                      'destino', 'BAR_BARRA', 'lineas', p_lineas) || p_extra)
$$;

-- ================================================================ saldos del área
select is((select (saldos ->> 'BAR_BODEGA')::numeric from public.saldos_area('BAR') where codigo = 'BAR_MPe_0005-2500'),
          10000::numeric, 'saldos_area: el azúcar tiene 10.000 g en la bodega');
select is((select costo_promedio from public.saldos_area('BAR') where codigo = 'BAR_MPe_0005-2500'), 5.26::numeric,
          'y su costo promedio');
select is((select saldos from public.saldos_area('BAR') where codigo = 'BAR_MPe_0030-KG'), '{}'::jsonb,
          'un producto sin saldo trae saldos vacíos');
select ok(not exists (select 1 from public.saldos_area('BAR') where tipo not in ('MPe', 'MPI')),
          'solo lo inventariable (ni agua ni bebidas)');

-- ================================================================ bajas
create temp table b1 as select pg_temp.baja('DERRAME', jsonb_build_array(jsonb_build_object(
  'producto_id', 'c0000000-0000-0000-0000-000000000001', 'cantidad', 150, 'unidad', 'ml'))) as r;
select is((select (r ->> 'ok')::boolean from b1), true, 'una baja por derrame se guarda');
select is(pg_temp.saldo('c0000000-0000-0000-0000-000000000001', 'BAR_BODEGA'), 1250::numeric, 'salen 150 ml de la bodega');
select is((select m.costo_total from public.movimientos m where m.documento_id = (select (r ->> 'id')::uuid from b1)),
          -30000::numeric, 'la baja sale al promedio: 150 ml × $200 = $30.000');
select is(pg_temp.prom('c0000000-0000-0000-0000-000000000001'), 200::numeric, 'y no cambia el promedio');
select is((select r ->> 'codigo' from b1), 'BAJ-BAR-' || to_char(privado.hoy(), 'YYYYMMDD') || '-001', 'código legible');
select ok((pg_temp.baja('OTRO', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 100))) -> 'fatales' ->> 0)
          like 'F1 · Una baja por OTRO necesita observaciones%', 'F1: una baja por OTRO pide observaciones');
select ok((pg_temp.baja('VENCIDO', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 20000))) -> 'bloqueos' ->> 0)
          like 'B3 ·%el kardex tiene 10000%', 'B3: dar de baja más de lo que hay pide motivo');
select ok((pg_temp.baja('VENCIDO', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000005', 'cantidad', 100))) -> 'fatales' ->> 0)
          like 'F5 ·%', 'F5: el agua no se da de baja');

-- ================================================================ traslados
create temp table t1 as select pg_temp.traslado(jsonb_build_array(
  jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 2500),
  jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000001', 'cantidad', 700))) as r;
select is((select (r ->> 'ok')::boolean from t1), true, 'el traslado bodega → barra se guarda');
select is(pg_temp.saldo('c0000000-0000-0000-0000-000000000002', 'BAR_BODEGA'), 7500::numeric, 'la bodega queda con 7.500 g de azúcar');
select is(pg_temp.saldo('c0000000-0000-0000-0000-000000000002', 'BAR_BARRA'), 2500::numeric, 'la barra recibe 2.500 g');
select is(pg_temp.prom('c0000000-0000-0000-0000-000000000002'), 5.26::numeric, 'el traslado no cambia el promedio');
select ok((pg_temp.traslado(jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000001', 'cantidad', 5000))) -> 'bloqueos' ->> 0)
          like 'B3 ·%en BAR_BODEGA hay 550%', 'B3: trasladar más de lo que hay en el origen pide motivo');
select ok((pg_temp.traslado(jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 1)),
                            '{"destino": "BAR_BODEGA"}') -> 'fatales' ->> 0) like 'F1 · Origen y destino%', 'F1: origen y destino iguales');

select pg_temp.como('a0000000-0000-0000-0000-000000000004');  -- servicio
select throws_like($$ select * from public.saldos_area('BAR') $$, '%Sin permiso%', 'servicio no mueve inventario');

select * from finish();
rollback;
