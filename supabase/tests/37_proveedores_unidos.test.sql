-- Unir proveedores, alias, parecidos y dependencia.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);
\ir fixtures.inc

insert into public.proveedores (id, nombre) values
  ('d0000000-0000-0000-0000-000000000011', 'Frutas y Verduras del Campo JC'),
  ('d0000000-0000-0000-0000-000000000012', 'Fruver JC');
insert into public.compras_historicas (id, origen, id_origen, fecha, proveedor, nombre_factura, generico_id, producto_id, cantidad_base, valor_total, computable) values
  (gen_random_uuid(), 'REC-COC', 'P1', privado.hoy() - 10, 'Fruver JC', 'Limón', 'b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 1000, 4000, true),
  (gen_random_uuid(), 'REC-BAR', 'P2', privado.hoy() - 5, 'Dislicores', 'Tanqueray', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 700, 96000, true);
select privado.registrar_proveedor_producto('d0000000-0000-0000-0000-000000000012', 'c0000000-0000-0000-0000-000000000003', 'LIMON', 1000, 4000, privado.hoy() - 10, 'SHEET');

select pg_temp.como('a0000000-0000-0000-0000-000000000003');  -- aux de bar
select throws_like($$ select public.unir_proveedores('d0000000-0000-0000-0000-000000000011', 'd0000000-0000-0000-0000-000000000012') $$,
                   '%Solo administración%', 'el aux no une proveedores');

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
select ok(exists (select 1 from public.proveedores_parecidos() where a_nombre in ('Fruver JC', 'Frutas y Verduras del Campo JC')
                                                                and b_nombre in ('Fruver JC', 'Frutas y Verduras del Campo JC')),
          'Fruver JC y Frutas y Verduras del Campo JC salen como posibles repetidos');

select public.unir_proveedores('d0000000-0000-0000-0000-000000000011', 'd0000000-0000-0000-0000-000000000012');
select ok((select not activo and unido_en = 'd0000000-0000-0000-0000-000000000011' from public.proveedores where id = 'd0000000-0000-0000-0000-000000000012'),
          'el que sale queda inactivo y unido');
select is(privado.proveedor_por_nombre('FRUVER JC'), 'd0000000-0000-0000-0000-000000000011'::uuid, 'su nombre lleva al que queda');
select is((select proveedor_id from public.proveedor_productos where producto_id = 'c0000000-0000-0000-0000-000000000003'),
          'd0000000-0000-0000-0000-000000000011'::uuid, 'lo que se le compraba pasa al que queda');
select is(((public.proveedor_desde_factura('BAR', 'Fruver JC') ->> 'id'))::uuid, 'd0000000-0000-0000-0000-000000000011'::uuid,
          'Recibir ya no crea otro «Fruver JC»');
select ok(not exists (select 1 from public.proveedores_parecidos() where b_nombre = 'Fruver JC' or a_nombre = 'Fruver JC'), 'y deja de salir como repetido');

-- dependencia: Dislicores 96.000 de 100.000 = 96 %
create temp table d as select public.dependencia_proveedores(12) as v;
select is((select (v ->> 'total')::numeric from d), 100000::numeric, 'total comprado');
select is((select (v -> 'proveedores' -> 0 ->> 'nombre') from d), 'Dislicores', 'el de mayor gasto primero');
select is((select (v -> 'proveedores' -> 0 ->> 'participacion')::numeric from d), 96.0, 'con su participación');
select ok((select jsonb_array_length(v -> 'un_solo_proveedor') = 2 from d), 'cada insumo con un solo proveedor aparece');

select * from finish();
rollback;
