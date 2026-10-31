-- Reconteo obligatorio sobre el umbral, programación ABC de conteos y existencias por categoría.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);
\ir fixtures.inc

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar: conteo inicial
select public.registrar_conteo(jsonb_build_object('ubicacion', 'BAR_BODEGA', 'fecha', privado.hoy()::text,
  'responsable_id', 'a0000000-0000-0000-0000-000000000002', 'inicial', true,
  'lineas', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 5000))));
-- el limón de la barra se contó hace 10 días
select public.registrar_conteo(jsonb_build_object('ubicacion', 'BAR_BARRA', 'fecha', (privado.hoy() - 10)::text,
  'responsable_id', 'a0000000-0000-0000-0000-000000000002', 'inicial', true,
  'lineas', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000003', 'cantidad', 2000))));

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar: conteo normal
create or replace function pg_temp.contar(p_linea jsonb) returns jsonb language sql as $$
  select public.registrar_conteo(jsonb_build_object('ubicacion', 'BAR_BODEGA', 'fecha', privado.hoy()::text,
    'responsable_id', 'a0000000-0000-0000-0000-000000000003',
    'lineas', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002') || p_linea)))
$$;

-- 3.000 g contra 5.000 en kardex: 40 % de diferencia, hay que recontar
create temp table r1 as select pg_temp.contar('{"cantidad": 3000}') as r;
select ok(not (select (r ->> 'ok')::boolean from r1), 'sobre el umbral no se guarda sin recontar');
select ok((select r -> 'fatales' ->> 0 from r1) like 'F10 ·%Recuéntalo%', 'pide recontar (F10)');
select ok((select r -> 'fatales' ->> 0 not like '%5000%' from r1), 'el aviso no dice cuánto esperaba el kardex');
select is((select r -> 'recontar' -> 0 ->> 'contada' from r1)::numeric, 3000::numeric, 'devuelve qué producto recontar y su primer conteo');
select is((select count(*)::int from public.conteos where tipo = 'NORMAL'), 0, 'no quedó ningún conteo normal');

-- recontado: 3.100 g, se guarda con el primer conteo
create temp table r2 as select pg_temp.contar('{"cantidad": 3100, "recontado": true, "primer_conteo": 3000}') as r;
select ok((select (r ->> 'ok')::boolean from r2), 'recontado sí se guarda');
select is((select array[cl.primer_conteo, cl.cantidad_contada, cl.diferencia] from public.conteo_lineas cl
            where cl.conteo_id = (select (r ->> 'id')::uuid from r2)),
          array[3000, 3100, -1900]::numeric[], 'guarda el primer conteo, el reconteo y el ajuste');
select ok((select cl.recontado from public.conteo_lineas cl where cl.conteo_id = (select (r ->> 'id')::uuid from r2)), 'marca la línea como recontada');

-- dentro del umbral: 3.050 g contra 3.100 no pide reconteo
select ok((pg_temp.contar('{"cantidad": 3050}') ->> 'ok')::boolean, 'una diferencia chica se guarda sin recontar');

-- programación: el azúcar se contó hoy; el limón (sin clase = C, cada 30 días) hace 10
select is((select toca from public.hoja_conteo('BAR_BODEGA') where codigo = 'BAR_MPe_0005-2500'), false, 'contado hoy: no toca');
select is((select toca from public.hoja_conteo('BAR_BARRA') where codigo = 'BAR_MPe_0030-KG'), false, 'clase C contada hace 10 días: no toca');
update public.productos set clase_abc = 'A' where id = 'c0000000-0000-0000-0000-000000000003';
select is((select array[tocan, tocan_a] from public.conteos_programados() where ubicacion = 'BAR_BARRA'),
          array[1, 1], 'clase A contada hace 10 días: toca (cada 7)');

select is((select categoria from public.v_existencias where producto_id = 'c0000000-0000-0000-0000-000000000002' and ubicacion = 'BAR_BODEGA'),
          'Insumos secos', 'las existencias traen la categoría para valorizar');

select * from finish();
rollback;
