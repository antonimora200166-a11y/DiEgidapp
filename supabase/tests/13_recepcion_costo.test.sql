-- Recepción v2 (pantalla Recibir): costo promedio ponderado móvil que deja cada ENTRADA,
-- banda de precio alimentada por el histórico, cadena de frío, foto, alias y origen de la línea.
begin;
create extension if not exists pgtap with schema extensions;
select plan(52);
\ir fixtures.inc

-- crema de leche refrigerada (sin temperatura máxima propia: toma 4 °C del régimen)
insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base, conservacion) values
  ('b0000000-0000-0000-0000-000000000020', 'BAR_MPe_0200', 'Crema de leche', 'MPe', 'FRUVER', 'BAR', 'g', 'Refrigerado');
insert into public.productos (id, codigo, generico_id, marca, presentacion, unidad_compra, contenido_base) values
  ('c0000000-0000-0000-0000-000000000020', 'BAR_MPe_0200-1000', 'b0000000-0000-0000-0000-000000000020', 'Alpina', 'Caja 1.000 g', 'UND', 1000);

create or replace function pg_temp.rec(p_doc text, p_lineas jsonb, p_extra jsonb default '{}') returns jsonb
language sql as $$
  select public.registrar_recepcion(jsonb_build_object(
    'area', 'BAR', 'ubicacion', 'BAR_BODEGA', 'fecha', (privado.hoy() - 1)::text,
    'proveedor_id', 'd0000000-0000-0000-0000-000000000002', 'tipo_soporte', 'FACTURA', 'documento', p_doc,
    'recibe_id', 'a0000000-0000-0000-0000-000000000003', 'lineas', p_lineas) || p_extra)
$$;
create or replace function pg_temp.linea(p_prod text, p_cant numeric, p_valor numeric, p_extra jsonb default '{}') returns jsonb
language sql as $$
  select jsonb_build_array(jsonb_build_object('producto_id', p_prod, 'cantidad_recibida', p_cant, 'valor_total', p_valor) || p_extra)
$$;
create or replace function pg_temp.tiene(p_lista jsonb, p_patron text) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements_text(p_lista) x where x like p_patron)
$$;
create or replace function pg_temp.promedio(p_prod text) returns numeric language sql as $$
  select costo_promedio from public.costos_producto where producto_id = p_prod::uuid
$$;
create or replace function pg_temp.saldo(p_prod text) returns numeric language sql as $$
  select cantidad from public.costos_producto where producto_id = p_prod::uuid
$$;

-- ================================================================ banda de precio (función pura)
select is(privado.evaluar_precio(500, 10, 5, null, 'Licores', 'ml') ->> 'nivel', 'bloquea',
  'capa 1: $500/ml contra una mediana de categoría de $10 (banda 0,5 a 200) bloquea');
select ok(privado.evaluar_precio(500, 10, 5, null, 'Licores', 'ml') ->> 'texto' like '%50× la mediana%',
  'el mensaje dice cuántas veces la mediana');
select is(privado.evaluar_precio(500, 10, 2, null, 'Licores', 'ml') ->> 'nivel', 'ok',
  'con menos de 3 datos la banda se ensancha ×3 (hasta 600)');
select is(privado.evaluar_precio(10.4, 10, 5, 10, 'Licores', 'ml') ->> 'nivel', 'ok', 'capa 2: 4 % de desvío no dice nada');
select is(privado.evaluar_precio(12, 10, 5, 10, 'Licores', 'ml') ->> 'nivel', 'aviso', 'capa 2: 20 % de desvío avisa');
select is(privado.evaluar_precio(17, 10, 5, 10, 'Licores', 'ml') ->> 'nivel', 'bloquea', 'capa 2: 70 % de desvío bloquea');
select ok(privado.evaluar_precio(31, 10, 5, 10, 'Licores', 'ml') ->> 'texto' like 'precio 3.1× su mediana%',
  'capa 2: 3,1× la mediana del producto es atípico');
select is(privado.evaluar_precio(3, 10, 5, 10, 'Licores', 'ml') ->> 'nivel', 'bloquea', 'capa 2: un tercio de la mediana también');
select is(privado.evaluar_precio(5, null, 0, null, 'Licores', 'ml') ->> 'nivel', 'ok', 'sin historia no hay banda');
select is(privado.temp_max('Refrigerado', null), 4::numeric, 'refrigerado sin máximo propio: 4 °C');
select is(privado.temp_max('Congelado', null), -12::numeric, 'congelado sin máximo propio: −12 °C');
select is(privado.temp_max('Refrigerado', 2), 2::numeric, 'el máximo del genérico manda');
select is(privado.temp_max('Ambiente', null), null::numeric, 'ambiente no tiene máximo');

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar

