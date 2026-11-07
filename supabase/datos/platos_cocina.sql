-- =====================================================================================
-- SGI Di Égida · Platos de la carta de cocina (genéricos PLATO), su precio de carta y su receta
-- Fuentes: referencia/Producto (product.template).xlsx (carta del TPV, 06/11/2026) y
-- referencia/Detalles de ventas.pdf (ventas 01/01–06/11/2026). Decisiones de Anthony (07/11/2026):
--   · Las versiones «gs», los combos (alas del mundial) y los menús Yuga no se tienen en cuenta.
--   · Ya no van: Sabores de Costa, Nono Incantesimo, Basmati con tofu, Carmesí de sol naciente,
--     Fuoco delle Driadi, Langostinos sorpresa y Mediterráneo carmesí.
--   · Ensalada Croissant (TPV) = Ensalada César del recetario (P045).
--   · Sandwiche Cuya es un postre de torta (no es el Sandwich de pera, P001).
--   · Platos nuevos que van a entrar (con receta, aún sin precio en el TPV): Dip de queso fundido,
--     Jalapeños rellenos, Tacos de chicharrón, Brochetas, Ensalada de queso Sellinguini, Torta de mora.
--   · «Carne con papas» del TPV es la receta Lomo con papas (P056).
-- 36 platos del TPV + 6 nuevos = 42. Código COC_PLA_ = el del TPV (COOK_PLA_…); N01… los nuevos;
-- X01 el que el TPV tiene sin código. Cinco llevan «(plato)» porque una MPI ya usa ese nombre.
-- La sección de la carta va en la nota («Carta: …»), como en las bebidas.
-- Enlaza cada plato con su receta del recetario de cocina (decisión de Anthony) y marca «sin
-- receta» los 10 que el recetario no trae. Nada se vuelve ficha: el chef aprueba en Validar.
-- Idempotente: no pisa nombres, precios ni enlaces que ya existan.
-- =====================================================================================

insert into public.categorias (codigo, nombre, area, exige_sello, es_perecedero)
values ('COC_PLATO', 'Platos de carta', 'COCINA', false, false)
on conflict do nothing;

