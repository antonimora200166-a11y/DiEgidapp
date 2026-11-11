-- Bandeja de alertas: las reglas encuentran los problemas con su impacto en pesos, una alerta
-- abierta no se duplica, se asigna, se comenta, se resuelve con causa, deja historial y el
-- responsable la ve sin pesos.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);
\ir fixtures.inc

insert into public.parametros (clave, valor) values ('ALERTA_FALTANTE_MIN', '1000');
-- carta: Gin Sour (100 g de azúcar), un mocktail caro (500 g = $2.000 contra $5.000 netos = 40 %) y un plato sin ficha
insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base) values
  ('b0000000-0000-0000-0000-000000000621', 'BAR_BEB_9621', 'Mocktail caro', 'BEBIDA', 'COCTEL', 'BAR', 'und'),
  ('b0000000-0000-0000-0000-000000000622', 'BAR_BEB_9622', 'Bebida sin ficha', 'BEBIDA', 'COCTEL', 'BAR', 'und');
insert into public.fichas (id, codigo, generico_id) values
  ('e0000000-0000-0000-0000-000000000621', 'C99', 'b0000000-0000-0000-0000-000000000007'),
  ('e0000000-0000-0000-0000-000000000622', 'C98', 'b0000000-0000-0000-0000-000000000621');
insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad) values
  ('e0000000-0000-0000-0000-000000000621', 1, 'b0000000-0000-0000-0000-000000000002', 100, 'g'),
  ('e0000000-0000-0000-0000-000000000622', 1, 'b0000000-0000-0000-0000-000000000002', 500, 'g');
insert into public.precios_venta (generico_id, precio_con_impuesto, vigente_desde) values
  ('b0000000-0000-0000-0000-000000000007', 10800, '2026-01-01'), ('b0000000-0000-0000-0000-000000000621', 5400, '2026-01-01'),
  ('b0000000-0000-0000-0000-000000000622', 10800, '2026-01-01');

-- kardex: 5.000 g a $4, compra de 2.500 g, conteo que encuentra 7.000 g de menos: real $28.000 contra teórico $18.000 (3,9 puntos, rojo)
select privado.registrar_movimiento('SALDO_INICIAL', 'c0000000-0000-0000-0000-000000000002', 'BAR_BODEGA', 5000, '2026-10-01', 4, 'CONTEO');
select privado.registrar_movimiento('ENTRADA_COMPRA', 'c0000000-0000-0000-0000-000000000002', 'BAR_BODEGA', 2500, '2026-10-10', 4, 'RECEPCION');
select privado.registrar_movimiento('AJUSTE_CONTEO_NEGATIVO', 'c0000000-0000-0000-0000-000000000002', 'BAR_BODEGA', 7000, '2026-10-15', null, 'CONTEO');
-- compras: el azúcar pasó de $4 a $5 por g (+25 %)
insert into public.compras_historicas (id, origen, id_origen, fecha, nombre_factura, generico_id, producto_id, cantidad_base, valor_total, computable) values
  (gen_random_uuid(), 'REC-BAR', 'A-1', '2026-09-20', 'Azúcar', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 1000, 4000, true),
  (gen_random_uuid(), 'REC-BAR', 'A-2', '2026-10-10', 'Azúcar', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 2500, 12500, true);
-- ventas: 20 Gin Sour ($200.000), 5 mocktails caros ($25.000), 3 sin ficha ($30.000)
insert into public.ventas_cargas (id, formato, archivo, huella, desde, hasta, por_dia, lineas, unidades, total_odoo)
values ('f0000000-0000-0000-0000-000000000621', 'TABLA_DINAMICA', 's.xlsx', 'h-al', '2026-10-09', '2026-10-15', true, 3, 28, 255000);
insert into public.ventas_lineas (carga_id, fecha, nombre_odoo, clave, cantidad, valor_neto) values
  ('f0000000-0000-0000-0000-000000000621', '2026-10-12', 'Gin Sour', 'GS', 20, 200000),
  ('f0000000-0000-0000-0000-000000000621', '2026-10-12', 'Mocktail caro', 'MC', 5, 25000),
  ('f0000000-0000-0000-0000-000000000621', '2026-10-12', 'Bebida sin ficha', 'BS', 3, 30000);
