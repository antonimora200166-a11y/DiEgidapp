-- =====================================================================================
-- SGI Di Égida · Precios de carta de las bebidas de bar (con impuesto incluido)
-- Fuente: referencia/Producto (product.template).xlsx — exportación del TPV, entregada por
-- Anthony el 06/11/2026. Decisiones de Anthony sobre lo que el TPV no resolvía:
--   · Scarlet Kiss: $57.000 (el TPV la tenía dos veces, $55.000 y $57.000).
--   · Fairy Blood (copa): $55.000 como las demás copas (el TPV decía $200.000, igual que la jarra).
--   · Caipiriña y Manhattan (no están en el TPV): $45.000 como las demás clásicas.
--   · Sangría Vainilla (copa) (no está en el TPV): $55.000 como las demás copas.
-- Entra solo en las bebidas que todavía no tienen ningún precio: no pisa uno puesto desde la app.
-- Idempotente.
-- =====================================================================================

with precios (codigo, precio, origen) as (values
  -- Clásicas
  ('BAR_BEB_C01', 45000, 'TPV · Clasica Margarita'),
  ('BAR_BEB_C02', 48000, 'TPV · Clasica Negroni'),
  ('BAR_BEB_C03', 45000, 'TPV · Clasica Mojito'),
  ('BAR_BEB_C04', 45000, 'TPV · Clasica Pisco Sour'),
  ('BAR_BEB_C05', 45000, 'TPV · Clasica Tom Collins'),
  ('BAR_BEB_C06', 45000, 'TPV · Clasica Dry Martini'),
  ('BAR_BEB_C07', 45000, 'TPV · Clasica Cosmopolitan'),
  ('BAR_BEB_C08', 45000, 'TPV · Clasica Aperol Spritz'),
  ('BAR_BEB_C09', 45000, 'TPV · Clasica Old Fashioned'),
  ('BAR_BEB_C10', 45000, 'TPV · Clasica Moscow mule'),
  ('BAR_BEB_C11', 45000, 'TPV · Clasica Gin And Tonic'),
  ('BAR_BEB_C12', 45000, 'TPV · Clasica Lychee Martini'),
  ('BAR_BEB_C13', 45000, 'Decisión de Anthony: como las demás clásicas (no está en el TPV)'),
  ('BAR_BEB_C14', 45000, 'Decisión de Anthony: como las demás clásicas (no está en el TPV)'),
  ('BAR_BEB_C15', 45000, 'TPV · Clasica Orgasmo'),
  -- Mocktails
  ('BAR_BEB_C16', 22000, 'TPV · moktel''s Stella Di Fiore'),
  ('BAR_BEB_C17', 18000, 'TPV · moktel''s Stella Du Solei'),
  ('BAR_BEB_C18', 18000, 'TPV · moktel''s Stella Di Mango'),
  ('BAR_BEB_C19', 18000, 'TPV · moktel''s Stella Di Rosso'),
  ('BAR_BEB_C20', 22000, 'TPV · moktel''s Stella Di Lychee'),
  -- Sangrías
  ('BAR_BEB_C21C', 55000, 'TPV · Copa de Sangria de chocolate'),
  ('BAR_BEB_C21J', 180000, 'TPV · Jarra Sangría De Chocolate'),
  ('BAR_BEB_C22C', 55000, 'Decisión de Anthony: como las demás copas (no está en el TPV)'),
  ('BAR_BEB_C22J', 200000, 'TPV · Jarra Sangria De Vainillia'),
  ('BAR_BEB_C23C', 55000, 'TPV · Copa de Sangria Morfeo Pee'),
  ('BAR_BEB_C23J', 200000, 'TPV · Jarra de Sangria Morfeo Pee'),
  ('BAR_BEB_C24C', 55000, 'Decisión de Anthony: como las demás copas (el TPV decía $200.000)'),
  ('BAR_BEB_C24J', 200000, 'TPV · Jarra de Sangria Fairy Blood'),
  ('BAR_BEB_C25C', 55000, 'TPV · Copa de Sangria Green Velvet'),
  ('BAR_BEB_C25J', 200000, 'TPV · Jarra de Sangria Green Velvet'),
  -- Mimosas Di Égida
  ('BAR_BEB_C26', 55000, 'TPV · Mimosa Di Egida Nettare Di Carnale'),
  ('BAR_BEB_C27', 55000, 'TPV · Mimosa Di Egida Mimosa De Fuego'),
  ('BAR_BEB_C28', 55000, 'TPV · Mimosa Di Egida Mimosa De Agua'),
  ('BAR_BEB_C29', 55000, 'TPV · Mimosa Di Egida Mimosa De Viento'),
  ('BAR_BEB_C30', 55000, 'TPV · Mimosa Di Egida Mimosa De Tierra'),
  -- Coctelería de autor
  ('BAR_BEB_C31', 60000, 'TPV · Coctelería De Autor Azurro Abisale'),
  ('BAR_BEB_C32', 55000, 'TPV · Coctelería De Autor Brisa De Jazmin'),
  ('BAR_BEB_C33', 55000, 'TPV · Coctelería De Autor Manzanilla Royale'),
  ('BAR_BEB_C34', 55000, 'TPV · Coctelería De Autor Golden Pinefizz'),
  ('BAR_BEB_C35', 57000, 'TPV · Cocteleria de Autor Skarlet kiss (decisión de Anthony)'),
  ('BAR_BEB_C36', 55000, 'TPV · Coctelería De Autor Jamaitini'),
  ('BAR_BEB_C37', 55000, 'TPV · Coctelería De Autor Pinky Promise'),
  ('BAR_BEB_C38', 57000, 'TPV · Coctelería De Autor Loomp'),
  ('BAR_BEB_C39', 60000, 'TPV · Coctelería De Autor Sour Café Almendrado'),
  ('BAR_BEB_C40', 60000, 'TPV · Coctelería De Autor Menjurge De Las Driades'),
  ('BAR_BEB_C41', 57000, 'TPV · Coctelería De Autor Il Donno De Apolo'),
  ('BAR_BEB_C42', 65000, 'TPV · Coctelería De Autor Alcabullet'),
  ('BAR_BEB_C43', 60000, 'TPV · Coctelería De Autor Imperatore Mexica'),
  -- Birras envenenadas
  ('BAR_BEB_C44', 45000, 'TPV · Birras Envenenadas Birra Primaveral'),
  ('BAR_BEB_C45', 45000, 'TPV · Birras Envenenadas Birra Al Tamarindo')
),
nuevos as (
  insert into public.precios_venta (generico_id, precio_con_impuesto, vigente_desde, creado_por)
  select g.id, p.precio, date '2026-11-06', null
  from precios p
  join public.genericos g on g.codigo = p.codigo and g.area = 'BAR' and g.tipo = 'BEBIDA' and g.activo
  where not exists (select 1 from public.precios_venta pv where pv.generico_id = g.id)
  returning generico_id, precio_con_impuesto
)
insert into public.bitacora (accion, entidad, entidad_id, detalle)
select 'PRECIO DE CARTA', 'precios_venta', g.nombre,
       jsonb_build_object('precio', n.precio_con_impuesto, 'fuente', p.origen, 'carga', 'precios_venta_bar.sql')
from nuevos n
join public.genericos g on g.id = n.generico_id
join precios p on p.codigo = g.codigo;
