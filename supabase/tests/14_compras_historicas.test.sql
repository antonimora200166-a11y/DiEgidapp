-- Histórico de compras migrado línea a línea (supabase/datos/compras_historicas_*.sql): es la
-- misma base de la que salió el costo inicial (costos_referencia) y alimenta la banda B7.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

\ir ../datos/historico_bar.sql
\ir ../datos/historico_cocina.sql
\ir ../datos/compras_historicas_bar.sql
\ir ../datos/compras_historicas_cocina.sql

select is((select count(*) from public.compras_historicas where origen = 'REC-BAR'), 75::bigint, '75 compras de bar con cantidad en unidad base');
select is((select count(*) from public.compras_historicas where origen = 'REC-BAR' and computable), 63::bigint, '63 de ellas cuentan para la banda');
select is((select count(*) from public.compras_historicas where origen = 'REC-COC'), 54::bigint, '54 compras de cocina con cruce decidido');
select ok((select bool_and(motivo_exclusion like 'Repite la línea%') from public.compras_historicas
            where id_origen in ('BAR-20261001-001-001', 'BAR-20260905-002-005')), 'las compras repetidas quedan, pero no cuentan');
select is((select count(*) from public.movimientos), 0::bigint, 'el histórico de compras no escribe en el kardex');

-- el costo inicial de cada producto es el promedio ponderado de sus compras computables en los
-- 90 días antes del corte (2026-10-22): el histórico cargado lo reproduce exactamente
select is((select count(*) from public.costos_referencia cr
             join public.productos p on p.id = cr.producto_id
             join public.genericos g on g.id = p.generico_id
            where cr.fuente like 'REC-BAR: promedio ponderado%' and g.area = 'BAR'
              and cr.costo_unitario_base <> (select round(sum(ch.valor_total) / sum(ch.cantidad_base), 6)
                                               from public.compras_historicas ch
                                              where ch.producto_id = cr.producto_id and ch.computable
                                                and ch.fecha between date '2026-10-22' - 90 and date '2026-10-22')),
          0::bigint, 'bar: todo costo de referencia «promedio ponderado» = Σ valor / Σ cantidad de sus compras');
select ok((select count(*) from public.costos_referencia where fuente like 'REC-BAR: promedio ponderado%') > 30,
          'y son la mayoría de los costos de bar');
select is((select count(*) from public.costos_referencia cr
             join public.productos p on p.id = cr.producto_id
             join public.genericos g on g.id = p.generico_id
            where cr.fuente like 'REC-COC: promedio ponderado%'
              and cr.costo_unitario_base <> (select round(sum(ch.valor_total) / sum(ch.cantidad_base), 6)
                                               from public.compras_historicas ch
                                              where ch.generico_id = g.id and ch.computable
                                                and ch.fecha between date '2026-10-22' - 90 and date '2026-10-22')),
          0::bigint, 'cocina: igual, por genérico');
select is((select c.costo_unitario_base from public.costos_referencia c join public.productos p on p.id = c.producto_id
            where p.codigo = 'BAR_MPe_0079-700'), 212.842857::numeric, 'Tanqueray conserva su costo inicial');

-- idempotente
\ir ../datos/compras_historicas_bar.sql
select is((select count(*) from public.compras_historicas where origen = 'REC-BAR'), 75::bigint, 'volver a cargarlo no duplica');

select * from finish();
rollback;
