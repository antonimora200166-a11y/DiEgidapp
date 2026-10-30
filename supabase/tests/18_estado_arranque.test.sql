-- ¿Listo para arrancar? (public.estado_arranque): cada punto cambia de estado cuando se resuelve.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
\ir fixtures.inc

create or replace function pg_temp.punto(p_clave text) returns jsonb language sql as $$
  select x from jsonb_array_elements(public.estado_arranque('BAR')) x where x ->> 'clave' = p_clave
$$;

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar

select is(pg_temp.punto('usuarios') ->> 'estado', 'ok', 'usuarios: hay jefe y auxiliar de bar (servicio no cuenta)');
select is(pg_temp.punto('conteo_inicial') ->> 'estado', 'falta', 'sin conteo inicial en ninguna zona: falta');
select is(pg_temp.punto('conteo_inicial') -> 'ejemplos', '["Barra", "Bodega de bar"]'::jsonb, 'y dice qué zonas faltan');
select is(pg_temp.punto('sin_costo') ->> 'valor', '4 insumo(s)', 'los 4 insumos comprados no tienen costo de partida');
insert into public.costos_referencia (producto_id, costo_unitario_base, fuente) values
  ('c0000000-0000-0000-0000-000000000002', 5.26, 'prueba');
select is(pg_temp.punto('sin_costo') ->> 'valor', '3 insumo(s)', 'con costo de referencia deja de contar');
select is(pg_temp.punto('taras') ->> 'estado', 'ok', 'sin botellas pendientes de pesar');
insert into public.taras (producto_id) values ('c0000000-0000-0000-0000-000000000001');
select is(pg_temp.punto('taras') -> 'ejemplos', '["Ginebra Tanqueray"]'::jsonb, 'una botella sin tara aparece (sin repetir la marca que ya está en el nombre)');

-- ficha con una línea sin cantidad
insert into public.fichas (id, codigo, generico_id, neto_esperado) values
  ('e0000000-0000-0000-0000-000000000005', '#5', 'b0000000-0000-0000-0000-000000000004', 3800);
insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad) values
  ('e0000000-0000-0000-0000-000000000005', 1, 'b0000000-0000-0000-0000-000000000002', 2000, 'g'),
  ('e0000000-0000-0000-0000-000000000005', 2, 'b0000000-0000-0000-0000-000000000006', null, 'g');
select is(pg_temp.punto('fichas') ->> 'valor', '1 ficha(s) incompletas · 1 MPI sin ficha', 'ficha incompleta y MPI sin ficha');
select is(pg_temp.punto('fichas') -> 'ejemplos', '["#5 Sirope Simple"]'::jsonb, 'nombra la ficha incompleta');

-- conteo inicial de la bodega con el azúcar
select public.registrar_conteo(jsonb_build_object('ubicacion', 'BAR_BODEGA', 'fecha', privado.hoy()::text,
  'responsable_id', 'a0000000-0000-0000-0000-000000000002', 'inicial', true,
  'lineas', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 5000))));
select is(pg_temp.punto('conteo_inicial') ->> 'estado', 'aviso', 'con una de dos zonas contada: aviso');
select is(pg_temp.punto('conteo_inicial') ->> 'valor', '1 de 2 zona(s) · 1 de 6 productos con kardex', 'cuenta zonas y productos con kardex');
select is(pg_temp.punto('proveedores') ->> 'estado', 'ok', 'hay proveedores');

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar
select throws_like($$ select public.estado_arranque('BAR') $$, '%Solo administración o el jefe%', 'el aux no lo ve');
select pg_temp.como('a0000000-0000-0000-0000-000000000005');  -- chef
select throws_like($$ select public.estado_arranque('BAR') $$, '%Solo administración o el jefe%', 'el chef no ve el de bar');

select * from finish();
rollback;
