-- Datos de prueba compartidos. Se incluyen con \ir dentro de la transacción de cada
-- prueba y desaparecen con su ROLLBACK. La extensión .inc evita que pg_prove la corra sola.

-- usuarios y perfiles
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'admin@prueba.test'),
  ('a0000000-0000-0000-0000-000000000002', 'jefe.bar@prueba.test'),
  ('a0000000-0000-0000-0000-000000000003', 'aux.bar@prueba.test'),
  ('a0000000-0000-0000-0000-000000000004', 'servicio@prueba.test'),
  ('a0000000-0000-0000-0000-000000000005', 'chef@prueba.test');

insert into public.perfiles (id, nombre, rol, areas) values
  ('a0000000-0000-0000-0000-000000000001', 'Admin Prueba', 'admin', '{}'),
  ('a0000000-0000-0000-0000-000000000002', 'Jefe Bar Prueba', 'jefe_bar', '{BAR}'),
  ('a0000000-0000-0000-0000-000000000003', 'Aux Bar Prueba', 'aux_bar', '{BAR}'),
  ('a0000000-0000-0000-0000-000000000004', 'Servicio Prueba', 'servicio', '{BAR}'),
  ('a0000000-0000-0000-0000-000000000005', 'Chef Prueba', 'chef', '{COCINA}');

-- ubicaciones y categorías
insert into public.ubicaciones (codigo, nombre, area) values
  ('BAR_BODEGA', 'Bodega de bar', 'BAR'),
  ('BAR_BARRA', 'Barra', 'BAR'),
  ('COC_BODEGA', 'Bodega de cocina', 'COCINA');

insert into public.categorias (codigo, nombre, area, exige_sello, es_perecedero) values
  ('LICOR', 'Licores', 'BAR', true, false),
  ('FRUVER', 'Frutas y verduras', 'BAR', false, true),
  ('INSUMO_SECO', 'Insumos secos', 'BAR', false, false),
  ('MPI', 'Producción propia', 'BAR', false, true),
  ('AGUA', 'Agua', 'BAR', false, false),
  ('COCTEL', 'Coctelería', 'BAR', false, false);

-- genéricos
insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base) values
  ('b0000000-0000-0000-0000-000000000001', 'BAR_MPe_0079', 'Ginebra Tanqueray', 'MPe', 'LICOR', 'BAR', 'ml'),
  ('b0000000-0000-0000-0000-000000000002', 'BAR_MPe_0005', 'Azúcar blanca', 'MPe', 'INSUMO_SECO', 'BAR', 'g'),
  ('b0000000-0000-0000-0000-000000000003', 'BAR_MPe_0030', 'Limón Tahití', 'MPe', 'FRUVER', 'BAR', 'g'),
  ('b0000000-0000-0000-0000-000000000004', 'BAR_MPi_0006', 'Sirope Simple', 'MPI', 'MPI', 'BAR', 'g'),
  ('b0000000-0000-0000-0000-000000000005', 'BAR_SC_0001', 'Agua', 'SIN_COSTO', 'AGUA', 'BAR', 'ml'),
  ('b0000000-0000-0000-0000-000000000006', 'BAR_MPe_0011', 'Cardamomo', 'MPe', 'INSUMO_SECO', 'BAR', 'g'),
  ('b0000000-0000-0000-0000-000000000007', 'BAR_COC_C99', 'Gin Sour', 'BEBIDA', 'COCTEL', 'BAR', 'und'),
  ('b0000000-0000-0000-0000-000000000008', 'BAR_MPi_0099', 'Limonada base', 'MPI', 'MPI', 'BAR', 'g');

-- productos (código del kardex)
insert into public.productos (id, codigo, generico_id, marca, presentacion, unidad_compra, contenido_base) values
  ('c0000000-0000-0000-0000-000000000001', 'BAR_MPe_0079-700', 'b0000000-0000-0000-0000-000000000001', 'Tanqueray', 'Botella 700 ml', 'BOT', 700),
  ('c0000000-0000-0000-0000-000000000002', 'BAR_MPe_0005-2500', 'b0000000-0000-0000-0000-000000000002', 'Manuelita', 'Bolsa 2.500 g', 'PAQ', 2500),
  ('c0000000-0000-0000-0000-000000000003', 'BAR_MPe_0030-KG', 'b0000000-0000-0000-0000-000000000003', '', 'Granel', 'KG', 1000),
  ('c0000000-0000-0000-0000-000000000004', 'BAR_MPi_0006-G', 'b0000000-0000-0000-0000-000000000004', 'Di Égida', 'Granel', 'GR', 1),
  ('c0000000-0000-0000-0000-000000000005', 'BAR_SC_0001-ML', 'b0000000-0000-0000-0000-000000000005', '', 'Llave', 'ML', 1),
  ('c0000000-0000-0000-0000-000000000006', 'BAR_MPe_0011-G', 'b0000000-0000-0000-0000-000000000006', '', 'Granel', 'GR', 1),
  ('c0000000-0000-0000-0000-000000000008', 'BAR_MPi_0099-G', 'b0000000-0000-0000-0000-000000000008', 'Di Égida', 'Granel', 'GR', 1);

insert into public.proveedores (id, nombre) values
  ('d0000000-0000-0000-0000-000000000001', 'Dislicores'),
  ('d0000000-0000-0000-0000-000000000002', 'Frutería');

-- Actuar como un usuario dentro de la transacción de la prueba (sin cambiar de rol de BD).
create or replace function pg_temp.como(p_usuario uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_usuario, 'role', 'authenticated')::text, true)
$$;
