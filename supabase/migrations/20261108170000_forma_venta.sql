-- =====================================================================================
-- SGI Di Égida · Forma de venta de los productos de carta (08/11/2026)
-- Decisión de Anthony (06/11): las bebidas de reventa, los shots, las copas y las botellas son
-- productos de carta «de la manera más adecuada»: cada uno con una ficha automática de una sola
-- línea, para que pasen por el mismo cálculo que un cóctel (costo, teórico, cierre).
--   · PREPARADA: cóctel, jugo o plato con receta propia
--   · REVENTA:   se compra y se vende igual (cerveza, gaseosa, agua) → 1 und
--   · TRAGO:     shot de 60 ml de una botella
--   · COPA:      copa de 150 ml de una botella
--   · BOTELLA:   la botella entera
--   · COMBO:     varios productos de carta juntos (menús, promociones)
-- =====================================================================================

alter table public.genericos add column if not exists forma_venta text
  check (forma_venta in ('PREPARADA', 'REVENTA', 'TRAGO', 'COPA', 'BOTELLA', 'COMBO'));
comment on column public.genericos.forma_venta is
  'Cómo se vende un producto de carta. Null en insumos y MPI; los cócteles y platos son PREPARADA.';

update public.genericos set forma_venta = 'PREPARADA'
 where tipo in ('BEBIDA', 'PLATO') and forma_venta is null;

insert into public.parametros (clave, valor, descripcion) values
  ('ML_SHOT', '60', 'Mililitros de un shot de la carta (decisión de Anthony, 07/11/2026).'),
  ('ML_COPA_VINO', '150', 'Mililitros de una copa de vino de la carta (decisión de Anthony, 07/11/2026).')
on conflict do nothing;

insert into public.categorias (codigo, nombre, area, exige_sello, es_perecedero)
values ('BEBIDA_CARTA', 'Bebidas de carta (reventa, shots, copas y botellas)', 'BAR', false, false)
on conflict do nothing;