with platos (codigo, nombre, seccion, tpv, precio, receta) as (values
  -- Entradas
  ('COC_PLA_1_002', 'Arancinis de la Tosca',                     'ENTRADA',   'ENTRADA Arancinis De la Tosca',                     47000, 'P049'),
  ('COC_PLA_1_007', 'Esperienza con Arancinis',                  'ENTRADA',   'ENTRADA Esperienza con Arancinis',                 100800, 'P030'),
  ('COC_PLA_1_008', 'Il Viaggio degli Arancinis',                'ENTRADA',   'ENTRADA il viaggio degli Arancinis',                86400, 'P031'),
  ('COC_PLA_1_004', 'Burrata Di la Nona',                        'ENTRADA',   'ENTRADA Burrata Di la Nona',                        64000, null),
  ('COC_PLA_1_009', 'Pulpo a la Gallega (plato)',                'ENTRADA',   'ENTRADA Pulpo a la Gallega',                       140400, 'P017'),
  ('COC_PLA_1_001', 'Albondigón (plato)',                        'ENTRADA',   'ENTRADA Albondigon',                                54000, null),
  ('COC_PLA_1_005', 'Calderino de Papas Gratinadas',             'ENTRADA',   'ENTRADA Calderino de papas gratinadas',             59400, 'PR035'),
  ('COC_PLA_1_011', 'Tortilla Española Di Égida',                'ENTRADA',   'ENTRADA Tortilla Española Di egida',                57600, 'P024'),
  ('COC_PLA_1_006', 'Champiñones al Queso',                      'ENTRADA',   'ENTRADA Champiñones al queso',                      93600, 'P050'),
  ('COC_PLA_1_003', 'Brusquetas Di Égida',                       'ENTRADA',   'ENTRADA Brusquetas Di Egida',                       82800, null),
  -- Principales
  ('COC_PLA_2_014', 'Lasagna Di Mare',                           'PRINCIPAL', 'PRINCIPAL Lasagna Di Mare',                        117000, 'P038'),
  ('COC_PLA_2_015', 'Mariscada en Cremoso de Coco',              'PRINCIPAL', 'PRINCIPAL Mariscada en Cremoso de Coco',           138600, 'P010'),
  ('COC_PLA_2_018', 'Onda di Mari',                              'PRINCIPAL', 'PRINCIPAL Onda di Mari',                           156600, 'PR011'),
  ('COC_PLA_2_003', 'Cántico de Ceres',                          'PRINCIPAL', 'PRINCIPAL Cantico de Ceres',                       140400, 'P051'),
  ('COC_PLA_2_021', 'Pastala Ra',                                'PRINCIPAL', 'PRINCIPAL Pastala Ra',                             100816, 'P037'),
  ('COC_PLA_2_001', 'Artemisa in Di Égida',                      'PRINCIPAL', 'PRINCIPAL Artemisa in Di Egida',                   127800, 'P039'),
  ('COC_PLA_2_020', 'Pasta di Ares',                             'PRINCIPAL', 'PRINCIPAL Pasta di Ares',                          106200, 'P033'),
  ('COC_PLA_2_019', 'Pasta a la Asesina',                        'PRINCIPAL', 'PRINCIPAL Pasta al Lassassina',                    113400, 'P055'),
  ('COC_PLA_2_017', 'Obsidiana en el Bosque',                    'PRINCIPAL', 'PRINCIPAL Obsidiana en el bosque',                 127800, 'P054'),
  ('COC_PLA_2_005', 'Controfiletto Di Égida',                    'PRINCIPAL', 'PRINCIPAL Controfiletto Di Égida',                 324000, 'P019'),
  ('COC_PLA_2_012', 'Gaia in Di Égida',                          'PRINCIPAL', 'PRINCIPAL Gaia in Di Egida',                       142200, 'P029'),
  ('COC_PLA_2_006', 'Cordon Bleu',                               'PRINCIPAL', 'PRINCIPAL Cordon Bleu',                            117000, 'P035'),
  ('COC_PLA_2_023', 'Pollo Tikka Masala en Jazmín',              'PRINCIPAL', 'PRINCIPAL Pollo Tikka Masala en Jasmin',           109800, 'P044'),
  ('COC_PLA_2_022', 'Pollo Colombiano',                          'PRINCIPAL', 'PRINCIPAL Pollo Colombiano',                       113400, 'P043'),
  ('COC_PLA_2_024', 'Rollo de Cerdo a la Naranja y Zanahoria',   'PRINCIPAL', 'PRINCIPAL Rollo de Cerdo a la naranja y zanahoria',127800, 'P034'),
  ('COC_PLA_2_007', 'Costillas de Cerdo al Dátil',               'PRINCIPAL', 'PRINCIPAL Costillas de Cerdo al Datil*',           216000, null),
  ('COC_PLA_2_008', 'Ensalada Cocote',                           'PRINCIPAL', 'PRINCIPAL Ensalada Cocote',                         38000, null),
  ('COC_PLA_2_009', 'Ensalada Croissant Di Égida',               'PRINCIPAL', 'PRINCIPAL Ensalada Croissant Di egida',             42000, 'P045'),
  ('COC_PLA_2_010', 'Ensalada Pancakes',                         'PRINCIPAL', 'PRINCIPAL Ensalada Pancakes',                       29000, null),
  ('COC_PLA_X01',   'Carne con Papas',                           'PRINCIPAL', 'carne con papas',                                  140000, 'P056'),
  -- Postres
  ('COC_PLA_3_005', 'Red Devil Roll',                            'POSTRE',    'POSTRE Red Devil Roll',                             32000, 'P041'),
  ('COC_PLA_3_007', 'Torta de Almendra y Café',                  'POSTRE',    'POSTRE Torta de Almendra y cafe',                   32000, null),
  ('COC_PLA_3_001', 'Flan de Caramelo (plato)',                  'POSTRE',    'POSTRE Flan de Caramelo',                           32000, 'P040'),
  ('COC_PLA_3_003', 'Napoleón de Oreo',                          'POSTRE',    'POSTRE Napoleon de Oreo',                           32000, null),
  ('COC_PLA_3_006', 'Sandwiche Cuya',                            'POSTRE',    'POSTRE Sandwiche Cuya',                             32000, null),
  ('COC_PLA_3_002', 'Fresas con Crema de Maracuyá',              'POSTRE',    'POSTRE Fresas con Crema de Maracuya',               32000, null),
  -- Nuevos (aún no están en el TPV)
  ('COC_PLA_N01',   'Dip de Queso Fundido con Chorizo y Habanero Dulce', 'ENTRADA', null, null, 'P008'),
  ('COC_PLA_N02',   'Jalapeños Rellenos',                        'ENTRADA',   null, null, 'P009'),
  ('COC_PLA_N03',   'Tacos de Chicharrón con Baba Ganoush y Piña Confitada', 'ENTRADA', null, null, 'P007'),
  ('COC_PLA_N04',   'Brochetas (plato)',                         'ENTRADA',   null, null, 'P011'),
  ('COC_PLA_N05',   'Ensalada de Queso Sellinguini',             'PRINCIPAL', null, null, 'P032'),
  ('COC_PLA_N06',   'Torta de Mora (plato)',                     'POSTRE',    null, null, 'P042')
),
genericos_nuevos as (
  insert into public.genericos (codigo, nombre, tipo, categoria, area, unidad_base, activo, nota, creado_por)
  select p.codigo, p.nombre, 'PLATO', 'COC_PLATO', 'COCINA', 'und', true,
         'Carta: ' || p.seccion || ' · ' || coalesce('TPV: ' || p.tpv, 'Nuevo: aún no está en el TPV') || ' · Alta 07/11/2026 (decisión de Anthony).', null
    from platos p
  on conflict (codigo) do nothing
  returning id, codigo
),
precios_nuevos as (
  insert into public.precios_venta (generico_id, precio_con_impuesto, vigente_desde, creado_por)
  select coalesce(n.id, g.id), p.precio, date '2026-11-06', null
    from platos p
    left join genericos_nuevos n on n.codigo = p.codigo
    left join public.genericos g on g.codigo = p.codigo
   where p.precio is not null
     and not exists (select 1 from public.precios_venta pv where pv.generico_id = coalesce(n.id, g.id))
  returning generico_id, precio_con_impuesto
)
insert into public.bitacora (accion, entidad, entidad_id, detalle)
select 'PRECIO DE CARTA', 'precios_venta', p.nombre,
       jsonb_build_object('precio', x.precio_con_impuesto, 'fuente', 'TPV · ' || p.tpv, 'carga', 'platos_cocina.sql')
  from precios_nuevos x
  join genericos_nuevos n on n.id = x.generico_id
  join platos p on p.codigo = n.codigo;

