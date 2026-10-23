-- Histórico de cocina (supabase/datos/historico_cocina.sql) cargado junto al de bar.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

\ir ../datos/historico_bar.sql
\ir ../datos/historico_cocina.sql

select is((select count(*) from public.ubicaciones where area = 'COCINA'), 15::bigint, '15 zonas de CAT_ZONAS como ubicaciones de cocina');
select ok(not exists (select 1 from public.ubicaciones where codigo = 'COC_BODEGA'), 'no queda una bodega de cocina inventada');
select ok(not exists (select 1 from public.genericos g where g.area = 'COCINA' and g.tipo in ('MPe', 'MPI')
                        and not exists (select 1 from public.productos p where p.generico_id = g.id)),
          'todo genérico de cocina tiene producto');
select ok(not exists (select 1 from public.ubicacion_productos up join public.ubicaciones u on u.codigo = up.ubicacion
                       join public.productos p on p.id = up.producto_id join public.genericos g on g.id = p.generico_id
                       where u.area <> g.area),
          'cada producto se ubica en una zona de su propia área');
select is((select count(*) from public.genericos where area = 'COCINA' and privado.normalizar(nombre) = 'aceite ajonjoli'),
          0::bigint, 'las altas sin clasificar no entran (Aceite ajonjolí)');
select ok(exists (select 1 from public.genericos where area = 'COCINA' and nota like 'Insumo de bar guardado en cocina%'),
          'los «Mpe Bar» del inventario de cocina son genéricos de cocina');
select ok(exists (select 1 from public.genericos where area = 'COCINA' and conservacion = 'Refrigerado' and temp_max_llegada is not null),
          'la recepción aporta la cadena de frío al genérico enlazado');
select is((select count(*) from public.alias a join public.genericos g on g.id = a.generico_id
            where g.area = 'COCINA' and a.fuente = 'RECEPCION'), 45::bigint,
          'solo los 45 nombres idénticos de recepción quedan enlazados sin decisión');
select is((select count(*) from public.costos_referencia c join public.productos p on p.id = c.producto_id
            join public.genericos g on g.id = p.generico_id where g.area = 'COCINA'), 30::bigint,
          'costos de referencia de cocina solo para productos enlazados');
select is((select count(*) from public.proveedores where nombre_norm = 'r y r'), 1::bigint,
          'el proveedor que comparten bar y cocina no se duplica');
select ok(not exists (select 1 from public.genericos g1 join public.genericos g2 on g1.codigo = g2.codigo and g1.id <> g2.id),
          'los códigos de bar y cocina no chocan');

-- idempotencia
create temp table antes as select (select count(*) from public.genericos) g, (select count(*) from public.productos) p,
                                  (select count(*) from public.ubicacion_productos) u, (select count(*) from public.alias) a;
\ir ../datos/historico_cocina.sql
select ok((select (g, p, u, a) = ((select count(*) from public.genericos), (select count(*) from public.productos),
                                  (select count(*) from public.ubicacion_productos), (select count(*) from public.alias)) from antes),
          'volver a cargar el histórico de cocina no duplica registros');

-- conteo inicial en una zona de cocina, con un producto que tiene costo de referencia
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-000000000005', 'chef@prueba.test'),
                                          ('a0000000-0000-0000-0000-000000000002', 'jefe.bar@prueba.test');
insert into public.perfiles (id, nombre, rol, areas) values
  ('a0000000-0000-0000-0000-000000000005', 'Chef', 'chef', '{COCINA}'),
  ('a0000000-0000-0000-0000-000000000002', 'Jefe Bar', 'jefe_bar', '{BAR}');
create temp table elegido as
select p.id as producto_id, c.costo_unitario_base as cu
  from public.costos_referencia c join public.productos p on p.id = c.producto_id
  join public.genericos g on g.id = p.generico_id
 where g.area = 'COCINA' order by p.codigo limit 1;
create or replace function pg_temp.conteo(p_usuario uuid) returns jsonb language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_usuario)::text, true);
  select public.registrar_conteo(jsonb_build_object(
    'ubicacion', 'COC_BO1', 'fecha', privado.hoy()::text, 'responsable_id', p_usuario, 'inicial', true,
    'lineas', jsonb_build_array(jsonb_build_object('producto_id', (select producto_id from elegido), 'cantidad', 500))))
$$;
select throws_like($$ select pg_temp.conteo('a0000000-0000-0000-0000-000000000002') $$, '%Sin permiso%',
                   'el jefe de bar no cuenta en cocina');
select is((pg_temp.conteo('a0000000-0000-0000-0000-000000000005') ->> 'ok')::boolean, true, 'el chef abre el kardex de cocina');
select is((select cantidad from public.existencias where producto_id = (select producto_id from elegido) and ubicacion = 'COC_BO1'),
          500::numeric, 'el saldo inicial queda en la zona contada');
select is((select costo_promedio from public.costos_producto where producto_id = (select producto_id from elegido)),
          (select cu from elegido), 'y valorizado al costo de referencia de la recepción de cocina');

select * from finish();
rollback;
