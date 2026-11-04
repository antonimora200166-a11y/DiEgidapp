-- =====================================================================================
-- SGI Di Égida · Zonas de la barra y qué producto va en cada una
-- Fuente: «Sectorización de la barra Di Égida» (Google Docs, 2026-11-04).
-- Cada área del documento que guarda inventario es una ubicación del kardex (como las COC_ de
-- cocina) y sus productos quedan en ubicacion_productos, en el orden del documento: es el
-- recorrido de la hoja de conteo. Un producto puede estar en más de una zona (la botella abierta
-- en la nevera y la de reserva en el exhibidor).
-- Las áreas que solo tienen menaje, herramientas o aseo (sin productos del catálogo) no se crean:
-- una zona sin asignados haría que la hoja de conteo mostrara todo el bar.
-- Idempotente: se puede volver a correr; actualiza nombres y orden, no borra nada.
-- =====================================================================================

insert into public.ubicaciones (codigo, nombre, area) values
  ('BAR_CG1S', 'Congelador · puerta 1 superior (izq.)', 'BAR'),
  ('BAR_CG1I', 'Congelador · puerta 1 inferior (izq.)', 'BAR'),
  ('BAR_CG2S', 'Congelador · puerta 2 superior (der.)', 'BAR'),
  ('BAR_CG2I', 'Congelador · puerta 2 inferior (der.)', 'BAR'),
  ('BAR_NOSC', 'Nevera octagonales · superior central', 'BAR'),
  ('BAR_NOSD', 'Nevera octagonales · superior derecha', 'BAR'),
  ('BAR_NOP1', 'Nevera octagonales · puerta 1 (izq.)', 'BAR'),
  ('BAR_NOP2', 'Nevera octagonales · puerta 2 (central)', 'BAR'),
  ('BAR_NOP3', 'Nevera octagonales · puerta 3 (der.)', 'BAR'),
  ('BAR_NE1S', 'Nevera ensamble · puerta 1 superior', 'BAR'),
  ('BAR_NE1I', 'Nevera ensamble · puerta 1 inferior', 'BAR'),
  ('BAR_NE2S', 'Nevera ensamble · puerta 2 superior', 'BAR'),
  ('BAR_NE2I', 'Nevera ensamble · puerta 2 inferior', 'BAR'),
  ('BAR_NE3S', 'Nevera ensamble · puerta 3 superior (bolsas al vacío)', 'BAR'),
  ('BAR_NE3I', 'Nevera ensamble · puerta 3 inferior', 'BAR'),
  ('BAR_NE4',  'Nevera ensamble · puerta 4', 'BAR'),
  ('BAR_STSI', 'Steward · entrepaño superior izquierdo', 'BAR'),
  ('BAR_STSD', 'Steward · entrepaño superior derecho', 'BAR'),
  ('BAR_STII', 'Steward · entrepaño inferior izquierdo', 'BAR'),
  ('BAR_STIC', 'Steward · inferior central', 'BAR'),
  ('BAR_EXI',  'Exhibidor colgante · izquierda (vinos)', 'BAR'),
  ('BAR_EXC',  'Exhibidor colgante · central (whisky, tequila, mezcal, vodka)', 'BAR'),
  ('BAR_EXD',  'Exhibidor colgante · derecha (ron, ginebra, licores)', 'BAR'),
  ('BAR_EXN',  'Exhibidor colgante · línea interior (alta rotación)', 'BAR'),
  ('BAR_MES',  'Mesón de mármol', 'BAR')
on conflict (codigo) do update set nombre = excluded.nombre, activo = true;

create temp table _zona (ubicacion text, codigo text, orden integer) on commit drop;

