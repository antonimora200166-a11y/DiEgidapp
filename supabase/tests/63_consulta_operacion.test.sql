-- Consulta, bloques 3 a 6: inventario (valor, bajo mínimo, inmovilizado), compras (proveedor,
-- subida de precio con su impacto sobre lo vendido), producción y pérdidas. Solo administración.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
\ir fixtures.inc

-- azúcar: 5.000 g a $4 hace 40 días (desde entonces no se mueve) · mínimo 3 bolsas de 2.500 g
update public.productos set stock_minimo = 3 where id = 'c0000000-0000-0000-0000-000000000002';
select privado.registrar_movimiento('SALDO_INICIAL', 'c0000000-0000-0000-0000-000000000002', 'BAR_BODEGA', 5000, privado.hoy() - 40, 4, 'CONTEO');
-- ginebra: 700 ml a $200 hace 5 días y una baja de 100 ml dañados ayer ($20.000)
select privado.registrar_movimiento('SALDO_INICIAL', 'c0000000-0000-0000-0000-000000000001', 'BAR_BARRA', 700, privado.hoy() - 5, 200, 'CONTEO');
insert into public.bajas (id, codigo, area, ubicacion, fecha, causa, usuario_id) values
  ('f0000000-0000-0000-0000-000000000631', 'BAJ-T2', 'BAR', 'BAR_BARRA', privado.hoy() - 1, 'DANADO', 'a0000000-0000-0000-0000-000000000003');
select privado.registrar_movimiento('SALIDA_BAJA', 'c0000000-0000-0000-0000-000000000001', 'BAR_BARRA', 100, privado.hoy() - 1, null, 'BAJA',
                                    'f0000000-0000-0000-0000-000000000631');
-- compras: azúcar a $4 el mes pasado y a $5 en este período, en Frutería
insert into public.compras_historicas (id, origen, id_origen, fecha, proveedor, nombre_factura, generico_id, producto_id, cantidad_base, valor_total, computable) values
  (gen_random_uuid(), 'REC-BAR', 'O-1', privado.hoy() - 45, 'Frutería', 'Azúcar', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 2500, 10000, true),
  (gen_random_uuid(), 'REC-BAR', 'O-2', privado.hoy() - 10, 'Frutería', 'Azúcar', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 2500, 12500, true);
-- ventas: 10 Gin Sour (100 g de azúcar cada uno) en el período → 1.000 g de consumo teórico
insert into public.fichas (id, codigo, generico_id) values ('e0000000-0000-0000-0000-000000000631', 'C99', 'b0000000-0000-0000-0000-000000000007');
insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad) values
  ('e0000000-0000-0000-0000-000000000631', 1, 'b0000000-0000-0000-0000-000000000002', 100, 'g');
insert into public.ventas_cargas (id, formato, archivo, huella, desde, hasta, por_dia, lineas, unidades, total_odoo)
values ('f0000000-0000-0000-0000-000000000632', 'TABLA_DINAMICA', 's.xlsx', 'h-op', privado.hoy() - 29, privado.hoy(), true, 1, 10, 100000);
insert into public.ventas_lineas (carga_id, fecha, nombre_odoo, clave, cantidad, valor_neto)
values ('f0000000-0000-0000-0000-000000000632', privado.hoy() - 3, 'Gin Sour', 'GS', 10, 100000);
insert into public.equivalencias_odoo (clave, nombre_odoo, tipo) values ('GS', 'Gin Sour', 'PRODUCTO');
insert into public.equivalencia_partes (clave, generico_id) values ('GS', 'b0000000-0000-0000-0000-000000000007');

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar
select throws_like($$ select public.consulta_inventario('BAR', privado.hoy() - 29, privado.hoy()) $$, '%Sin permiso%', 'el jefe de barra no ve el inventario en pesos');
select throws_like($$ select public.consulta_compras('BAR', privado.hoy() - 29, privado.hoy()) $$, '%Sin permiso%', 'ni las compras');

select pg_temp.como('a0000000-0000-0000-0000-000000000001');  -- admin
create temp table i as select public.consulta_inventario('BAR', privado.hoy() - 29, privado.hoy()) as v;
select is((select (v ->> 'valor_total')::numeric from i), 140000::numeric, 'valor del inventario: 5.000 g × $4 + 600 ml × $200');
select is((select v -> 'bajo_minimo' -> 0 ->> 'saldo' from i), '2.0', 'el azúcar está en 2 bolsas');
select is((select v -> 'bajo_minimo' -> 0 ->> 'nombre' from i), 'Azúcar blanca', 'bajo su mínimo de 3');
select is((select (v ->> 'inmovilizado')::numeric from i), 20000::numeric, 'el azúcar no se mueve hace más de 30 días: $20.000 inmovilizados');
select is((select (c ->> 'consumo')::numeric from i, jsonb_array_elements(v -> 'por_categoria') c where c ->> 'categoria' = 'Licores'), 20000::numeric,
          'los licores consumieron $20.000 en el período (la baja)');

create temp table c as select public.consulta_compras('BAR', privado.hoy() - 29, privado.hoy()) as v;
select is((select (v ->> 'total')::numeric from c), 12500::numeric, 'compras del período');
select is((select v -> 'por_proveedor' -> 0 ->> 'proveedor' from c), 'Frutería', 'por proveedor');
select is((select array[(v -> 'subidas' -> 0 ->> 'pct')::numeric, (v -> 'subidas' -> 0 ->> 'impacto')::numeric] from c), array[25.0, 1000]::numeric[],
          'el azúcar subió 25 %; impacto sobre lo vendido: $1 × 1.000 g');

create temp table p as select public.consulta_perdidas('BAR', privado.hoy() - 29, privado.hoy()) as v;
select is((select (v ->> 'total')::numeric from p), 20000::numeric, 'pérdidas del período');
select is((select v -> 'por_causa' -> 0 ->> 'causa' from p), 'DANADO', 'por causa');
select is((select v -> 'por_responsable' -> 0 ->> 'responsable' from p), 'Aux Bar Prueba', 'por quién la registró');
select is((select jsonb_array_length(v -> 'tendencia') from p), 6, 'tendencia de los 6 últimos períodos');

select * from finish();
rollback;
