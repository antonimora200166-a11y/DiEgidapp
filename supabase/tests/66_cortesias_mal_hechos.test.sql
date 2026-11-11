-- Cortesías y mal hechos: «2 Gin Sour» descarga la ficha del kardex, guarda quién autorizó y quién
-- responde por el costo, entra a las pérdidas por su causa, y el cobro lo maneja administración.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);
\ir fixtures.inc

-- Gin Sour: 50 ml de ginebra + 100 g de azúcar + agua · en la barra: 700 ml a $200 y 5.000 g a $4
insert into public.fichas (id, codigo, generico_id) values ('e0000000-0000-0000-0000-000000000661', 'C99', 'b0000000-0000-0000-0000-000000000007');
insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad) values
  ('e0000000-0000-0000-0000-000000000661', 1, 'b0000000-0000-0000-0000-000000000001', 50, 'ml'),
  ('e0000000-0000-0000-0000-000000000661', 2, 'b0000000-0000-0000-0000-000000000002', 100, 'g'),
  ('e0000000-0000-0000-0000-000000000661', 3, 'b0000000-0000-0000-0000-000000000005', 30, 'ml');
select privado.registrar_movimiento('SALDO_INICIAL', 'c0000000-0000-0000-0000-000000000001', 'BAR_BARRA', 700, privado.hoy() - 5, 200, 'CONTEO');
select privado.registrar_movimiento('SALDO_INICIAL', 'c0000000-0000-0000-0000-000000000002', 'BAR_BARRA', 5000, privado.hoy() - 5, 4, 'CONTEO');

create function pg_temp.baja(extra jsonb) returns jsonb language sql as $$
  select public.registrar_baja_carta(jsonb_build_object('area', 'BAR', 'ubicacion', 'BAR_BARRA', 'fecha', privado.hoy(),
           'generico_id', 'b0000000-0000-0000-0000-000000000007', 'unidades', 2) || extra) $$;

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar registra
-- ---------------------------------------------------------------- validaciones
select ok((select pg_temp.baja('{"tipo":"CORTESIA"}') -> 'fatales' ? 'F1 · Una cortesía necesita quién la autorizó.'), 'la cortesía pide quién autorizó');
select ok((select pg_temp.baja('{"tipo":"CORTESIA","autorizado_por":"a0000000-0000-0000-0000-000000000003"}') -> 'fatales'
               ? 'F1 · Quien autoriza tiene que ser administración o jefe de área.'), 'un auxiliar no autoriza cortesías');
select ok((select pg_temp.baja('{"tipo":"MAL_HECHO"}') -> 'fatales' ? 'F1 · Un mal hecho necesita el responsable.'), 'el mal hecho pide el responsable');
select ok((select pg_temp.baja('{"tipo":"CORTESIA","autorizado_por":"a0000000-0000-0000-0000-000000000002","a_cargo":true}') -> 'fatales'
               ? 'F1 · Para dejar el costo a cargo de alguien escoge el responsable.'), 'a cargo de alguien pide quién');
select is((select public.registrar_baja(jsonb_build_object('area', 'BAR', 'ubicacion', 'BAR_BARRA', 'fecha', privado.hoy(), 'causa', 'CORTESIA',
             'lineas', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 10)))) -> 'fatales' ->> 0),
          'F1 · Falta la causa de la baja.', 'la baja de insumos no acepta cortesías: van por producto de carta');

-- ---------------------------------------------------------------- mal hecho
create temp table r1 as select pg_temp.baja('{"tipo":"MAL_HECHO","responsable_id":"a0000000-0000-0000-0000-000000000003","observaciones":"quedó aguado"}') as v;
select ok((select (v ->> 'ok')::boolean and (v ->> 'lineas')::int = 2 from r1), 'guardado: descarga ginebra y azúcar (el agua no)');
select is((select v ->> 'costo_mp' from r1), null, 'el jefe no ve el costo');
select is((select array_agg(cantidad order by producto_id) from public.existencias where ubicacion = 'BAR_BARRA'),
          array[600, 4800]::numeric[], 'el kardex bajó 100 ml de ginebra y 200 g de azúcar');