insert into _zona (ubicacion, codigo, orden) values
  -- 1 · Congelador
  ('BAR_CG1S', 'BAR_MPi_0021-GR', 1),   -- picadillo de sangría (reserva)
  ('BAR_CG1S', 'BAR_MPi_0058-GR', 2),   -- granita
  ('BAR_CG1S', 'BAR_MPi_0027-GR', 3),   -- picadillo green velvet
  ('BAR_CG1S', 'BAR_MPi_0022-GR', 4),   -- picadillo morfeo pee
  ('BAR_CG1I', 'BAR_MPi_0001-GR', 1),   -- súper zumo de limón al vacío
  ('BAR_CG2S', 'BAR_MPi_0051-GR', 1),   -- pulpa de maracuyá
  ('BAR_CG2S', 'BAR_MPi_0070-GR', 2),   -- porcionado de jugo de maracuyá
  ('BAR_CG2S', 'BAR_MPi_0071-GR', 3),   -- porcionado de mora
  ('BAR_CG2S', 'BAR_MPi_0069-GR', 4),   -- porcionado de fresa
  ('BAR_CG2S', 'BAR_MPe_0003-GR', 5),   -- arándano congelado
  ('BAR_CG2S', 'BAR_MPi_0018-GR', 6),   -- base scarlet kiss
  ('BAR_CG2S', 'BAR_MPi_0003-GR', 7),   -- zumo de naranja porcionado
  ('BAR_CG2S', 'BAR_MPe_0082-GR', 8),   -- mora congelada al granel
  ('BAR_CG2I', 'BAR_MPe_0203-PAQ3000', 1), -- bolsas de hielo
  -- 2 · Nevera larga octagonales
  ('BAR_NOSC', 'BAR_MPe_0150-700', 1),  -- absenta
  ('BAR_NOSC', 'BAR_MPe_0069-1000', 2), -- absolut 1000
  ('BAR_NOSC', 'BAR_MPe_0148-965', 3),  -- cachaça 51
  ('BAR_NOSC', 'BAR_MPe_0101-750', 4),  -- amaretto disaronno
  ('BAR_NOSC', 'BAR_MPe_0095-750', 5),  -- ancho reyes
  ('BAR_NOSC', 'BAR_MPe_0092-750', 6),  -- bacardí añejo
  ('BAR_NOSC', 'BAR_MPe_0102-1000', 7), -- baileys
  ('BAR_NOSC', 'BAR_MPe_0091-750', 8),  -- cinzano extra dry
  ('BAR_NOSC', 'BAR_MPe_0063-1000', 9), -- cinzano rosso
  ('BAR_NOSC', 'BAR_MPe_0100-700', 10), -- cointreau
  ('BAR_NOSC', 'BAR_MPe_0105-700', 11), -- pisco demonio de los andes
  ('BAR_NOSC', 'BAR_MPe_0155-750', 12), -- dubonnet
  ('BAR_NOSC', 'BAR_MPe_0108-700', 13), -- beefeater pink
  ('BAR_NOSC', 'BAR_MPe_0149-750', 14), -- jerez tío pepe
  ('BAR_NOSC', 'BAR_MPe_0028-700', 15), -- licor de café coloma
  ('BAR_NOSC', 'BAR_MPe_0096-750', 16), -- licor de durazno
  ('BAR_NOSC', 'BAR_MPe_0098-700', 17), -- soho lychee
  ('BAR_NOSC', 'BAR_MPe_0151-750', 18), -- convier maracuyá
  ('BAR_NOSC', 'BAR_MPe_0097-700', 19), -- limoncello villa massa
  ('BAR_NOSC', 'BAR_MPe_0087-700', 20), -- olmeca chocolate
  ('BAR_NOSC', 'BAR_MPe_0152-700', 21), -- pastis ricard
  ('BAR_NOSC', 'BAR_MPe_0159-750', 22), -- ron flor de caña
  ('BAR_NOSD', 'BAR_MPi_0001-GR', 1),   -- zumo de limón embotellado
  ('BAR_NOSD', 'BAR_MPi_0006-GR', 2),   -- sirope simple embotellado
  ('BAR_NOP1', 'BAR_MPe_0181-330', 1),  -- delirium nocturnum
  ('BAR_NOP1', 'BAR_MPe_0182-330', 2),  -- delirium tremens
  ('BAR_NOP1', 'BAR_MPe_0183-330', 3),  -- floris framboise
  ('BAR_NOP1', 'BAR_MPe_0184-330', 4),  -- stella
  ('BAR_NOP1', 'BAR_MPe_0179-330', 5),  -- corona
  ('BAR_NOP1', 'BAR_MPe_0180-300', 6),  -- club colombia rubia
  ('BAR_NOP2', 'BAR_MPe_0186-300', 1),  -- coca cola zero
  ('BAR_NOP2', 'BAR_MPe_0185-300', 2),  -- coca cola original
  ('BAR_NOP2', 'BAR_MPe_0178-300', 3),  -- agua con gas
  ('BAR_NOP2', 'BAR_MPe_0177-300', 4),  -- agua sin gas
  ('BAR_NOP2', 'BAR_MPe_0202-BOTELLA300ML', 5), -- agua hatsu
  ('BAR_NOP2', 'BAR_MPe_0200-BOTELLA', 6), -- gatorade
  ('BAR_NOP2', 'BAR_MPe_0201-LATA250ML', 7), -- red bull
  ('BAR_NOP2', 'BAR_MPe_0190-L250', 8), -- jp chenet enlatados
  ('BAR_NOP2', 'BAR_MPe_0191-L250', 9),
  ('BAR_NOP2', 'BAR_MPe_0192-L250', 10),
  ('BAR_NOP2', 'BAR_MPe_0193-L250', 11),
  ('BAR_NOP2', 'BAR_MPe_0194-L250', 12),
  ('BAR_NOP2', 'BAR_MPe_0120-L250', 13),
  ('BAR_NOP2', 'BAR_MPe_0121-L269', 14), -- bbc rosé
  ('BAR_NOP2', 'BAR_MPe_0121-339', 15),
  ('BAR_NOP2', 'BAR_MPe_0199-BOTELLA300ML', 16), -- mítica pale lager
  ('BAR_NOP2', 'BAR_MPe_0198-BOTELLA300ML', 17), -- mítica easy lager
  ('BAR_NOP3', 'BAR_MPe_0118-330', 1),  -- 1976 manzana
  ('BAR_NOP3', 'BAR_MPe_0117-330', 2),  -- 1976 ocean
  ('BAR_NOP3', 'BAR_MPe_0116-330', 3),  -- 1976 pink
  ('BAR_NOP3', 'BAR_MPe_0189-330', 4),  -- 1976 tamarindo
  ('BAR_NOP3', 'BAR_MPe_0058-BOT300', 5), -- soda bretaña
  ('BAR_NOP3', 'BAR_MPe_0115-330', 6),  -- ginger beer mil976
  ('BAR_NOP3', 'BAR_MPe_0114-BOT300', 7), -- ginger canada dry
  -- 3 · Nevera principal ensamble
  ('BAR_NE1S', 'BAR_MPi_0044-GR', 1),   -- cerezas maceradas en vermouth
  ('BAR_NE1S', 'BAR_MPi_0047-GR', 2),   -- garnitura de limón
  ('BAR_NE1S', 'BAR_MPi_0043-GR', 3),   -- láminas de jengibre
  ('BAR_NE1S', 'BAR_MPi_0048-GR', 4),   -- fideos de naranja
  ('BAR_NE1S', 'BAR_MPe_0124-GR', 5),   -- aceitunas deshuesadas
  ('BAR_NE1S', 'BAR_MPi_0006-GR', 6),   -- botellón sirope simple
  ('BAR_NE1I', 'BAR_MPi_0029-GR', 1),   -- licor de granadilla
  ('BAR_NE1I', 'BAR_MPi_0039-GR', 2),   -- licor de jamaica
  ('BAR_NE1I', 'BAR_MPi_0042-GR', 3),   -- licor de limoncillo
  ('BAR_NE1I', 'BAR_MPi_0033-GR', 4),   -- licor de manzanilla
  ('BAR_NE1I', 'BAR_MPi_0036-GR', 5),   -- licor de menta fresca
  ('BAR_NE1I', 'BAR_MPi_0030-GR', 6),   -- licor de vainilla
  ('BAR_NE1I', 'BAR_MPi_0068-GR', 7),   -- clarificado piña/romero
  ('BAR_NE1I', 'BAR_MPi_0067-GR', 8),   -- infusión gin/clitoria
  ('BAR_NE1I', 'BAR_MPi_0066-GR', 9),   -- mezcla base di fiore
  ('BAR_NE1I', 'BAR_MPi_0012-GR', 10),  -- mix de cítricos
  ('BAR_NE1I', 'BAR_MPi_0020-GR', 11),  -- sirope de chamoy
  ('BAR_NE1I', 'BAR_MPi_0038-GR', 12),  -- sirope de flor de jamaica
  ('BAR_NE1I', 'BAR_MPi_0007-GR', 13),  -- sirope de jengibre
  ('BAR_NE1I', 'BAR_MPi_0011-GR', 14),  -- sirope de romero
  ('BAR_NE1I', 'BAR_MPi_0016-GR', 15),  -- sirope de tamarindo
  ('BAR_NE1I', 'BAR_MPi_0028-GR', 16),  -- sirope green velvet
  ('BAR_NE1I', 'BAR_MPi_0023-GR', 17),  -- sirope morfeo pee
  ('BAR_NE1I', 'BAR_MPi_0017-GR', 18),  -- sirope pine fizz
  ('BAR_NE1I', 'BAR_MPi_0006-GR', 19),  -- sirope simple
  ('BAR_NE1I', 'BAR_MPi_0014-GR', 20),  -- sirope stella di mango
  ('BAR_NE1I', 'BAR_MPi_0015-GR', 21),  -- sirope stella di rosso
  ('BAR_NE1I', 'BAR_MPi_0013-GR', 22),  -- sirope stella du solei
  ('BAR_NE2S', 'BAR_MPe_0012-GR', 1),   -- cerezas en almíbar
  ('BAR_NE2S', 'BAR_MPe_0029-GR', 2),   -- limón lima en rodajas
  ('BAR_NE2S', 'BAR_MPe_0042-CJA', 3),  -- bandeja de menta francesa
  ('BAR_NE2S', 'BAR_MPe_0072-GR', 4),   -- bandeja de arándanos
  ('BAR_NE2I', 'BAR_MPe_0111-750', 1),  -- rosaleda rosé
  ('BAR_NE2I', 'BAR_MPe_0112-750', 2),  -- rosaleda sauvignon blanc
  ('BAR_NE2I', 'BAR_MPe_0113-750', 3),  -- rosaleda merlot
  ('BAR_NE2I', 'BAR_MPe_0109-750', 4),  -- mionetto prosecco
  ('BAR_NE3S', 'BAR_MPi_0029-GR', 1),   -- bolsas al vacío (reserva)
  ('BAR_NE3S', 'BAR_MPi_0039-GR', 2),
  ('BAR_NE3S', 'BAR_MPi_0042-GR', 3),
  ('BAR_NE3S', 'BAR_MPi_0036-GR', 4),
  ('BAR_NE3S', 'BAR_MPi_0033-GR', 5),
  ('BAR_NE3S', 'BAR_MPi_0030-GR', 6),
  ('BAR_NE3S', 'BAR_MPi_0067-GR', 7),
  ('BAR_NE3S', 'BAR_MPi_0012-GR', 8),
  ('BAR_NE3S', 'BAR_MPi_0020-GR', 9),
  ('BAR_NE3S', 'BAR_MPi_0007-GR', 10),
  ('BAR_NE3S', 'BAR_MPi_0016-GR', 11),
  ('BAR_NE3S', 'BAR_MPi_0028-GR', 12),
  ('BAR_NE3S', 'BAR_MPi_0023-GR', 13),
  ('BAR_NE3S', 'BAR_MPi_0017-GR', 14),
  ('BAR_NE3S', 'BAR_MPi_0068-GR', 15),
  ('BAR_NE3S', 'BAR_MPi_0014-GR', 16),
  ('BAR_NE3S', 'BAR_MPi_0015-GR', 17),
  ('BAR_NE3S', 'BAR_MPi_0013-GR', 18),
  ('BAR_NE3S', 'BAR_MPi_0066-GR', 19),
  ('BAR_NE3I', 'BAR_MPe_0056-GR', 1),   -- romero
  ('BAR_NE3I', 'BAR_MPe_0047-GR', 2),   -- naranja
  ('BAR_NE3I', 'BAR_MPe_0048-GR', 3),   -- naranja importada
  ('BAR_NE3I', 'BAR_MPe_0030-GR', 4),   -- limón tahití
  ('BAR_NE3I', 'BAR_MPe_0029-GR', 5),   -- limón lima
  ('BAR_NE3I', 'BAR_SC_0001-ML', 6),    -- decanters y bidones de agua hervida
  ('BAR_NE4',  'BAR_SC_0001-ML', 1),    -- decanters de agua para los comensales
  -- 4 · Zona de steward
  ('BAR_STSI', 'BAR_MPe_0062-UND', 1),  -- vaina de vainilla
  ('BAR_STSI', 'BAR_MPe_0065-ML', 2),   -- vinagre de frutas
  ('BAR_STSI', 'BAR_MPe_0066-ML', 3),   -- vinagre de manzana
  ('BAR_STSI', 'BAR_MPe_0051-GR', 4),   -- pimienta negra (en el catálogo: «Pimienta (por definir)»)
  ('BAR_STSI', 'BAR_MPe_0067-ML', 5),   -- vinagre de vino
  ('BAR_STSI', 'BAR_MPe_0008-UND', 6),  -- cargas para sifón
  ('BAR_STSI', 'BAR_MPe_0127-GR', 7),   -- molino de sal rosada
  ('BAR_STSI', 'BAR_MPe_0131-PC', 8),   -- gotas amargas de naranja
  ('BAR_STSI', 'BAR_MPe_0077-GR', 9),   -- flor de clitoria
  ('BAR_STSI', 'BAR_MPe_0055-GR', 10),  -- matizante polvo dorado
  ('BAR_STSI', 'BAR_MPe_0015-ML', 11),  -- colorante comestible verde
  ('BAR_STSI', 'BAR_MPe_0014-GR', 12),  -- clavo de olor
  ('BAR_STSD', 'BAR_MPe_0005-PAQ2500', 1), -- azúcar para servicio
  ('BAR_STSD', 'BAR_MPe_0057-GR', 2),   -- sal para servicio
  ('BAR_STSD', 'BAR_MPi_0046-GR', 3),   -- sal de fresa
  ('BAR_STII', 'BAR_MPe_0001-PAQ1000', 1), -- ácido cítrico
  ('BAR_STII', 'BAR_MPe_0071-GR', 2),   -- ácido ascórbico
  ('BAR_STII', 'BAR_MPe_0006-GR', 3),   -- azúcar glass
  ('BAR_STII', 'BAR_MPe_0005-PAQ2500', 4), -- azúcar blanca
  ('BAR_STII', 'BAR_MPe_0007-GR', 5),   -- azúcar morena
  ('BAR_STII', 'BAR_MPi_0062-GR', 6),   -- fruta deshidratada
  ('BAR_STII', 'BAR_MPi_0059-GR', 7),
  ('BAR_STII', 'BAR_MPi_0082-GR', 8),
  ('BAR_STII', 'BAR_MPi_0060-GR', 9),
  ('BAR_STII', 'BAR_MPi_0061-GR', 10),
  ('BAR_STII', 'BAR_MPi_0063-GR', 11),
  ('BAR_STII', 'BAR_MPe_0075-GR', 12),
  ('BAR_STII', 'BAR_MPe_0076-GR', 13),
  ('BAR_STIC', 'BAR_MPe_0001-PAQ1000', 1), -- el documento repite aquí la lista del inferior izquierdo
  ('BAR_STIC', 'BAR_MPe_0071-GR', 2),
  ('BAR_STIC', 'BAR_MPe_0006-GR', 3),
  ('BAR_STIC', 'BAR_MPe_0005-PAQ2500', 4),
  ('BAR_STIC', 'BAR_MPe_0007-GR', 5),
  ('BAR_STIC', 'BAR_MPi_0062-GR', 6),
  ('BAR_STIC', 'BAR_MPi_0059-GR', 7),
  ('BAR_STIC', 'BAR_MPi_0082-GR', 8),
  ('BAR_STIC', 'BAR_MPi_0060-GR', 9),
  ('BAR_STIC', 'BAR_MPi_0061-GR', 10),
  ('BAR_STIC', 'BAR_MPi_0063-GR', 11),
  ('BAR_STIC', 'BAR_MPe_0075-GR', 12),
  ('BAR_STIC', 'BAR_MPe_0076-GR', 13),
  -- 9 · Mesón de mármol
  ('BAR_MES',  'BAR_MPe_0109-750-PICCINIPROSE', 1), -- piccini extra dry de exhibición
  ('BAR_MES',  'BAR_MPe_0068-750', 2),  -- mar de frades albariño de exhibición
  ('BAR_MES',  'BAR_MPi_0062-GR', 3),   -- frascos con deshidratados
  ('BAR_MES',  'BAR_MPi_0059-GR', 4),
  ('BAR_MES',  'BAR_MPi_0082-GR', 5),
  ('BAR_MES',  'BAR_MPi_0060-GR', 6),
  ('BAR_MES',  'BAR_MPi_0061-GR', 7),
  ('BAR_MES',  'BAR_MPi_0063-GR', 8);

