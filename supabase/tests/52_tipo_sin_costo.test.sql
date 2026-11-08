-- Corregir el tipo de un insumo (MPe ↔ MPI ↔ sin costo) y lo sin costo no lleva precio.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
\ir fixtures.inc

create or replace function pg_temp.editar(p_prod text, p_gen jsonb) returns jsonb language sql as $$
  select public.editar_producto(jsonb_build_object('id', p_prod, 'generico', p_gen))
$$;

insert into public.costos_referencia (producto_id, costo_unitario_base, fuente)
values ('c0000000-0000-0000-0000-000000000006', 40, 'prueba');

select pg_temp.como('a0000000-0000-0000-0000-000000000002');  -- jefe de bar

-- el cardamomo (MPe con precio) pasa a sin costo: pierde el precio
select is((pg_temp.editar('c0000000-0000-0000-0000-000000000006', '{"tipo": "SIN_COSTO"}') ->> 'ok')::boolean, true, 'MPe → sin costo');
select is((select tipo::text from public.genericos where id = 'b0000000-0000-0000-0000-000000000006'), 'SIN_COSTO', 'queda sin costo');
select is((select count(*) from public.costos_referencia where producto_id = 'c0000000-0000-0000-0000-000000000006'), 0::bigint,
          'y se le quitó el costo de referencia');

-- lo sin costo no recibe precio después (foto, herencia…)
insert into public.costos_referencia (producto_id, costo_unitario_base, fuente)
values ('c0000000-0000-0000-0000-000000000005', 2083, 'Mismo genérico: prueba');
select is((select count(*) from public.costos_referencia where producto_id = 'c0000000-0000-0000-0000-000000000005'), 0::bigint,
          'el agua no guarda precio');

-- y vuelve a MPe
select is((pg_temp.editar('c0000000-0000-0000-0000-000000000006', '{"tipo": "MPe"}') ->> 'ok')::boolean, true, 'sin costo → MPe');
insert into public.costos_referencia (producto_id, costo_unitario_base, fuente)
values ('c0000000-0000-0000-0000-000000000006', 40, 'prueba');
select is((select count(*) from public.costos_referencia where producto_id = 'c0000000-0000-0000-0000-000000000006'), 1::bigint,
          'ya como MPe vuelve a llevar precio');

-- el sirope (MPI) también puede pasar a sin costo; una bebida de carta no
select is((pg_temp.editar('c0000000-0000-0000-0000-000000000004', '{"tipo": "SIN_COSTO"}') ->> 'ok')::boolean, true, 'MPI → sin costo');
select is((pg_temp.editar('c0000000-0000-0000-0000-000000000003', '{"tipo": "BEBIDA"}') ->> 'ok')::boolean, false,
          'un insumo no pasa a bebida de carta');

select * from finish();
rollback;
