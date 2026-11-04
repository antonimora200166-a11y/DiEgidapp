-- Hoja de verificación A/B: precio y costo por unidad base, alertas, parecidos, marcar verificado.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);
\ir fixtures.inc

-- presentación que no cuadra: dice 1.000 g y el contenido es 500
insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base) values
  ('b0000000-0000-0000-0000-000000000401', 'BAR_MPe_0401', 'Azúcar blanca orgánica', 'MPe', 'INSUMO_SECO', 'BAR', 'g'),
  ('b0000000-0000-0000-0000-000000000402', 'BAR_MPe_0402', 'Fresa congelada', 'MPe', 'FRUVER', 'BAR', 'g');
insert into public.productos (id, codigo, generico_id, marca, presentacion, unidad_compra, contenido_base, clase_abc) values
  ('c0000000-0000-0000-0000-000000000401', 'BAR_MPe_0401-1', 'b0000000-0000-0000-0000-000000000401', '', 'Bolsa 1.000 g', 'PAQ', 500, 'A'),
  ('c0000000-0000-0000-0000-000000000402', 'BAR_MPe_0402-1', 'b0000000-0000-0000-0000-000000000402', '', 'Granel', 'KG', 1, 'B');
update public.productos set clase_abc = 'A' where id = 'c0000000-0000-0000-0000-000000000001';

-- dos compras de la ginebra: $70.000 y $77.000 la botella de 700 ml
insert into public.compras_historicas (id, origen, id_origen, fecha, proveedor, nombre_factura, generico_id, producto_id,
                                       cantidad_base, valor_total, computable) values
  (gen_random_uuid(), 'REC-BAR', 'x1', '2026-09-01', 'Dislicores', 'Tanqueray 700', 'b0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001', 700, 70000, true),
  (gen_random_uuid(), 'REC-BAR', 'x2', '2026-09-20', 'Dislicores', 'Tanqueray 700', 'b0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001', 1400, 154000, true);

select is((select cantidad from privado.cantidad_presentacion('Bolsa 2.500 g')), 2500::numeric, '«2.500 g» son 2500 g');
select is((select cantidad::text || ' ' || unidad from privado.cantidad_presentacion('Botella 0,75 L')), '750.00 ml', '«0,75 L» son 750 ml');
select is((select count(*) from privado.cantidad_presentacion('Granel')), 0::bigint, 'sin cantidad escrita no dice nada');

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar
select throws_like($$ select * from public.lista_verificacion('BAR') $$, '%Solo administración o el jefe%', 'el aux no ve la hoja');

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
create temp table h as select * from public.lista_verificacion('BAR');
select is((select n_compras from h where codigo = 'BAR_MPe_0079-700'), 2, 'la ginebra trae sus dos compras');
select is((select ult_valor from h where codigo = 'BAR_MPe_0079-700'), 154000::numeric, 'la última compra es la del 20/09');
select is((select round(costo_base, 2) from h where codigo = 'BAR_MPe_0079-700'), 106.67, 'costo promedio por ml de las compras');
select is((select costo_fuente from h where codigo = 'BAR_MPe_0079-700'), 'compras', 'y dice de dónde sale');
select is((select codigo from h limit 1), 'BAR_MPe_0079-700', 'primero la clase A con más compras');
select ok((select 'PRESENTACION' = any (alertas) from h where codigo = 'BAR_MPe_0401-1'), 'la bolsa de 1.000 g con contenido 500 avisa');
select ok((select 'CONTENIDO' = any (alertas) from h where codigo = 'BAR_MPe_0402-1'), 'un KG con contenido 1 avisa');
select ok((select 'SIN_PRECIO' = any (alertas) from h where codigo = 'BAR_MPe_0402-1'), 'sin compras: sin precio');
select ok((select 'MPI_SIN_FICHA' = any (alertas) from h where codigo = 'BAR_MPi_0006-G'), 'MPI sin ficha avisa');
select ok((select parecidos @> '[{"nombre": "Azúcar blanca"}]' from h where codigo = 'BAR_MPe_0401-1'), 'la orgánica se parece al azúcar blanca');

-- descartar el parecido: ya no vuelve a salir
select public.marcar_parecido('b0000000-0000-0000-0000-000000000401', 'b0000000-0000-0000-0000-000000000002', 'SEPARAR');
select ok((select not (parecidos @> '[{"nombre": "Azúcar blanca"}]') from public.lista_verificacion('BAR') where codigo = 'BAR_MPe_0401-1'),
          'separado, ya no sale como parecido');
create temp table r as select public.marcar_parecido('b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'REVISAR') as v;
select ok((select (v ->> 'ok')::boolean from r) and exists (select 1 from public.revision_catalogo where decision is null and id = (select v ->> 'id' from r)),
          'a revisar: queda como par pendiente');

-- verificar, y la marca se pierde si cambia el contenido
select public.verificar_productos(array['c0000000-0000-0000-0000-000000000401']::uuid[]);
select ok((select verificado_en is not null from public.productos where id = 'c0000000-0000-0000-0000-000000000401'), 'queda verificado');
update public.productos set contenido_base = 1000 where id = 'c0000000-0000-0000-0000-000000000401';
select ok((select verificado_en is null from public.productos where id = 'c0000000-0000-0000-0000-000000000401'),
          'al cambiar el contenido hay que volver a verificar');

select * from finish();
rollback;
