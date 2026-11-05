-- Fichas técnicas desde la app: crear, cada cambio es versión nueva (también sin lotes), guardar
-- sin cambios no crea versión, conversión registrada desde la ficha y permisos.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);
\ir fixtures.inc

create or replace function pg_temp.guardar(p jsonb) returns jsonb language sql as $$ select public.guardar_ficha(p) $$;
-- Sirope Simple (b…04): 2.000 g de azúcar + 2.000 ml de agua + 1 cda de cardamomo → 3.800 g
create or replace function pg_temp.sirope(p_cardamomo jsonb default '{"cantidad": 1, "unidad": "cda"}') returns jsonb language sql as $$
  select jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000004', 'codigo', '#5', 'neto_esperado', 3800,
    'lineas', jsonb_build_array(
      jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000002', 'cantidad', 2000, 'unidad', 'g'),
      jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000005', 'cantidad', 2000, 'unidad', 'ml'),
      jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000006') || p_cardamomo))
$$;

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar
select throws_like($$ select pg_temp.guardar(pg_temp.sirope()) $$, '%Solo el jefe de barra%', 'el aux no edita fichas');
select is((select count(*) from public.lista_fichas('BAR') where tipo = 'MPI'), 2::bigint, 'pero ve la lista de fichas');

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar

-- crear: el cardamomo en cucharadas no tiene conversión → aviso, la ficha queda incompleta
create temp table c1 as select pg_temp.guardar(pg_temp.sirope()) as v;
select is((select (v ->> 'ok')::boolean from c1), true, 'el jefe crea la ficha');
select ok((select v -> 'avisos' from c1)::text like '%cda no tiene conversión%', 'avisa la cucharada sin conversión');
select is((select (l.faltan, l.version) from public.lista_fichas('BAR') l where l.codigo = '#5'), (1, 1),
          'la lista la muestra con 1 línea por completar, versión 1');

-- cambiar sin decir qué cambió no se puede
select ok((pg_temp.guardar(pg_temp.sirope('{"cantidad": 1, "unidad": "cda", "factor": 6}')) -> 'fatales' ->> 0) like 'Escribe qué cambiaste%',
          'una versión nueva pide el motivo del cambio');

-- solo medir la cucharada no cambia la receta: no crea versión, pero registra la conversión
create temp table c15 as select pg_temp.guardar(pg_temp.sirope('{"cantidad": 1, "unidad": "cda", "factor": 6}') || '{"motivo_cambio": "medí"}') as v;
select is((select (v ->> 'id')::uuid from c15), (select (v ->> 'id')::uuid from c1), 'medir la unidad no cambia la receta');
-- corregir (aunque no haya lotes) crea la versión 2; la 1 queda intacta
create temp table c2 as select pg_temp.guardar(pg_temp.sirope('{"cantidad": 2, "unidad": "cda", "factor": 6}')
                                               || '{"motivo_cambio": "Más cardamomo, ya medido"}') as v;
select isnt((select (v ->> 'id')::uuid from c2), (select (v ->> 'id')::uuid from c1), 'cada cambio es una versión nueva');
select is((select version from public.fichas where id = (select (v ->> 'id')::uuid from c2)), 2, 'versión 2');
select is((select factor_a_base from public.conversiones where generico_id = 'b0000000-0000-0000-0000-000000000006' and unidad = 'cda'),
          6::numeric, 'y queda la conversión 1 cda = 6 g');
select is((select (faltan, version) from public.lista_fichas('BAR') where codigo = '#5'), (0, 2), 'la vigente es la 2, completa');
select is((select count(*) from public.lista_fichas('BAR') where codigo = '#5'), 1::bigint, 'y no sale dos veces aunque ambas nacieron hoy');
select is((select count(*) from public.ficha_lineas where ficha_id = (select (v ->> 'id')::uuid from c1)), 3::bigint, 'la 1 conserva sus 3 líneas');
select is((public.ficha_para_editar('b0000000-0000-0000-0000-000000000004') -> 'lineas' -> 2 ->> 'factor')::numeric, 6::numeric,
          'ficha_para_editar trae la vigente con el factor de cada línea');
select is(jsonb_array_length(public.ficha_para_editar('b0000000-0000-0000-0000-000000000004') -> 'versiones'), 2, 'y sus dos versiones');

-- guardar lo mismo no crea versión
create temp table c3 as select pg_temp.guardar(pg_temp.sirope('{"cantidad": 2, "unidad": "cda"}') || '{"motivo_cambio": "nada"}') as v;
select is((select (v ->> 'id')::uuid from c3), (select (v ->> 'id')::uuid from c2), 'sin cambios sigue la misma versión');
select ok((select v -> 'avisos' from c3)::text like '%No había cambios%', 'y lo dice');

-- una versión guardada no se toca
select throws_like($$ update public.fichas set nota = 'x' where version = 1 and generico_id = 'b0000000-0000-0000-0000-000000000004' $$,
                   '%no se modifica%', 'una versión no se modifica');

-- reglas
select ok((pg_temp.guardar(pg_temp.sirope() || '{"codigo": ""}') -> 'fatales' ->> 0) like 'Falta el código%', 'el código es obligatorio');
select ok((pg_temp.guardar(jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000004', 'codigo', '#5', 'motivo_cambio', 'x',
            'lineas', jsonb_build_array(jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000007', 'cantidad', 1)))) -> 'fatales' ->> 0)
          like '%un plato o cóctel no es ingrediente%', 'un cóctel no va dentro de una ficha');
select throws_like($$ select pg_temp.guardar(jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000002', 'codigo', 'X')) $$,
                   '%Solo los MPI, cócteles y platos%', 'un insumo comprado no tiene ficha');

select * from finish();
rollback;
