-- Carta y margen: precio neto sin impoconsumo, % de costo, margen, meta de la sección con
-- semáforo, estado de la ficha e ingredientes. Solo administración ve precios y costos.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);
\ir fixtures.inc

-- ---------------------------------------------------------------- fórmula pura
-- Margarita real: costo $12.030, carta $45.000 con 8 % → neto $41.666,67
select is((select array[precio_neto, pct_costo, margen, margen_pct] from privado.calculo_margen(12030, 45000, 8, 25, 3)),
          array[41666.67, 28.9, 29637, 71.1]::numeric[], 'neto = precio / 1,08; % y margen sobre el neto');
select is((select semaforo from privado.calculo_margen(12030, 45000, 8, 25, 3)), 'ROJO', '28,9 % con meta 25 y banda 3: rojo');
select is((select semaforo from privado.calculo_margen(12030, 45000, 8, 27, 3)), 'AMARILLO', 'con meta 27: amarillo (≤ 30)');
select is((select semaforo from privado.calculo_margen(12030, 45000, 8, 28.9, 3)), 'VERDE', 'igual a la meta: verde');
select is((select semaforo from privado.calculo_margen(12030, 45000, 8, 25.9, 3)), 'AMARILLO', 'justo en meta + banda: amarillo');
select ok((select pct_costo is null and margen is null and semaforo is null from privado.calculo_margen(null, 45000, 8, 25, 3)),
          'sin costo completo no hay % ni margen');
select ok((select precio_neto is null and pct_costo is null from privado.calculo_margen(12030, null, 8, 25, 3)), 'sin precio tampoco');
select is((select precio_neto from privado.calculo_margen(12030, 45000, 0, 25, 3)), 45000.00, 'con impoconsumo 0 el neto es el precio');

-- ---------------------------------------------------------------- sección y meta
select is(privado.seccion_carta(null, 'Carta: MOCKTAIL (STELLA) · Ficha origen: X'), 'MOCKTAIL', 'la sección sale de la nota y se normaliza');
select is(privado.seccion_carta('Autor', 'Carta: CLÁSICA'), 'AUTOR', 'la columna manda sobre la nota');
select is((select meta_pct from privado.meta_costo('BAR', 'MOCKTAIL')), 22::numeric, 'mocktail: 22 %');
select is((select meta_pct from privado.meta_costo('BAR', 'SIN SECCIÓN NUEVA')), 24::numeric, 'sección sin meta: la general del bar');
select is((select meta_pct from privado.meta_costo('COCINA', 'ENTRADA')), 30::numeric, 'cocina: 30 % provisional');
insert into public.metas_costo (area, seccion, meta_pct, banda_pp, vigente_desde) values ('BAR', 'MOCKTAIL', 20, 2, privado.hoy() + 10);
select is((select meta_pct from privado.meta_costo('BAR', 'MOCKTAIL')), 22::numeric, 'una meta futura no cambia la de hoy');
select is((select array[meta_pct, banda_pp] from privado.meta_costo('BAR', 'MOCKTAIL', privado.hoy() + 10)), array[20, 2]::numeric[],
          'desde su fecha manda la nueva');
select throws_like($$ update public.metas_costo set meta_pct = 99 where seccion = 'MOCKTAIL' $$, '%', 'las metas no se editan: se agrega una nueva');

-- ---------------------------------------------------------------- carta
insert into public.costos_referencia (producto_id, costo_unitario_base, fuente) values
  ('c0000000-0000-0000-0000-000000000002', 4, 'Mercado: prueba');            -- azúcar $4/g
insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base, nota) values
  ('b0000000-0000-0000-0000-000000000401', 'BAR_BEB_9401', 'Mocktail de prueba', 'BEBIDA', 'COCTEL', 'BAR', 'und', 'Carta: MOCKTAIL (STELLA)'),
  ('b0000000-0000-0000-0000-000000000402', 'BAR_BEB_9402', 'Cóctel sin ficha',   'BEBIDA', 'COCTEL', 'BAR', 'und', 'Carta: AUTOR'),
  ('b0000000-0000-0000-0000-000000000403', 'BAR_BEB_9403', 'Cóctel del baúl',    'BEBIDA', 'COCTEL', 'BAR', 'und', 'Carta: AUTOR');
