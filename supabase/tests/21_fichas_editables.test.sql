-- Fichas técnicas desde la app: crear, corregir en su lugar, versión nueva si ya costeó lotes,
-- conversión registrada desde la ficha y permisos.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);
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
select throws_like($$ select pg_temp.guardar(pg_temp.sirope()) $$, '%Solo el jefe%', 'el aux no corrige fichas');
select is((select count(*) from public.lista_fichas('BAR') where tipo = 'MPI'), 2::bigint, 'pero ve la lista de fichas');

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar

-- crear: el cardamomo en cucharadas no tiene conversión → aviso, la ficha queda incompleta
create temp table c1 as select pg_temp.guardar(pg_temp.sirope()) as v;
select is((select (v ->> 'ok')::boolean from c1), true, 'el jefe crea la ficha');
select ok((select v -> 'avisos' from c1)::text like '%cda no tiene conversión%', 'avisa la cucharada sin conversión');
select is((select (l.faltan, l.version) from public.lista_fichas('BAR') l where l.codigo = '#5'), (1, 1),
          'la lista la muestra con 1 línea por completar, versión 1');

-- corregir en su lugar (sin lotes): la cucharada ahora trae su equivalencia
create temp table c2 as select pg_temp.guardar(pg_temp.sirope('{"cantidad": 1, "unidad": "cda", "factor": 6}')) as v;
select is((select (v ->> 'id')::uuid from c2), (select (v ->> 'id')::uuid from c1), 'sin lotes se corrige la misma ficha');
select is((select factor_a_base from public.conversiones where generico_id = 'b0000000-0000-0000-0000-000000000006' and unidad = 'cda'),
          6::numeric, 'y queda la conversión 1 cda = 6 g');
select is((select faltan from public.lista_fichas('BAR') where codigo = '#5'), 0, 'la ficha queda completa');
select is((select count(*) from public.ficha_lineas where ficha_id = (select (v ->> 'id')::uuid from c1)), 3::bigint, 'con sus 3 líneas, sin duplicar');
select is((select jsonb_array_length(public.ficha_para_editar('b0000000-0000-0000-0000-000000000004') -> 'lineas')), 3, 'ficha_para_editar trae las líneas');
select is((public.ficha_para_editar('b0000000-0000-0000-0000-000000000004') -> 'lineas' -> 2 ->> 'factor')::numeric, 6::numeric,
          'con el factor de cada una');

-- un lote la usa → la próxima corrección crea versión 2 y la 1 sigue para ese lote
insert into public.lotes_produccion (codigo, area, ubicacion, fecha, producto_id, ficha_id, responsable_id, entrada_base, neto_base,
                                     costo_total, estado_costo)
values ('PRO-PRUEBA', 'BAR', 'BAR_BODEGA', privado.hoy(), 'c0000000-0000-0000-0000-000000000004', (select (v ->> 'id')::uuid from c1),
        'a0000000-0000-0000-0000-000000000002', 4006, 3800, 0, 'PARCIAL');
create temp table c3 as select pg_temp.guardar(pg_temp.sirope('{"cantidad": 2, "unidad": "cda"}') || '{"nota": "Más cardamomo"}') as v;
select isnt((select (v ->> 'id')::uuid from c3), (select (v ->> 'id')::uuid from c1), 'con lotes nace otra ficha');
select is((select version from public.fichas where id = (select (v ->> 'id')::uuid from c3)), 2, 'versión 2');
select is((select version from public.lista_fichas('BAR') where codigo = '#5'), 2, 'la vigente es la 2');
select is((select cantidad from public.ficha_lineas where ficha_id = (select (v ->> 'id')::uuid from c1) and linea = 3), 1::numeric,
          'la versión 1 conserva la receta del lote');
select ok((select v -> 'avisos' from c3)::text like '%ya costeó 1 lote%', 'y lo explica');

-- reglas
select ok((pg_temp.guardar(pg_temp.sirope() || '{"codigo": ""}') -> 'fatales' ->> 0) like 'Falta el código%', 'el código es obligatorio');
select ok((pg_temp.guardar(jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000004', 'codigo', '#5',
            'lineas', jsonb_build_array(jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000007', 'cantidad', 1)))) -> 'fatales' ->> 0)
          like '%un plato o cóctel no es ingrediente%', 'un cóctel no va dentro de una ficha');
select throws_like($$ select pg_temp.guardar(jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000002', 'codigo', 'X')) $$,
                   '%Solo los MPI, cócteles y platos%', 'un insumo comprado no tiene ficha');

select * from finish();
rollback;
