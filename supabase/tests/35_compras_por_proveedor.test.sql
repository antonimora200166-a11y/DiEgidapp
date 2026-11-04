-- Lo que se compra a cada proveedor; Precios desde fotos con proveedor, alias, nombre y marca.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
\ir fixtures.inc

create temp table v as select 'BAR/2026/' || gen_random_uuid() || '.jpg' as ruta;

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
-- «Dislicores» se escribe distinto en la foto pero se elige de la lista; la IA sugiere marca Tanqueray y nombre «Ginebra»
create temp table r as select public.guardar_precios_foto(jsonb_build_object(
  'area', 'BAR', 'ruta', (select ruta from v), 'proveedor_id', 'd0000000-0000-0000-0000-000000000001', 'proveedor', 'DISLICORES S.A.S',
  'fecha', '2026-11-02',
  'lineas', jsonb_build_array(
    jsonb_build_object('n', 1, 'producto_id', 'c0000000-0000-0000-0000-000000000001', 'descripcion', 'GIN TANQUERAY LONDON DRY 700ML',
                       'cantidad_base', 700, 'valor_total', 98000, 'fijar_costo', true,
                       'renombrar', jsonb_build_object('nombre', 'Ginebra', 'marca', 'Tanqueray London Dry'))))) as x;

select is((select (x ->> 'ok')::int from r), 1, 'se guarda la línea');
select is((select (x ->> 'proveedor_id')::uuid from r), 'd0000000-0000-0000-0000-000000000001'::uuid, 'con el proveedor elegido');
select is((select nombre from public.genericos where id = 'b0000000-0000-0000-0000-000000000001'), 'Ginebra', 'el genérico toma el nombre sugerido');
select is((select marca from public.productos where id = 'c0000000-0000-0000-0000-000000000001'), 'Tanqueray London Dry', 'y la marca');
select is((select veces from public.proveedor_productos where proveedor_id = 'd0000000-0000-0000-0000-000000000001'
             and producto_id = 'c0000000-0000-0000-0000-000000000001'), 1, 'queda lo que se le compra a Dislicores');
select is((select ultimo_costo_base from public.proveedor_productos where producto_id = 'c0000000-0000-0000-0000-000000000001'), 140::numeric,
          'con su último precio por ml');
select ok(exists (select 1 from public.alias where fuente = 'RECEPCION' and alias = 'GIN TANQUERAY LONDON DRY 700ML'
                    and producto_id = 'c0000000-0000-0000-0000-000000000001'), 'el nombre de la factura queda aprendido');
select is((select count(*) from public.compras_por_proveedor() where proveedor = 'Dislicores'), 1::bigint, 'la consulta por proveedor lo muestra');

-- una compra más vieja suma una vez pero no cambia el último precio
select privado.registrar_proveedor_producto('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
                                            'TANQUERAY', 700, 70000, '2026-09-01', 'SHEET');
select ok((select veces = 2 and ultimo_costo_base = 140 and primera_fecha = '2026-09-01' from public.proveedor_productos
            where producto_id = 'c0000000-0000-0000-0000-000000000001'), 'una compra vieja cuenta, sin pisar el último precio');

select * from finish();
rollback;
