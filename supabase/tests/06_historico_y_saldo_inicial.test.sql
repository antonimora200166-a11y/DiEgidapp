-- Histórico de bar migrado (supabase/datos/historico_bar.sql) y conteo inicial que abre el kardex.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

\ir ../datos/historico_bar.sql

-- ---------------------------------------------------------------- integridad del histórico
select is((select count(*) from public.genericos where tipo = 'BEBIDA'), 50::bigint, '50 cócteles de la carta');
select is((select count(*) from public.fichas f join public.genericos g on g.id = f.generico_id where g.tipo = 'MPI'),
          49::bigint, '49 fichas de MPI');
select is((select count(*) from public.genericos where tipo = 'MPI'), 82::bigint,
          '82 MPI: 72 del catálogo + 10 del inventario (decisión 22/10/2026)');
select is((select nombre from public.genericos where codigo = 'BAR_MPi_0004'), 'Zumo de Mandarina',
          'los códigos del catálogo de costos se conservan');
select is((select codigo from public.genericos where nombre = 'Porcionado de pulpa de lulo'), 'BAR_MPi_0073',
          'los MPI nuevos siguen la numeración después del último del catálogo');
select is((select g.codigo from public.ficha_lineas l join public.fichas f on f.id = l.ficha_id
            join public.genericos g on g.id = l.generico_id where f.codigo = '#44' and l.linea = 2),
          'BAR_MPe_0112', '«vino blanco» de la ficha #44 es Rosaleda Sauvignon Blanc');
select is((select g.codigo from public.alias a join public.genericos g on g.id = a.generico_id
            where a.fuente = 'FICHA' and a.alias_norm = 'vino blanco'), 'BAR_MPe_0112',
          'el alias de ficha «vino blanco» apunta a Rosaleda Sauvignon Blanc');
select ok(not exists (select 1 from public.genericos g where g.tipo in ('MPe', 'MPI', 'SIN_COSTO')
                        and not exists (select 1 from public.productos p where p.generico_id = g.id)),
          'todo insumo inventariable tiene al menos un producto');
select ok(not exists (select 1 from public.productos where contenido_base is null and not contenido_variable),
          'todo producto tiene contenido o lo pide en cada recepción');
select is((select count(*) from public.proveedores), 8::bigint, '8 proveedores de la lista cerrada');
select is((select count(*) from public.ficha_lineas l join public.fichas f on f.id = l.ficha_id where f.codigo = 'C02'),
          3::bigint, 'el Negroni (C02) tiene sus 3 líneas');
select is((select cantidad from public.ficha_lineas l join public.fichas f on f.id = l.ficha_id
            where f.codigo = '#1' and l.linea = 1), 10000::numeric, 'ficha #1: 10 kg de limón en gramos');
select is((select neto_esperado from public.fichas where codigo = '#5'), null::numeric,
          'Sirope Simple: el neto en ml queda vacío hasta medir su densidad');
select ok((select nota from public.fichas where codigo = '#5') like '%4275 ml%', 'y la ficha guarda el neto original');

-- costos de referencia que salen de las compras
select is((select c.costo_unitario_base from public.costos_referencia c join public.productos p on p.id = c.producto_id
            where p.codigo = 'BAR_MPe_0079-700'), 212.842857::numeric,
          'Tanqueray: $744.950 / (5 × 700 ml)');
select is((select c.costo_unitario_base from public.costos_referencia c join public.productos p on p.id = c.producto_id
            where p.codigo = 'BAR_MPe_0005-PAQ2500'), 5.26::numeric, 'azúcar Manuelita: $13.150 / 2.500 g');
select is((select p.codigo from public.alias a join public.productos p on p.id = a.producto_id
            where a.fuente = 'RECEPCION' and a.alias_norm = privado.normalizar('Ginebra Tanqueray')),
          'BAR_MPe_0079-700', 'el nombre de factura apunta a su producto');
select is((select count(*) from public.movimientos), 0::bigint, 'la migración no escribe nada en el kardex');

-- idempotencia: cargarlo dos veces no duplica nada
create temp table antes as select (select count(*) from public.genericos) g, (select count(*) from public.productos) p,
                                  (select count(*) from public.ficha_lineas) l, (select count(*) from public.alias) a;