select is((select causa || ' · ' || observaciones from public.bajas where id = (select (v ->> 'id')::uuid from r1)),
          'MAL_HECHO · 2 × Gin Sour · quedó aguado', 'la baja dice qué fue');
select is((select array[unidades, ficha_version::numeric] from public.bajas_carta where baja_id = (select (v ->> 'id')::uuid from r1)),
          array[2, 1]::numeric[], 'guarda las unidades y la versión de la ficha');

-- ---------------------------------------------------------------- cortesía con forzado
select ok((select pg_temp.baja('{"tipo":"CORTESIA","autorizado_por":"a0000000-0000-0000-0000-000000000002","unidades":20}') -> 'bloqueos' ->> 0
               like 'B3 · Ginebra Tanqueray: el kardex tiene 600%'), 'si no alcanza en la zona, bloquea');
create temp table r2 as select pg_temp.baja('{"tipo":"CORTESIA","autorizado_por":"a0000000-0000-0000-0000-000000000002","unidades":1,
  "observaciones":"mesa 4, cumpleaños"}') as v;
select ok((select (v ->> 'ok')::boolean from r2), 'cortesía autorizada por el jefe');
select is((select a_cargo::text || ' ' || estado_cobro from public.bajas_carta where baja_id = (select (v ->> 'id')::uuid from r2)),
          'false NO_APLICA', 'la cortesía queda a cargo de la casa');

select is((select count(*)::int from public.bajas_carta_lista('BAR') where costo_mp is null), 2, 'el jefe ve la lista, sin pesos');
select throws_like($$ select public.cobro_baja_carta(jsonb_build_object('baja_id', (select v ->> 'id' from r1), 'estado', 'DESCONTADO')) $$,
                   '%Sin permiso%', 'el jefe no maneja cobros');

-- ---------------------------------------------------------------- administración
select pg_temp.como('a0000000-0000-0000-0000-000000000001');
select is((select array[costo_mp, (costo_estimado)::int] from public.bajas_carta_lista('BAR') where codigo = (select v ->> 'codigo' from r1)),
          array[20800, 0]::numeric[], 'costo a cargo: 100 ml × $200 + 200 g × $4, al promedio del kardex');
select is((select responsable || ' · ' || estado_cobro from public.bajas_carta_lista('BAR') where codigo = (select v ->> 'codigo' from r1)),
          'Aux Bar Prueba · PENDIENTE', 'pendiente de cobro al responsable');
select is((select (c ->> 'valor')::numeric from jsonb_array_elements(public.consulta_perdidas('BAR', privado.hoy() - 10, privado.hoy()) -> 'por_causa') c
            where c ->> 'causa' = 'MAL_HECHO'), 20800::numeric, 'entra a las pérdidas del período por su causa');
select is((select public.cobro_baja_carta(jsonb_build_object('baja_id', (select v ->> 'id' from r1), 'estado', 'CONDONADO')) ->> 'error'),
          'Escribe por qué se condona.', 'condonar pide el motivo');
select ok((select (public.cobro_baja_carta(jsonb_build_object('baja_id', (select v ->> 'id' from r1), 'estado', 'DESCONTADO', 'nota', 'nómina 15/11')) ->> 'ok')::boolean),
          'descontado de nómina');
select is((select public.cobro_baja_carta(jsonb_build_object('baja_id', (select v ->> 'id' from r2), 'estado', 'DESCONTADO')) ->> 'error'),
          'Este registro no quedó a cargo de nadie.', 'la cortesía de la casa no se cobra');
select throws_like($$ update public.bajas_carta set costo_mp = 1 $$, '%no se edita%', 'el costo guardado no se cambia');

select * from finish();
rollback;