-- ================================================================ costo promedio ponderado móvil
-- 1.ª compra: 4 bolsas × 2.500 g por $52.600 → $5,26/g
create temp table r1 as select pg_temp.rec('FV-4001', pg_temp.linea('c0000000-0000-0000-0000-000000000002', 4, 52600)) as r;
select is((select (r ->> 'ok')::boolean from r1), true, '1.ª compra se guarda');
select is(pg_temp.promedio('c0000000-0000-0000-0000-000000000002'), 5.26::numeric, '1.ª compra: el promedio es su costo ($52.600 / 10.000 g)');
select is(pg_temp.saldo('c0000000-0000-0000-0000-000000000002'), 10000::numeric, 'entran 10.000 g');

-- 2.ª compra: 2 bolsas por $27.500 → $5,50/g; (10.000·5,26 + 5.000·5,50) / 15.000 = 5,34
create temp table r2 as select pg_temp.rec('FV-4002', pg_temp.linea('c0000000-0000-0000-0000-000000000002', 2, 27500)) as r;
select is(pg_temp.promedio('c0000000-0000-0000-0000-000000000002'), 5.34::numeric, '2.ª compra: promedio ponderado $5,34/g');
select is((select m.costo_unitario from public.movimientos m where m.documento_id = (select (r ->> 'id')::uuid from r2)),
          5.5::numeric, 'la ENTRADA_COMPRA lleva el costo de su factura');
select is((select m.tipo::text from public.movimientos m where m.documento_id = (select (r ->> 'id')::uuid from r2)),
          'ENTRADA_COMPRA', 'y es una ENTRADA_COMPRA');

-- 3.ª: pedidas 3, llegan 2 por $26.000 ($5,20/g) sin observación + un limón que no llegó
create temp table r3 as select pg_temp.rec('FV-4003',
  pg_temp.linea('c0000000-0000-0000-0000-000000000002', 2, 26000, '{"cantidad_pedida": 3}')
  || pg_temp.linea('c0000000-0000-0000-0000-000000000003', 0, null, '{"condicion": "NO_LLEGO", "cantidad_pedida": 5}')) as r;
select is((select (r ->> 'ok')::boolean from r3), true, 'la diferencia pedido-recibido no impide guardar');
select ok(pg_temp.tiene((select r -> 'avisos' from r3), 'Línea 1 (Azúcar blanca): diferencia de -1 frente a lo pedido sin observación.'),
          'avisa la diferencia de −1 frente a lo pedido');
select is(pg_temp.promedio('c0000000-0000-0000-0000-000000000002'), 5.305::numeric,
          '3.ª compra: (15.000·5,34 + 5.000·5,20) / 20.000 = 5,305');
select is((select count(*) from public.movimientos m where m.documento_id = (select (r ->> 'id')::uuid from r3)), 1::bigint,
          'lo que no llegó (cantidad 0) no mueve el kardex');
select ok((select 'H08' = any (l.hallazgos) from public.recepcion_lineas l where l.recepcion_id = (select (r ->> 'id')::uuid from r3) and l.linea = 1),
          'la diferencia sin observación queda marcada H08');

-- anular la 3.ª retira su costo del promedio: (20.000·5,305 − 5.000·5,20) / 15.000 = 5,34
select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
select public.anular_documento('RECEPCION', (select (r ->> 'id')::uuid from r3), 'Factura registrada en la zona equivocada');
select is(pg_temp.promedio('c0000000-0000-0000-0000-000000000002'), 5.34::numeric, 'anular la compra devuelve el promedio a $5,34');
select pg_temp.como('a0000000-0000-0000-0000-000000000003');

-- ================================================================ cantidad 0 (B4) con y sin BLOQUEA_COHERENCIA
select ok(pg_temp.tiene(pg_temp.rec('FV-4004', pg_temp.linea('c0000000-0000-0000-0000-000000000002', 0, null)) -> 'bloqueos', 'B4 ·%recibido 0 pero marcado OK%'),
          'B4: cantidad 0 marcada OK bloquea');