-- 7 · Exhibidor colgante: va por categoría (el documento no lista botellas)
insert into _zona (ubicacion, codigo, orden)
select z, p.codigo, (row_number() over (partition by z order by g.nombre, p.codigo))::integer + 100
  from public.productos p
  join public.genericos g on g.id = p.generico_id
  cross join lateral (select case
      when g.categoria = 'VINO' and g.nombre ilike '%rosaleda%' then 'BAR_EXN'
      when g.categoria = 'VINO' then 'BAR_EXI'
      when g.categoria = 'LICOR' and g.nombre ~* '^(whisky|tequila|mezcal|vodka)' then 'BAR_EXC'
      when g.categoria = 'LICOR' then 'BAR_EXD'
    end as z) c
 where g.area = 'BAR' and p.activo and g.activo and c.z is not null;

do $$
declare v text;
begin
  select string_agg(distinct z.codigo, ', ') into v
    from _zona z left join public.productos p on p.codigo = z.codigo where p.id is null;
  if v is not null then raise exception 'Códigos de producto que no están en el catálogo: %', v; end if;
end $$;

insert into public.ubicacion_productos (ubicacion, producto_id, orden)
select z.ubicacion, p.id, min(z.orden)
  from _zona z join public.productos p on p.codigo = z.codigo
 group by z.ubicacion, p.id
on conflict (ubicacion, producto_id) do update set orden = excluded.orden, activo = true;
