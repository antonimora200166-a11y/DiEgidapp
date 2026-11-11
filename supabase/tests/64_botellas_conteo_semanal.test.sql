-- Botellas del bar: los licores y vinos se cuentan cada semana sin importar su clase ABC, la tara
-- se registra desde el conteo (botella vacía o llena y sellada) y el teórico de cada insumo se
-- desglosa por cóctel.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);
\ir fixtures.inc

-- conteo inicial hace 10 días: Tanqueray (licor, sin clase = C) en la barra y azúcar en la bodega
select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
select public.registrar_conteo(jsonb_build_object('ubicacion', 'BAR_BARRA', 'fecha', (privado.hoy() - 10)::text,
  'responsable_id', 'a0000000-0000-0000-0000-000000000002', 'inicial', true,
  'lineas', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000001', 'cantidad', 1400))));
select public.registrar_conteo(jsonb_build_object('ubicacion', 'BAR_BODEGA', 'fecha', (privado.hoy() - 10)::text,
  'responsable_id', 'a0000000-0000-0000-0000-000000000002', 'inicial', true,
  'lineas', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000002', 'cantidad', 5000))));

select is((select toca from public.hoja_conteo('BAR_BARRA') where codigo = 'BAR_MPe_0079-700'), true,
          'un licor de clase C contado hace 10 días ya toca (cada 7)');
select is((select toca from public.hoja_conteo('BAR_BODEGA') where codigo = 'BAR_MPe_0005-2500'), false,
          'un insumo seco de clase C contado hace 10 días no toca (cada 30)');

-- densidad típica
select is(array[privado.densidad_tipica('Baileys', 'LICOR'), privado.densidad_tipica('Vino Tinto Malbec', 'VINO'),
                privado.densidad_tipica('Ron Zacapa 23 años', 'LICOR'), privado.densidad_tipica('Licor de café', 'LICOR')],
          array[1.05, 0.99, 0.95, 1.04]::numeric[], 'densidad típica por tipo de bebida');

-- tara desde el conteo: el aux pesa una botella llena y sellada de 700 ml (1.245 g)
select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar
create temp table t1 as select public.registrar_tara(jsonb_build_object(
  'producto_id', 'c0000000-0000-0000-0000-000000000001', 'modo', 'LLENA', 'peso_g', 1245)) as r;
select ok((select (r ->> 'ok')::boolean from t1), 'registra la tara con la botella llena');
select is((select array[tara_g, densidad_g_ml] from public.taras where producto_id = 'c0000000-0000-0000-0000-000000000001'),
          array[580, 0.95]::numeric[], 'tara = 1.245 g − 700 ml × 0,95 g/ml');
select ok((select densidad_estimada from public.taras where producto_id = 'c0000000-0000-0000-0000-000000000001'),
          'la densidad queda marcada como estimada');
select ok((select r ->> 'error' from (select public.registrar_tara(jsonb_build_object(
  'producto_id', 'c0000000-0000-0000-0000-000000000001', 'modo', 'VACIA', 'peso_g', 500)) as r) x) like '%ya tiene tara%',
          'el aux no cambia una tara ya registrada');

-- con la tara, la botella abierta ya se puede pesar en el conteo: 1.055 g − 580 = 475 g → 500 ml
create temp table c1 as select public.registrar_conteo(jsonb_build_object('ubicacion', 'BAR_BARRA', 'fecha', privado.hoy()::text,
  'responsable_id', 'a0000000-0000-0000-0000-000000000003',
  'lineas', jsonb_build_array(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000001',
                                                 'unidades_compra', 1, 'peso_bruto_g', 1055)))) as r;
select is((select cl.cantidad_contada from public.conteo_lineas cl where cl.conteo_id = (select (r ->> 'id')::uuid from c1)),
          1200::numeric, 'una cerrada + la abierta pesada = 1.200 ml');

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
select ok((public.registrar_tara(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000001', 'modo', 'VACIA',
            'peso_g', 575, 'densidad', 0.94)) ->> 'ok')::boolean, 'el jefe sí la corrige, pesando la botella vacía');
select is((select array[tara_g, densidad_g_ml] from public.taras where producto_id = 'c0000000-0000-0000-0000-000000000001'),
          array[575, 0.94]::numeric[], 'queda la tara pesada y la densidad dada');
select ok((public.registrar_tara(jsonb_build_object('producto_id', 'c0000000-0000-0000-0000-000000000001', 'modo', 'LLENA',
            'peso_g', 600)) ->> 'error') like '%llena y sellada%', 'una botella llena que pesa muy poco se rechaza');

-- desglose del teórico por cóctel
select is((select privado.insumos_con_desglose(
             jsonb_build_array(jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000001', 'teorico_q', 600)),
             jsonb_build_array(jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000007', 'unidades', 10, 'completa', true,
               'lineas', jsonb_build_array(jsonb_build_object('generico_id', 'b0000000-0000-0000-0000-000000000001', 'cantidad_base', 60)))))
           -> 0 -> 'desglose' -> 0),
          '{"generico_id": "b0000000-0000-0000-0000-000000000007", "nombre": "Gin Sour", "unidades": 10, "q": 600.00}'::jsonb,
          'el teórico del insumo sale por cóctel');

-- la frecuencia de botellas es un parámetro (versionado: la nueva fila rige desde ahora); el
-- Tanqueray se contó hoy arriba, así que se mira el conteo de hace 10 días en otra zona
insert into public.parametros (clave, valor) values ('FRECUENCIA_CONTEO_BOTELLAS_DIAS', '14');
select is(privado.dias_entre_conteos(null::public.clase_abc, 'LICOR', 'BAR'), 14, 'la frecuencia de botellas es un parámetro');

select * from finish();
rollback;