select ok(pg_temp.tiene(pg_temp.rec('FV-4005', pg_temp.linea('c0000000-0000-0000-0000-000000000002', 0, 13000, '{"condicion": "DANADO"}')) -> 'bloqueos', 'B4 ·%cantidad 0 con valor%'),
          'B4: cantidad 0 con valor bloquea');
insert into public.parametros (clave, valor) values ('BLOQUEA_COHERENCIA', 'NO');
select is((pg_temp.rec('FV-4006', pg_temp.linea('c0000000-0000-0000-0000-000000000002', 0, null)) ->> 'ok')::boolean, true,
          'BLOQUEA_COHERENCIA = NO: la cantidad 0 marcada OK se guarda (con su hallazgo)');

-- ================================================================ sello (B8)
select ok(pg_temp.tiene(pg_temp.rec('FV-4007', pg_temp.linea('c0000000-0000-0000-0000-000000000001', 1, 150000, '{"sello": "NO"}')) -> 'bloqueos', 'B8 ·%sello ROTO%'),
          'B8: sello roto bloquea');
select is((pg_temp.rec('FV-4008', pg_temp.linea('c0000000-0000-0000-0000-000000000001', 1, 150000, '{"sello": "SI"}')) ->> 'ok')::boolean, true,
          'sello intacto: la 1.ª compra de Tanqueray se guarda');

-- ================================================================ banda alimentada por el histórico (B7)
-- tres compras históricas de Tanqueray a ~$212/ml, y una no computable a $1.000/ml que no debe contar
insert into public.compras_historicas (id, origen, id_origen, fecha, nombre_factura, generico_id, producto_id,
                                       cantidad_base, valor_total, computable, motivo_exclusion) values
  (gen_random_uuid(), 'REC-BAR', 'H-1', privado.hoy() - 40, 'Ginebra Tanqueray', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 3500, 744950, true, null),
  (gen_random_uuid(), 'REC-BAR', 'H-2', privado.hoy() - 30, 'Ginebra Tanqueray', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 1400, 297000, true, null),
  (gen_random_uuid(), 'REC-BAR', 'H-3', privado.hoy() - 20, 'Ginebra Tanqueray', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 700, 149000, true, null),
  (gen_random_uuid(), 'REC-BAR', 'H-4', privado.hoy() - 10, 'Ginebra Tanqueray', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 700, 700000, false, 'Hallazgo H12');
create temp table r7 as select pg_temp.rec('FV-4009', pg_temp.linea('c0000000-0000-0000-0000-000000000001', 1, 700000, '{"sello": "SI"}')) as r;
select ok(pg_temp.tiene((select r -> 'bloqueos' from r7), 'B7 ·%× su mediana histórica%'),
          'B7: $1.000/ml frente a la mediana del histórico (~$213/ml) bloquea');
select is((pg_temp.rec('FV-4010', pg_temp.linea('c0000000-0000-0000-0000-000000000001', 1, 150500, '{"sello": "SI"}')) ->> 'ok')::boolean, true,
          'un precio normal pasa la banda');

-- ================================================================ cadena de frío y calidad
-- La temperatura es informativa (decisión 27/10/2026): no bloquea, sin ella ni por encima del máximo.
select is((pg_temp.rec('FV-4011', pg_temp.linea('c0000000-0000-0000-0000-000000000020', 2, 30000,
            jsonb_build_object('vencimiento', (privado.hoy() + 10)::text))) ->> 'ok')::boolean, true,
          'refrigerado sin temperatura se guarda');
create temp table r12 as select pg_temp.rec('FV-4012', pg_temp.linea('c0000000-0000-0000-0000-000000000020', 2, 30000,
  jsonb_build_object('temperatura', 7, 'vencimiento', (privado.hoy() + 10)::text))) as r;
select is((select (r ->> 'ok')::boolean from r12), true, '7 °C con máximo de 4 °C no bloquea');
select ok(pg_temp.tiene((select r -> 'avisos' from r12), '%llegó a 7 °C y el máximo es 4 °C.'), 'pero queda como aviso');
select ok(pg_temp.tiene(pg_temp.rec('FV-4013', pg_temp.linea('c0000000-0000-0000-0000-000000000020', 2, 30000, '{"temperatura": 3}')) -> 'bloqueos', 'B11 ·%no tiene fecha de vencimiento%'),
          'B11: refrigerado sin vencimiento sigue bloqueando');
create temp table r11 as select pg_temp.rec('FV-4014', pg_temp.linea('c0000000-0000-0000-0000-000000000020', 2, 30000,
  jsonb_build_object('temperatura', 7, 'vencimiento', (privado.hoy() + 10)::text, 'condicion', 'DANADO'))) as r;