update public.genericos set en_baul = true where id = 'b0000000-0000-0000-0000-000000000403';
insert into public.fichas (id, codigo, generico_id) values
  ('e0000000-0000-0000-0000-000000000901', 'C99', 'b0000000-0000-0000-0000-000000000007'),   -- Gin Sour
  ('e0000000-0000-0000-0000-000000000902', 'C94', 'b0000000-0000-0000-0000-000000000401');
insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad) values
  ('e0000000-0000-0000-0000-000000000901', 1, 'b0000000-0000-0000-0000-000000000002', 100, 'g'),   -- $400
  ('e0000000-0000-0000-0000-000000000902', 1, 'b0000000-0000-0000-0000-000000000002', 50, 'g'),    -- $200
  ('e0000000-0000-0000-0000-000000000902', 2, 'b0000000-0000-0000-0000-000000000006', 2, 'g');     -- cardamomo sin costo
insert into public.precios_venta (generico_id, precio_con_impuesto, vigente_desde) values
  ('b0000000-0000-0000-0000-000000000007', 10800, privado.hoy()),
  ('b0000000-0000-0000-0000-000000000401', 18000, privado.hoy());

select pg_temp.como('a0000000-0000-0000-0000-000000000001');  -- admin
create temp table cm as select * from public.carta_margen('BAR');
select is((select array[costo, precio, precio_neto, pct_costo, margen, margen_pct] from cm where nombre = 'Gin Sour'),
          array[400, 10800, 10000, 4.0, 9600, 96.0]::numeric[], 'Gin Sour: $400 contra $10.000 netos');
select is((select estado_ficha || ' ' || semaforo || ' ' || meta_pct from cm where nombre = 'Gin Sour'), 'COMPLETA VERDE 24',
          'ficha completa, sin sección: meta general del bar');
select is((select jsonb_array_length(ingredientes) from cm where nombre = 'Gin Sour'), 1, 'trae sus ingredientes');
select is((select ingredientes -> 0 ->> 'nombre' from cm where nombre = 'Gin Sour'), 'Azúcar blanca', 'con el nombre del insumo');
select is((select estado_ficha || ' ' || lineas_con_costo || '/' || lineas from cm where nombre = 'Mocktail de prueba'), 'PARCIAL 1/2',
          'una línea sin costo: ficha parcial');
select ok((select pct_costo is null and semaforo is null and seccion = 'MOCKTAIL' and meta_pct = 22 from cm where nombre = 'Mocktail de prueba'),
          'parcial: sin %, con la meta de su sección');
select is((select estado_ficha from cm where nombre = 'Cóctel sin ficha'), 'SIN_FICHA', 'sin ficha');
select ok(not exists (select 1 from cm where nombre = 'Cóctel del baúl'), 'lo del baúl no sale');

-- impoconsumo configurable
insert into public.parametros (clave, valor) values ('IMPOCONSUMO_PCT', '0');
select is((select precio_neto from public.carta_margen('BAR') where nombre = 'Gin Sour'), 10800.00, 'si cambia el impoconsumo, cambia el neto');

-- ---------------------------------------------------------------- solo administración
select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
select throws_like($$ select * from public.carta_margen('BAR') $$, '%Sin permiso%', 'el jefe de barra no ve la carta con costos');
select throws_like($$ select public.fijar_precio('b0000000-0000-0000-0000-000000000007', 11000) $$, '%Sin permiso%', 'ni fija precios');
select pg_temp.como('a0000000-0000-0000-0000-000000000005');  -- chef
select throws_like($$ select * from public.carta_costos('COCINA') $$, '%Sin permiso%', 'el chef tampoco, ni en su área');
set local role authenticated;
select is((select count(*) from public.metas_costo), 0::bigint, 'ni lee las metas');
reset role;

select * from finish();
rollback;
