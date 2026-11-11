-- Simulador de carta (propuestas con costo nuevo calculado desde la ficha, decisión y precio
-- aplicado con su historia) e informe quincenal (cifras congeladas, versiones). Solo administración.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);
\ir fixtures.inc

-- Gin Sour: 100 g de azúcar a $4 = $400 · carta $10.800 desde ayer (neto $10.000 con 8 %)
insert into public.costos_referencia (producto_id, costo_unitario_base, fuente) values
  ('c0000000-0000-0000-0000-000000000002', 4, 'Mercado: prueba');
insert into public.fichas (id, codigo, generico_id) values ('e0000000-0000-0000-0000-000000000651', 'C99', 'b0000000-0000-0000-0000-000000000007');
insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad) values
  ('e0000000-0000-0000-0000-000000000651', 1, 'b0000000-0000-0000-0000-000000000002', 100, 'g');
insert into public.precios_venta (generico_id, precio_con_impuesto, vigente_desde) values
  ('b0000000-0000-0000-0000-000000000007', 10800, privado.hoy() - 1);

-- ---------------------------------------------------------------- costo simulado
select pg_temp.como('a0000000-0000-0000-0000-000000000001');  -- admin
select is((select array[costo_actual, costo_nuevo] from privado.costo_simulado('b0000000-0000-0000-0000-000000000007',
            '[{"generico_id":"b0000000-0000-0000-0000-000000000002","cantidad_nueva":75}]')),
          array[400, 300]::numeric[], 'bajar el azúcar a 75 g: el costo baja en proporción');
select is((select costo_nuevo from privado.costo_simulado('b0000000-0000-0000-0000-000000000007', '[]')), 400::numeric,
          'sin cambios en la receta el costo nuevo es el actual');

-- ---------------------------------------------------------------- permisos
select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
select throws_like($$ select public.guardar_propuesta('{"generico_id":"b0000000-0000-0000-0000-000000000007","precio_nuevo":12000}') $$,
                   '%Sin permiso%', 'el jefe de barra no simula precios');
select throws_like($$ select * from public.propuestas_lista() $$, '%Sin permiso%', 'ni ve las propuestas');
set local role authenticated;
select is((select count(*)::int from public.propuestas_carta), 0, 'ni las lee directamente de la tabla');
reset role;

-- ---------------------------------------------------------------- propuestas
select pg_temp.como('a0000000-0000-0000-0000-000000000001');  -- admin
select is((select public.guardar_propuesta('{"generico_id":"b0000000-0000-0000-0000-000000000007","precio_nuevo":10800}') ->> 'error'),
          'La propuesta no cambia ni el precio ni la receta.', 'una propuesta tiene que cambiar algo');
select is((select public.guardar_propuesta('{"generico_id":"b0000000-0000-0000-0000-000000000007","cambios":[{"generico_id":"b0000000-0000-0000-0000-000000000002","cantidad_nueva":-5}]}') ->> 'error'),
          'Las cantidades nuevas no pueden ser negativas.', 'cantidades válidas');

create temp table r1 as select public.guardar_propuesta(
  '{"generico_id":"b0000000-0000-0000-0000-000000000007","precio_nuevo":12960,
    "cambios":[{"generico_id":"b0000000-0000-0000-0000-000000000002","cantidad_nueva":75}],
    "resultado":{"pct_area_nuevo":3.1},"nota":"subir y bajar el dulce"}'::jsonb) as v;
select ok((select (v ->> 'ok')::boolean and v ->> 'codigo' = 'PROP-0001' from r1), 'se guarda con su código');
select is((select array[precio_actual, precio_nuevo, costo_actual, costo_nuevo, pct_actual, pct_nuevo] from public.propuestas_carta
            where id = (select (v ->> 'id')::uuid from r1)),
          array[10800, 12960, 400, 300, 4.0, 2.5]::numeric[], 'la base calcula el costo y el % nuevos: $300 contra $12.000 netos');
select is((select cambios -> 0 ->> 'cantidad_actual' from public.propuestas_carta where id = (select (v ->> 'id')::uuid from r1)), '100',
          'guarda la cantidad de antes y la nueva');
select is((select resultado ->> 'pct_area_nuevo' from public.propuestas_carta where id = (select (v ->> 'id')::uuid from r1)), '3.1',
          'y el efecto sobre el área que calculó el simulador');

create temp table r2 as select public.guardar_propuesta('{"generico_id":"b0000000-0000-0000-0000-000000000007","precio_nuevo":11500}'::jsonb) as v;
select is((select public.decidir_propuesta(jsonb_build_object('id', (select v ->> 'id' from r2), 'decision', 'DESCARTAR')) ->> 'error'),
          'Escribe por qué se descarta.', 'descartar pide el motivo');
select ok((select (public.decidir_propuesta(jsonb_build_object('id', (select v ->> 'id' from r2), 'decision', 'DESCARTAR', 'motivo', 'muy caro')) ->> 'ok')::boolean),
          'se descarta con motivo');

create temp table d1 as select public.decidir_propuesta(jsonb_build_object('id', (select v ->> 'id' from r1), 'decision', 'APROBAR', 'aplicar_precio', true)) as v;
select ok((select (v ->> 'precio_aplicado')::boolean and (v ->> 'receta_pendiente')::boolean from d1),
          'aprobada: el precio se aplica y la receta queda para una versión nueva de la ficha');
select is((select array_agg(precio_con_impuesto order by vigente_desde) from public.precios_venta where generico_id = 'b0000000-0000-0000-0000-000000000007'),
          array[10800, 12960]::numeric[], 'el precio anterior queda en la historia');
select is((select public.decidir_propuesta(jsonb_build_object('id', (select v ->> 'id' from r1), 'decision', 'DESCARTAR', 'motivo', 'x')) ->> 'error'),
          'Esta propuesta ya se decidió.', 'una decisión no se cambia');
select throws_like($$ delete from public.propuestas_carta $$, '%', 'las propuestas no se borran');

-- ---------------------------------------------------------------- informe
insert into public.periodos (id, area, desde, hasta, resumen) values
  ('f0000000-0000-0000-0000-000000000651', 'BAR', '2026-10-01', '2026-10-15', '{"ventas_netas": 1000000, "pct_real": 30.5}');
select is((select public.informe_cifras('f0000000-0000-0000-0000-000000000651') -> 'periodo' ->> 'pct_real'), '30.5',
          'las cifras del informe salen del cierre');
select is((select array_agg((public.guardar_informe(jsonb_build_object('periodo_id', 'f0000000-0000-0000-0000-000000000651',
            'resumen', 'Resumen de prueba número ' || n, 'modelo', 'claude-opus-5-5')) ->> 'version')::int order by n) from generate_series(1, 2) n),
          array[1, 2], 'cada informe redactado es una versión nueva');
select throws_like($$ update public.informes_quincenales set resumen = 'otro' $$, '%', 'un informe guardado no se edita');

select * from finish();
rollback;