\ir ../datos/historico_bar.sql
select ok((select (g, p, l, a) = ((select count(*) from public.genericos), (select count(*) from public.productos),
                                  (select count(*) from public.ficha_lineas), (select count(*) from public.alias)) from antes),
          'volver a cargar el histórico no duplica registros');

-- ---------------------------------------------------------------- conteo inicial
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000002', 'jefe.bar@prueba.test'), ('a0000000-0000-0000-0000-000000000003', 'aux.bar@prueba.test');
insert into public.perfiles (id, nombre, rol, areas) values
  ('a0000000-0000-0000-0000-000000000002', 'Jefe Bar', 'jefe_bar', '{BAR}'),
  ('a0000000-0000-0000-0000-000000000003', 'Aux Bar', 'aux_bar', '{BAR}');

create or replace function pg_temp.como(p_usuario uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_usuario)::text, true)
$$;
create or replace function pg_temp.conteo_inicial() returns jsonb language sql as $$
  select public.registrar_conteo(jsonb_build_object(
    'ubicacion', 'BAR_BARRA', 'fecha', privado.hoy()::text, 'responsable_id', 'a0000000-0000-0000-0000-000000000002',
    'inicial', true, 'lineas', jsonb_build_array(
      -- 2 botellas cerradas + 1 abierta que pesa 900 g (tara 580 g, densidad 0,95)
      jsonb_build_object('producto_id', (select id from public.productos where codigo = 'BAR_MPe_0079-700'),
                         'unidades_compra', 2, 'peso_bruto_g', 900),
      -- Hendrick's 1.000 ml: nunca se compró en la recepción de bar
      jsonb_build_object('producto_id', (select id from public.productos where marca = 'Hendrick''s' and presentacion = 'Botella 1000 ml'),
                         'unidades_compra', 1))))
$$;

select pg_temp.como('a0000000-0000-0000-0000-000000000003');
select throws_like($$ select pg_temp.conteo_inicial() $$, '%conteo inicial lo registra%', 'el aux de bar no abre el kardex');

select pg_temp.como('a0000000-0000-0000-0000-000000000002');
create temp table ini as select pg_temp.conteo_inicial() as r;
select is((select (r ->> 'ok')::boolean from ini), true, 'el jefe de bar registra el conteo inicial');
select is((select cantidad from public.existencias e join public.productos p on p.id = e.producto_id
            where p.codigo = 'BAR_MPe_0079-700'), 1736.8421::numeric,
          'Tanqueray: 2 × 700 ml + (900 − 580) g / 0,95');
select is((select costo_promedio from public.costos_producto c join public.productos p on p.id = c.producto_id
            where p.codigo = 'BAR_MPe_0079-700'), 212.842857::numeric, 'el saldo inicial entra al costo de referencia');
select is((select (r ->> 'sin_costo')::int from ini), 1, 'avisa del producto sin costo de referencia');
select is((select r -> 'fatales' ->> 0 from (select pg_temp.conteo_inicial() as r) x) like 'F9 ·%', true,
          'F9: un segundo conteo inicial del mismo producto se rechaza');

-- la primera compra del producto sin costo fija su promedio
select public.registrar_recepcion(jsonb_build_object(
  'area', 'BAR', 'ubicacion', 'BAR_BARRA', 'fecha', privado.hoy()::text,
  'proveedor_id', (select id from public.proveedores where nombre = 'Dislicores'), 'documento', 'DL-90001',
  'recibe_id', 'a0000000-0000-0000-0000-000000000002',
  'lineas', jsonb_build_array(jsonb_build_object(
    'producto_id', (select id from public.productos where marca = 'Hendrick''s' and presentacion = 'Botella 1000 ml'),
    'cantidad_recibida', 1, 'valor_total', 300000, 'sello', 'SI'))));
select is((select costo_promedio from public.costos_producto c join public.productos p on p.id = c.producto_id
            where p.marca = 'Hendrick''s' and p.presentacion = 'Botella 1000 ml'), 300::numeric,
          'Hendrick''s: la primera compra ($300/ml) fija el promedio del saldo que entró sin valor');

select * from finish();
rollback;