select is((select (r ->> 'ok')::boolean from r11), true, 'llegó caliente y dañado: se guarda sin motivo');
select ok((select 'H11' = any (l.hallazgos) from public.recepcion_lineas l where l.recepcion_id = (select (r ->> 'id')::uuid from r11)),
          'y la línea queda marcada H11 (temperatura fuera de rango)');
select ok(pg_temp.tiene((select r -> 'avisos' from r11), '%entra al inventario marcado DAÑADO%'), 'lo dañado avisa que falta la baja o devolución');

-- ================================================================ foto, origen IA y alias
select ok(pg_temp.tiene(pg_temp.rec('FV-4015', pg_temp.linea('c0000000-0000-0000-0000-000000000002', 1, 13150),
            '{"soporte_ruta": "COCINA/2026/0b6c1a5e-8d4e-4f8a-9a55-0d1b8f0e2c11.jpg"}') -> 'fatales', 'F1 ·%foto%'),
          'F1: una foto de otra área se rechaza');
select ok(pg_temp.tiene((select r -> 'avisos' from r1), 'Recepción sin foto%'), 'sin foto de la factura avisa');
create temp table rf as select pg_temp.rec('FV-4016', pg_temp.linea('c0000000-0000-0000-0000-000000000002', 1, 13300,
    '{"nombre_factura": "AZUCAR MANUELITA X 2500", "origen": "IA_CORREGIDA"}'),
  '{"soporte_ruta": "BAR/2026/0b6c1a5e-8d4e-4f8a-9a55-0d1b8f0e2c11.jpg", "propuesta_ia": {"proveedor": "Fruteria"}}') as r;
select is((select soporte_ruta from public.recepciones where id = (select (r ->> 'id')::uuid from rf)),
          'BAR/2026/0b6c1a5e-8d4e-4f8a-9a55-0d1b8f0e2c11.jpg', 'la recepción guarda la ruta de la foto');
select is((select origen from public.recepcion_lineas where recepcion_id = (select (r ->> 'id')::uuid from rf)),
          'IA_CORREGIDA', 'la línea guarda que la persona corrigió la propuesta de la IA');
select is((select producto_id from public.alias where fuente = 'RECEPCION' and alias_norm = 'azucar manuelita x 2500'),
          'c0000000-0000-0000-0000-000000000002'::uuid, 'el nombre de la factura queda como alias del producto confirmado');

-- ================================================================ proveedor nuevo desde la factura
create temp table pn as select public.proveedor_desde_factura('BAR', '  DISTRIBUIDORA   NUEVA SAS ', '900.123.456-7') as r;
select is((select (r ->> 'creado')::boolean from pn), true, 'un proveedor que no existe se crea');
select is((select nombre || ' / ' || nit from public.proveedores where id = (select (r ->> 'id')::uuid from pn)),
          'Distribuidora Nueva Sas / 900123456-7', 'con el nombre suavizado y el NIT limpio');
select is(public.proveedor_desde_factura('BAR', 'Distribuidora Nueva SAS') ->> 'id', (select r ->> 'id' from pn),
          'el mismo nombre no lo duplica');
select is(public.proveedor_desde_factura('BAR', 'Dist. Nueva', '900123456') ->> 'id', (select r ->> 'id' from pn),
          'el mismo NIT con otro nombre tampoco');
select is((public.proveedor_desde_factura('BAR', 'FRUTERÍA') ->> 'creado')::boolean, false, 'uno de la lista se reconoce');
select pg_temp.como('a0000000-0000-0000-0000-000000000005');  -- chef (cocina)
select throws_like($$ select public.proveedor_desde_factura('BAR', 'Otro Proveedor') $$, '%Sin permiso%',
                   'quien no recibe en el área no crea proveedores en ella');
select pg_temp.como('a0000000-0000-0000-0000-000000000003');

-- ================================================================ lista de la pantalla
select is((select costo_promedio from public.productos_recepcion('BAR') where producto_id = 'c0000000-0000-0000-0000-000000000002'),
          pg_temp.promedio('c0000000-0000-0000-0000-000000000002'), 'productos_recepcion trae el costo vigente');
select pg_temp.como('a0000000-0000-0000-0000-000000000004');  -- servicio
select throws_like($$ select * from public.productos_recepcion('BAR') $$, '%Sin permiso%', 'servicio no recibe');

select * from finish();
rollback;