-- enlaces receta ↔ plato (solo donde la receta aún no tiene genérico y el plato no tiene receta)
with enlaces (receta, codigo) as (values
  ('P049', 'COC_PLA_1_002'), ('P030', 'COC_PLA_1_007'), ('P031', 'COC_PLA_1_008'), ('P017', 'COC_PLA_1_009'),
  ('PR035', 'COC_PLA_1_005'), ('P024', 'COC_PLA_1_011'), ('P050', 'COC_PLA_1_006'),
  ('P038', 'COC_PLA_2_014'), ('P010', 'COC_PLA_2_015'), ('PR011', 'COC_PLA_2_018'), ('P051', 'COC_PLA_2_003'),
  ('P037', 'COC_PLA_2_021'), ('P039', 'COC_PLA_2_001'), ('P033', 'COC_PLA_2_020'), ('P055', 'COC_PLA_2_019'),
  ('P054', 'COC_PLA_2_017'), ('P019', 'COC_PLA_2_005'), ('P029', 'COC_PLA_2_012'), ('P035', 'COC_PLA_2_006'),
  ('P044', 'COC_PLA_2_023'), ('P043', 'COC_PLA_2_022'), ('P034', 'COC_PLA_2_024'), ('P045', 'COC_PLA_2_009'),
  ('P056', 'COC_PLA_X01'), ('P041', 'COC_PLA_3_005'), ('P040', 'COC_PLA_3_001'),
  ('P008', 'COC_PLA_N01'), ('P009', 'COC_PLA_N02'), ('P007', 'COC_PLA_N03'), ('P011', 'COC_PLA_N04'),
  ('P032', 'COC_PLA_N05'), ('P042', 'COC_PLA_N06')
),
hechos as (
  update public.recetario_recetas r
     set generico_id = g.id, propuesto_id = g.id, similitud = 1, decidido_en = now()
    from enlaces e
    join public.genericos g on g.codigo = e.codigo and g.area = 'COCINA' and g.tipo = 'PLATO'
   where r.fuente = 'RECETARIO COCINA' and r.codigo = e.receta and r.clase = 'plato'
     and r.estado = 'PENDIENTE' and r.generico_id is null
     and not exists (select 1 from public.recetario_recetas o where o.fuente = r.fuente and o.generico_id = g.id)
  returning r.codigo, g.id
)
insert into public.bitacora (accion, entidad, entidad_id, detalle)
select 'RECETA ↔ PLATO', 'recetario_recetas', h.codigo,
       jsonb_build_object('fuente', 'CARTA COCINA', 'generico', h.id, 'carga', 'platos_cocina.sql', 'decision', 'Anthony 07/11/2026')
  from hechos h;

-- los que el recetario no trae: «sin receta» (la ficha la escribe el chef)
insert into public.mpi_revision (generico_id, estado, nota, decidido_por)
select g.id, 'SIN_RECETA', 'El recetario de cocina no trae su receta (07/11/2026).', null
  from public.genericos g
 where g.codigo in ('COC_PLA_1_004', 'COC_PLA_1_001', 'COC_PLA_1_003', 'COC_PLA_2_007', 'COC_PLA_2_008', 'COC_PLA_2_010',
                    'COC_PLA_3_007', 'COC_PLA_3_003', 'COC_PLA_3_006', 'COC_PLA_3_002')
   and privado.ficha_vigente(g.id) is null
   and not exists (select 1 from public.recetario_recetas r where r.generico_id = g.id)
on conflict (generico_id) do nothing;