insert into public.equivalencias_odoo (clave, nombre_odoo, tipo) values ('GS', 'Gin Sour', 'PRODUCTO'), ('MC', 'Mocktail caro', 'PRODUCTO'), ('BS', 'Bebida sin ficha', 'PRODUCTO');
insert into public.equivalencia_partes (clave, generico_id) values ('GS', 'b0000000-0000-0000-0000-000000000007'),
  ('MC', 'b0000000-0000-0000-0000-000000000621'), ('BS', 'b0000000-0000-0000-0000-000000000622');

select pg_temp.como('a0000000-0000-0000-0000-000000000001');  -- admin
select ok((public.cerrar_periodo('{"area": "BAR", "desde": "2026-10-09", "hasta": "2026-10-15", "forzar": true, "motivo": "prueba"}') ->> 'ok')::boolean, 'cierra el período');
select ok(public.generar_alertas('2026-10-09', '2026-10-15') >= 5, 'la revisión encuentra las alertas');
create temp table a as select * from public.alertas_lista();

-- ---------------------------------------------------------------- reglas

select ok(exists (select 1 from a where regla = 'VARIACION_ROJA'), 'variación real vs. teórico en rojo');
select ok(exists (select 1 from a where regla = 'FALTANTE_INSUMO' and titulo like 'Azúcar blanca%'), 'faltante no explicado del azúcar');
select is((select impacto from a where regla = 'SOBRE_META'), 4000::numeric, 'mocktail sobre la meta: 5 × ($2.000 − 24 % de $5.000)');
select ok((select titulo from a where regla = 'SOBRE_META') like 'Mocktail caro: 40%', 'el título dice el % sin pesos');
select is((select impacto from a where regla = 'VENTAS_SIN_FICHA'), 7200::numeric, 'ventas sin ficha: $30.000 vendidos × meta de 24 % = costo sin controlar');
select is((select impacto from a where regla = 'SUBIDA_PRECIO'), 2500::numeric, 'subida del azúcar: ($5 − $4) × 2.500 g');
select ok((select titulo from a where regla = 'SUBIDA_PRECIO') like '%subió 25 %%', 'subió 25 %');
select is((select count(*) from a where titulo ~ '\$'), 0::bigint, 'ningún título lleva pesos');

-- una alerta abierta no se duplica al revisar otra vez
select public.generar_alertas('2026-10-09', '2026-10-15');
select is((select count(*) from public.alertas_lista() where regla = 'SOBRE_META'), 1::bigint, 'revisar otra vez no duplica');

-- ---------------------------------------------------------------- seguimiento
create temp table m as select id from a where regla = 'SOBRE_META';
select ok((public.alerta_accion(jsonb_build_object('id', (select id from m), 'accion', 'ASIGNAR',
  'responsable_id', 'a0000000-0000-0000-0000-000000000002', 'fecha', '2026-10-20')) ->> 'ok')::boolean, 'se asigna al jefe de barra con fecha');

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
select is((select count(*) from public.alertas_lista()), 1::bigint, 'el jefe ve solo la que tiene asignada');
select ok((select impacto is null from public.alertas_lista()), 'sin el impacto en pesos');
select ok((public.alerta_accion(jsonb_build_object('id', (select id from m), 'accion', 'COMENTAR', 'texto', 'Se está sirviendo de más')) ->> 'ok')::boolean, 'comenta');
select ok(not (public.alerta_accion(jsonb_build_object('id', (select id from m), 'accion', 'RESOLVER')) ->> 'ok')::boolean, 'para resolver hace falta la causa');
select ok((public.alerta_accion(jsonb_build_object('id', (select id from m), 'accion', 'RESOLVER', 'causa', 'Porción de 60 g en vez de 45 g')) ->> 'ok')::boolean,
          'resuelve con la causa encontrada');
select throws_like($$ select public.alerta_accion(jsonb_build_object('id', (select id from a where regla = 'SUBIDA_PRECIO'), 'accion', 'COMENTAR', 'texto', 'x')) $$,
                   '%Sin permiso%', 'no toca alertas que no son suyas');

select pg_temp.como('a0000000-0000-0000-0000-000000000001');
select is((select array_agg(accion order by en, accion) from public.alerta_eventos_lista((select id from m))),
          array['ASIGNADA', 'COMENTARIO', 'CREADA', 'RESUELTA'], 'historial completo de quién hizo qué');
select throws_like($$ update public.alerta_eventos set texto = 'otro' $$, '%', 'el historial no se edita');

select * from finish();
rollback;
