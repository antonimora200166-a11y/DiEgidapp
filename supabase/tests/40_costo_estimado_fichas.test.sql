-- Costo estimado de fichas sin kardex: referencia para MPe, receta/neto para MPI, kardex manda.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
\ir fixtures.inc

-- sirope simple (MPI, g): 1.000 g de azúcar + 1.000 ml de agua (sin costo) → rinde 1.800 g
insert into public.costos_referencia (producto_id, costo_unitario_base, fuente) values
  ('c0000000-0000-0000-0000-000000000002', 4, 'Mercado: prueba'),     -- azúcar $4/g
  ('c0000000-0000-0000-0000-000000000001', 200, 'Mercado: prueba');   -- ginebra $200/ml
insert into public.fichas (id, codigo, generico_id, neto_esperado) values
  ('e0000000-0000-0000-0000-000000000701', '#71', 'b0000000-0000-0000-0000-000000000004', 1800),
  ('e0000000-0000-0000-0000-000000000702', 'C71', 'b0000000-0000-0000-0000-000000000007', null);
insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad) values
  ('e0000000-0000-0000-0000-000000000701', 1, 'b0000000-0000-0000-0000-000000000002', 1000, 'g'),
  ('e0000000-0000-0000-0000-000000000701', 2, 'b0000000-0000-0000-0000-000000000005', 1000, 'ml'),
  -- gin sour: 60 ml de ginebra + 30 ml de sirope (el sirope va en g: necesita conversión)
  ('e0000000-0000-0000-0000-000000000702', 1, 'b0000000-0000-0000-0000-000000000001', 60, 'ml'),
  ('e0000000-0000-0000-0000-000000000702', 2, 'b0000000-0000-0000-0000-000000000004', 30, 'ml');

select is(round(privado.costo_estimado_generico('b0000000-0000-0000-0000-000000000004'), 4), 2.2222,
          'sin kardex, el sirope cuesta lo de su receta entre su neto ($4.000 / 1.800 g)');
select is(privado.costo_estimado_generico('b0000000-0000-0000-0000-000000000001'), 200::numeric, 'la ginebra usa su costo de referencia');
select ok(privado.costo_es_estimado('b0000000-0000-0000-0000-000000000001'), 'y se marca como estimado');

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
select ok((select falta like 'Falta la conversión ml→g%' from public.costo_ficha('e0000000-0000-0000-0000-000000000702') where linea = 2),
          'sin conversión ml→g del sirope, la línea dice qué falta');
insert into public.conversiones (generico_id, unidad, factor_a_base, estado) values ('b0000000-0000-0000-0000-000000000004', 'ml', 1.3, 'SUPUESTO');
select pg_temp.como('a0000000-0000-0000-0000-000000000001');  -- admin: los pesos solo los ve administración (08/11)
select is((select round(sum(costo), 2) from public.costo_ficha('e0000000-0000-0000-0000-000000000702')), 12086.67,
          'con la densidad, el cóctel cuesta 60 × 200 + 39 g × 2,22');
select pg_temp.como('a0000000-0000-0000-0000-000000000001');  -- admin: la carta con costos es solo de administración
select ok((select estimado from public.carta_costos('BAR') where nombre = 'Gin Sour'), 'la carta lo marca como estimado');

-- con kardex, manda el kardex
reset role;
select privado.registrar_movimiento('SALDO_INICIAL', 'c0000000-0000-0000-0000-000000000001', 'BAR_BODEGA', 700, privado.hoy(), 150, 'CONTEO');
select is(privado.costo_estimado_generico('b0000000-0000-0000-0000-000000000001'), 150::numeric, 'con kardex, el costo es el del kardex');
select ok(not privado.costo_es_estimado('b0000000-0000-0000-0000-000000000001'), 'y ya no es estimado');

select * from finish();
rollback;
