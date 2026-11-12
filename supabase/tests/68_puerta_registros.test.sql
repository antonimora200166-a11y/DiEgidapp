-- Puerta única de registros: envío único, cantidades fuera de lo normal, contenido sin verificar,
-- PIN para autorizar y anular, parámetros vigilados y funciones cerradas al acceso directo.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);
\ir fixtures.inc

create or replace function pg_temp.baja(p_clave uuid, p_cant numeric, p_extra jsonb default '{}') returns jsonb language sql as $$
  select public.enviar(p_clave, 'registrar_baja', jsonb_build_object('area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', privado.hoy()::text,
    'causa', 'DERRAME', 'lineas', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', p_cant))) || p_extra)
$$;
create or replace function pg_temp.rec(p_doc text, p_prod text, p_cant numeric, p_valor numeric, p_extra jsonb default '{}') returns jsonb language sql as $$
  select public.enviar(gen_random_uuid(), 'registrar_recepcion', jsonb_build_object('area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', privado.hoy()::text,
    'proveedor_id', 'd0000000-0000-0000-0000-000000000001', 'tipo_soporte', 'FACTURA', 'documento', p_doc,
    'recibe_id', 'a0000000-0000-0000-0000-000000000003',
    'lineas', jsonb_build_array(jsonb_build_object('producto_id', p_prod, 'cantidad_recibida', p_cant, 'valor_total', p_valor, 'sello', 'SI'))) || p_extra)
$$;

-- azúcar: tres compras de 5.000 g (lo habitual) y su contenido ya verificado
select privado.registrar_movimiento('ENTRADA_COMPRA', 'c0000000-0000-0000-0000-000000000002', 'BAR_BODEGA', 5000, privado.hoy() - 9, 4, 'RECEPCION', null);
select privado.registrar_movimiento('ENTRADA_COMPRA', 'c0000000-0000-0000-0000-000000000002', 'BAR_BODEGA', 5000, privado.hoy() - 6, 4, 'RECEPCION', null);
select privado.registrar_movimiento('ENTRADA_COMPRA', 'c0000000-0000-0000-0000-000000000002', 'BAR_BODEGA', 5000, privado.hoy() - 3, 4, 'RECEPCION', null);
update public.productos set contenido_verificado_en = now() where id = 'c0000000-0000-0000-0000-000000000002';

-- ================================================================ envío único
select pg_temp.como('a0000000-0000-0000-0000-000000000003');
select is((pg_temp.baja('e0000000-0000-0000-0000-000000000001', 100) ->> 'ok')::boolean, true, 'la baja entra por la puerta');
select is((pg_temp.baja('e0000000-0000-0000-0000-000000000001', 100) ->> 'repetido')::boolean, true, 'el segundo toque con la misma clave devuelve el primero');
select is((select count(*) from public.bajas), 1::bigint, 'y no registra otra baja');
select is((pg_temp.baja('e0000000-0000-0000-0000-000000000002', 100, '{"causa": "OTRO"}') ->> 'ok')::boolean, false, 'una baja rechazada (OTRO sin observación)');
select is((pg_temp.baja('e0000000-0000-0000-0000-000000000002', 100) ->> 'ok')::boolean, true, 'corregida, se reenvía con la misma clave');

-- ================================================================ cantidades fuera de lo normal
create temp table r1 as select pg_temp.rec('FV-900', 'c0000000-0000-0000-0000-000000000002', 20, 200000) as r;
select is((select (r ->> 'ok')::boolean from r1), false, '20 bolsas (50.000 g) cuando lo habitual es 5.000: no se guarda');
select is((select r -> 'revisar' -> 0 ->> 'motivo' from r1), 'CANTIDAD', 'pide revisar la cantidad');
select ok((select r -> 'revisar' -> 0 ->> 'mensaje' from r1) like '%50.000 g es más de 3 veces lo habitual (hasta 5.000 g)%', 'y dice cuánto es lo habitual');
select is((select count(*) from public.recepciones where documento = 'FV-900'), 0::bigint, 'nada quedó escrito');
select is((pg_temp.rec('FV-900', 'c0000000-0000-0000-0000-000000000002', 20, 200000,
            '{"confirmados": ["c0000000-0000-0000-0000-000000000002"]}') ->> 'ok')::boolean, true, 'confirmada, se guarda');
select is((select count(*) from public.bitacora where accion = 'CONFIRMÓ CANTIDAD O CONTENIDO'), 1::bigint, 'la confirmación queda en la bitácora');
select is((pg_temp.rec('FV-901', 'c0000000-0000-0000-0000-000000000002', 2, 20000) ->> 'ok')::boolean, true, 'una cantidad normal no pregunta nada');

-- ================================================================ contenido sin verificar
create temp table r2 as select pg_temp.rec('FV-902', 'c0000000-0000-0000-0000-000000000001', 2, 196000) as r;
select is((select r -> 'revisar' -> 0 ->> 'motivo' from r2), 'CONTENIDO', 'la ginebra (700 ml) sin verificar pide confirmar el contenido');
select is((pg_temp.rec('FV-902', 'c0000000-0000-0000-0000-000000000001', 2, 196000,
            '{"confirmados": ["c0000000-0000-0000-0000-000000000001"]}') ->> 'ok')::boolean, true, 'el auxiliar confirma y se guarda');
select is((select contenido_verificado_en from public.productos where id = 'c0000000-0000-0000-0000-000000000001'), null, 'pero no queda verificado: no le toca');
select pg_temp.como('a0000000-0000-0000-0000-000000000002');
select is((public.verificar_contenido('c0000000-0000-0000-0000-000000000001') ->> 'ok')::boolean, true, 'el jefe de bar lo verifica');
update public.productos set contenido_base = 750 where id = 'c0000000-0000-0000-0000-000000000001';
select is((select contenido_verificado_en from public.productos where id = 'c0000000-0000-0000-0000-000000000001'), null, 'si cambia el contenido, la verificación se pierde');

-- ================================================================ PIN
insert into public.parametros (clave, valor) values ('EXIGIR_PIN', 'SI');
select is((public.fijar_pin('1234') ->> 'ok')::boolean, false, 'un PIN seguido no sirve');
select is((public.fijar_pin('4817') ->> 'ok')::boolean, true, 'el jefe fija su PIN');
create temp table b as select id from public.bajas limit 1;
select is((public.enviar(gen_random_uuid(), 'anular_documento', jsonb_build_object('tipo', 'BAJA', 'id', (select id from b), 'motivo', 'Era otra botella, no hubo derrame', 'pin', '0000')) ->> 'ok')::boolean,
          false, 'con el PIN equivocado no anula');
select is((public.enviar(gen_random_uuid(), 'anular_documento', jsonb_build_object('tipo', 'BAJA', 'id', (select id from b), 'motivo', 'Era otra botella, no hubo derrame', 'pin', '4817')) ->> 'ok')::boolean,
          true, 'con su PIN, anula');

-- ================================================================ parámetros vigilados y acceso directo
select ok(exists (select 1 from public.alertas where regla = 'CONTROL_CAMBIADO' and detalle like 'NO → SI%'), 'cambiar EXIGIR_PIN abre una alerta');
select is(has_function_privilege('authenticated', 'public.registrar_baja(jsonb)', 'execute'), false, 'la app ya no llama registrar_baja directo');
select is(has_function_privilege('authenticated', 'public.enviar(uuid, text, jsonb)', 'execute'), true, 'solo por la puerta');

select * from finish();
rollback;
