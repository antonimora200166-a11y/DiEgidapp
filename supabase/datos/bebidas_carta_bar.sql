-- =====================================================================================
-- SGI Di Égida · Bebidas de carta del bar que no son cócteles: reventa, shots, copas, botellas
-- y bebidas preparadas sin receta todavía (08/11/2026).
-- Fuente: referencia/Producto (product.template).xlsx (carta del TPV, entregada por Anthony el
-- 06/11/2026), solo lo que tiene precio de venta. Decisiones de Anthony:
--   · Cada una es un producto de carta con ficha automática de UNA línea (06/11): reventa = 1 und
--     del insumo; shot = 60 ml; copa de vino = 150 ml (07/11); botella = su contenido.
--   · El precio de carta es el del TPV (con impoconsumo).
-- Supuestos para revisar (van en la nota de cada uno):
--   · Vino de la casa: tinto = Rosaleda Merlot, blanco = Rosaleda Sauvignon Blanc, rosado = Rosaleda Rosé.
--   · «José Cuervo Reposado» del TPV = Tequila José Cuervo Especial del catálogo.
--   · «Morandé Reserva Cabernet» = Morandé Pionero Cabernet Sauvignon; «Mar de Frades» = Vino blanco Albariño.
--   · Monkey Shoulder: $365.600 la de 700 ml y $423.000 la de 1.000 ml.
-- Sin ficha (el insumo no está en el catálogo o falta la receta): jugos, limonadas, gin tonic
-- premium, whiskey sour, old fashioned premium, envenenados, Mil976 Manzana y Soda, Aguardiente
-- Origen Nocturno, Olmeca Blanco, Moët Ice Imperial, Piccini Extra Dry, JP Chenet, Trapiche
-- Medalla Malbec, Tarapacá Rosé y Joven Cabernet. Salen en Carta y margen como «Sin ficha».
-- Duplicados del TPV que no se crean: «1976 Manzana - no», «Aguardiente cumbe premium (copia)»,
-- «Shot tequila Olmeca reposado eliminar» y el segundo «Shot vodka absolut».
-- Idempotente: no pisa nombres, fichas ni precios que ya existan.
-- =====================================================================================

create temp table _bebidas (
  codigo text, nombre text, seccion text, forma text, tpv text, precio numeric,
  insumo text, cantidad numeric, unidad text, nota text
) on commit drop;

insert into _bebidas values
  -- Cervezas (reventa: 1 und)
  ('BAR_BEB_R01', 'Cerveza Corona (venta)',              'CERVEZA', 'REVENTA', 'Cerveza Corona',                 16000, 'BAR_MPe_0179', 1, 'und', null),
  ('BAR_BEB_R02', 'Cerveza Stella Artois (venta)',       'CERVEZA', 'REVENTA', 'Cerveza Stella',                 18000, 'BAR_MPe_0184', 1, 'und', null),
  ('BAR_BEB_R03', 'Cerveza Club Colombia Rubia (venta)', 'CERVEZA', 'REVENTA', 'Club Rubia',                     16000, 'BAR_MPe_0180', 1, 'und', null),
  ('BAR_BEB_R04', 'Cerveza Mítica Easy Lager (venta)',   'CERVEZA', 'REVENTA', 'Cerveza mitica easy lager x300', 15000, 'BAR_MPe_0198', 1, 'und', null),
  ('BAR_BEB_R05', 'Cerveza Mítica Pale Lager (venta)',   'CERVEZA', 'REVENTA', 'Cerveza mítica pale lager x300', 15000, 'BAR_MPe_0199', 1, 'und', null),
  ('BAR_BEB_R06', 'Cerveza BBC Roja (venta)',            'CERVEZA', 'REVENTA', 'Bbc Roja',                       17000, 'BAR_MPe_0122', 1, 'und', null),
  ('BAR_BEB_R07', 'Cerveza BBC Rosé (venta)',            'CERVEZA', 'REVENTA', 'Bbc Rose',                       17000, 'BAR_MPe_0121', 1, 'und', null),
  ('BAR_BEB_R08', 'Cerveza Delirium Nocturnum (venta)',  'CERVEZA', 'REVENTA', 'Delirium Nocturnum',             60000, 'BAR_MPe_0181', 1, 'und', null),
  ('BAR_BEB_R09', 'Cerveza Delirium Tremens (venta)',    'CERVEZA', 'REVENTA', 'Delirium Tremens',               42000, 'BAR_MPe_0182', 1, 'und', null),
  ('BAR_BEB_R10', 'Cerveza Floris Framboise (venta)',    'CERVEZA', 'REVENTA', 'Florise Framboise',              40000, 'BAR_MPe_0183', 1, 'und', null),
  -- Gaseosas, aguas y mezcladores (reventa)
  ('BAR_BEB_R21', 'Coca Cola (venta)',                   'GASEOSAS Y AGUAS', 'REVENTA', 'Coca Cola',              8000, 'BAR_MPe_0185', 1, 'und', null),
  ('BAR_BEB_R22', 'Coca Cola Zero (venta)',              'GASEOSAS Y AGUAS', 'REVENTA', 'Coca Cola Zero',         8000, 'BAR_MPe_0186', 1, 'und', null),
  ('BAR_BEB_R23', 'Agua Manantial con Gas (venta)',      'GASEOSAS Y AGUAS', 'REVENTA', 'Agua Manantial con Gas', 8000, 'BAR_MPe_0178', 1, 'und', null),
  ('BAR_BEB_R24', 'Agua Manantial sin Gas (venta)',      'GASEOSAS Y AGUAS', 'REVENTA', 'Agua Manantial sin Gas', 8000, 'BAR_MPe_0177', 1, 'und', null),
  ('BAR_BEB_R25', 'Soda Schweppes (venta)',              'GASEOSAS Y AGUAS', 'REVENTA', 'Soda Swepers',           8000, 'BAR_MPe_0188', 300, 'ml', null),
  ('BAR_BEB_R26', 'Ginger Ale Schweppes (venta)',        'GASEOSAS Y AGUAS', 'REVENTA', 'Ginger Swepers',         8000, 'BAR_MPe_0114', 300, 'ml', null),
  ('BAR_BEB_R27', 'Red Bull (venta)',                    'GASEOSAS Y AGUAS', 'REVENTA', 'Red bull',              25000, 'BAR_MPe_0201', 1, 'und', null),
  ('BAR_BEB_R28', 'Tónica Mil976 Ocean (venta)',         'GASEOSAS Y AGUAS', 'REVENTA', 'Tonica Mil976 Ocean',    9000, 'BAR_MPe_0117', 1, 'und', null),
  ('BAR_BEB_R29', 'Tónica Mil976 Pink (venta)',          'GASEOSAS Y AGUAS', 'REVENTA', 'Tonica Mil976 Pink',     9000, 'BAR_MPe_0116', 1, 'und', null),
  ('BAR_BEB_R30', 'Mil976 Tamarindo (venta)',            'GASEOSAS Y AGUAS', 'REVENTA', '1976 Tamarindo',        15000, 'BAR_MPe_0189', 330, 'ml', null),
  ('BAR_BEB_R31', 'Mil976 Manzana (venta)',              'GASEOSAS Y AGUAS', 'REVENTA', '1976 Manzana',          15000, null, null, null, 'Sin ficha: no se sabe a qué insumo del catálogo corresponde.'),
  ('BAR_BEB_R32', 'Mil976 Soda (venta)',                 'GASEOSAS Y AGUAS', 'REVENTA', '1976 Soda',             15000, null, null, null, 'Sin ficha: no se sabe a qué insumo del catálogo corresponde.'),
  -- Copas de vino (150 ml)
  ('BAR_BEB_V01', 'Copa de vino tinto de la casa',       'VINO COPA', 'COPA', 'Copa de vino tinto de la casa',  25000, 'BAR_MPe_0113', 150, 'ml', 'Supuesto: vino de la casa tinto = Rosaleda Merlot.'),
  ('BAR_BEB_V02', 'Copa de vino blanco de la casa',      'VINO COPA', 'COPA', 'Copa vino de la casa blanco',    25000, 'BAR_MPe_0112', 150, 'ml', 'Supuesto: vino de la casa blanco = Rosaleda Sauvignon Blanc.'),
  ('BAR_BEB_V03', 'Copa de vino rosado de la casa',      'VINO COPA', 'COPA', 'Copa de vino rosado',            25000, 'BAR_MPe_0111', 150, 'ml', 'Supuesto: vino de la casa rosado = Rosaleda Rosé.'),
  ('BAR_BEB_V04', 'Copa de espumante Barón de Rothberg', 'VINO COPA', 'COPA', 'Copa espumante baron de rothberg', 23000, 'BAR_MPe_0110', 150, 'ml', null),
  -- Shots (60 ml)
  ('BAR_BEB_S01', 'Shot de Absenta',                     'SHOT', 'TRAGO', 'Shot Absenta absenta 55',            50000, 'BAR_MPe_0150', 60, 'ml', null),
  ('BAR_BEB_S02', 'Shot de Amaretto Disaronno',          'SHOT', 'TRAGO', 'Shot Amareto dissarono',             30000, 'BAR_MPe_0101', 60, 'ml', null),
  ('BAR_BEB_S03', 'Shot de Ancho Reyes',                 'SHOT', 'TRAGO', 'Shot Ancho reyes',                   36000, 'BAR_MPe_0095', 60, 'ml', null),
  ('BAR_BEB_S04', 'Shot de Aperol',                      'SHOT', 'TRAGO', 'Shot Aperol aperol',                 25000, 'BAR_MPe_0099', 60, 'ml', null),
  ('BAR_BEB_S05', 'Shot de Cachaça Jamel',               'SHOT', 'TRAGO', 'Shot Cachaza jamel',                 20000, 'BAR_MPe_0104', 60, 'ml', null),
  ('BAR_BEB_S06', 'Shot de Campari',                     'SHOT', 'TRAGO', 'Shot Campari campari',               30000, 'BAR_MPe_0090', 60, 'ml', null),
  ('BAR_BEB_S07', 'Shot de Cointreau',                   'SHOT', 'TRAGO', 'Shot Cointreau',                     38000, 'BAR_MPe_0100', 60, 'ml', null),
  ('BAR_BEB_S08', 'Shot de Pisco Demonio de los Andes',  'SHOT', 'TRAGO', 'Shot Demonio pisco',                 38000, 'BAR_MPe_0105', 60, 'ml', null),
  ('BAR_BEB_S09', 'Shot de Dubonnet',                    'SHOT', 'TRAGO', 'Shot Dubonnet',                      20000, 'BAR_MPe_0155', 60, 'ml', null),
  ('BAR_BEB_S10', 'Shot de Jägermeister',                'SHOT', 'TRAGO', 'Shot Jagermaister jagermaister',     28000, 'BAR_MPe_0103', 60, 'ml', null),
  ('BAR_BEB_S11', 'Shot de Licor 43',                    'SHOT', 'TRAGO', 'Shot Licor licor 43',                35000, 'BAR_MPe_0094', 60, 'ml', null),
  ('BAR_BEB_S12', 'Shot de Limoncello Villa Massa',      'SHOT', 'TRAGO', 'Shot Limoncello villa massa',        35000, 'BAR_MPe_0097', 60, 'ml', null),
  ('BAR_BEB_S13', 'Shot de Pastis Ricard',               'SHOT', 'TRAGO', 'Shot Pastis ricard',                 27000, 'BAR_MPe_0152', 60, 'ml', null),
  ('BAR_BEB_S14', 'Shot de Triple sec azul (curazao)',   'SHOT', 'TRAGO', 'Shot Triple sec curazao',            20000, 'BAR_MPe_0089', 60, 'ml', null),
  ('BAR_BEB_S15', 'Shot de Vermouth extra dry Cinzano',  'SHOT', 'TRAGO', 'Shot Vermouth cinzano extra dry',    40000, 'BAR_MPe_0091', 60, 'ml', null),
  ('BAR_BEB_S16', 'Shot de Sambuca Luxardo',             'SHOT', 'TRAGO', 'Shot Zambuca luxardo',               34000, 'BAR_MPe_0153', 60, 'ml', null),
  ('BAR_BEB_S17', 'Shot de Aguardiente Origen Atardecer','SHOT', 'TRAGO', 'Shot aguardiente Origen atardecer',  20000, 'BAR_MPe_0154', 60, 'ml', null),
  ('BAR_BEB_S18', 'Shot de Baileys',                     'SHOT', 'TRAGO', 'Shot crema de whisky Baielys}',      30000, 'BAR_MPe_0102', 60, 'ml', null),
  ('BAR_BEB_S19', 'Shot de Ginebra Beefeater Pink',      'SHOT', 'TRAGO', 'Shot ginebra Befeater pink',         40000, 'BAR_MPe_0108', 60, 'ml', null),
  ('BAR_BEB_S20', 'Shot de Ginebra Monkey 47',           'SHOT', 'TRAGO', 'Shot ginebra Monkey monkey 47',      48000, 'BAR_MPe_0133', 60, 'ml', null),
  ('BAR_BEB_S21', 'Shot de Ginebra Tanqueray',           'SHOT', 'TRAGO', 'Shot ginebra Tanqueray tanqueray',   40000, 'BAR_MPe_0079', 60, 'ml', null),
  ('BAR_BEB_S22', 'Shot de Ginebra Hendrick''s',         'SHOT', 'TRAGO', 'Shot ginebra hendricks',             55000, 'BAR_MPe_0132', 60, 'ml', null),
  ('BAR_BEB_S23', 'Shot de Mezcal Montelobos',           'SHOT', 'TRAGO', 'Shot mezcal Montelobos',             55000, 'BAR_MPe_0106', 60, 'ml', null),
  ('BAR_BEB_S24', 'Shot de Mezcal Ojo de Tigre',         'SHOT', 'TRAGO', 'Shot mezcal Ojo de tigre',           35000, 'BAR_MPe_0134', 60, 'ml', null),
  ('BAR_BEB_S25', 'Shot de Ron Bacardí Añejo',           'SHOT', 'TRAGO', 'Shot ron Bacardi añejo',             20000, 'BAR_MPe_0092', 60, 'ml', null),
  ('BAR_BEB_S26', 'Shot de Ron La Hechicera',            'SHOT', 'TRAGO', 'Shot ron La hechicera',              55000, 'BAR_MPe_0136', 60, 'ml', null),
  ('BAR_BEB_S27', 'Shot de Ron Zacapa 23',               'SHOT', 'TRAGO', 'Shot ron Zacapa 23',                 55000, 'BAR_MPe_0137', 60, 'ml', null),
  ('BAR_BEB_S28', 'Shot de Ron Zacapa Ámbar',            'SHOT', 'TRAGO', 'Shot ron Zacapa ambar',              35000, 'BAR_MPe_0138', 60, 'ml', null),
  ('BAR_BEB_S29', 'Shot de Ron Flor de Caña',            'SHOT', 'TRAGO', 'Shot ron flor de caña añejo oro',    30000, 'BAR_MPe_0159', 60, 'ml', null),
  ('BAR_BEB_S30', 'Shot de Tequila Don Julio Reposado',  'SHOT', 'TRAGO', 'Shot tequila Don juio reposado',     50000, 'BAR_MPe_0141', 60, 'ml', null),
  ('BAR_BEB_S31', 'Shot de Tequila Don Julio 70',        'SHOT', 'TRAGO', 'Shot tequila Don julio 70',          75000, 'BAR_MPe_0140', 60, 'ml', null),
  ('BAR_BEB_S32', 'Shot de Tequila José Cuervo',         'SHOT', 'TRAGO', 'Shot tequila Jose cuervo reposado',  30000, 'BAR_MPe_0142', 60, 'ml', 'Supuesto: José Cuervo Reposado del TPV = José Cuervo Especial del catálogo.'),
  ('BAR_BEB_S33', 'Shot de Tequila Olmeca Chocolate',    'SHOT', 'TRAGO', 'Shot tequila Olmeca chocolate',      37000, 'BAR_MPe_0087', 60, 'ml', null),
  ('BAR_BEB_S34', 'Shot de Tequila Olmeca Reposado',     'SHOT', 'TRAGO', 'Shot tequila Olmeca reposado',       35000, 'BAR_MPe_0086', 60, 'ml', null),
  ('BAR_BEB_S35', 'Shot de Triple sec Convier',          'SHOT', 'TRAGO', 'Shot triple sec convier',            22000, 'BAR_MPe_0088', 60, 'ml', null),
  ('BAR_BEB_S36', 'Shot de Vermouth rosso',              'SHOT', 'TRAGO', 'Shot vermouh cinzano rosso',         30000, 'BAR_MPe_0063', 60, 'ml', null),
  ('BAR_BEB_S37', 'Shot de Vodka Grey Goose',            'SHOT', 'TRAGO', 'Shot vodka Grey goose',              70000, 'BAR_MPe_0143', 60, 'ml', null),
  ('BAR_BEB_S38', 'Shot de Vodka Absolut',               'SHOT', 'TRAGO', 'Shot vodka absolut',                 40000, 'BAR_MPe_0069', 60, 'ml', null),
  ('BAR_BEB_S39', 'Shot de Whisky Buchanan''s Two Souls','SHOT', 'TRAGO', 'Shot whisky Buchanan''s two souls',  45000, 'BAR_MPe_0144', 60, 'ml', null),
  ('BAR_BEB_S40', 'Shot de Whisky Bulleit Bourbon',      'SHOT', 'TRAGO', 'Shot whisky Bullet bourbon',         55000, 'BAR_MPe_0107', 60, 'ml', null),
  ('BAR_BEB_S41', 'Shot de Whisky Glenfiddich 12 años',  'SHOT', 'TRAGO', 'Shot whisky Glenfidich 12 años',     45000, 'BAR_MPe_0145', 60, 'ml', null),
  ('BAR_BEB_S42', 'Shot de Whisky Glenfiddich 18 años',  'SHOT', 'TRAGO', 'Shot whisky Glenfidich 18 años',     80000, 'BAR_MPe_0146', 60, 'ml', null),
  ('BAR_BEB_S43', 'Shot de Whisky Monkey Shoulder',      'SHOT', 'TRAGO', 'Shot wshisky Monkey shoulder',       40000, 'BAR_MPe_0147', 60, 'ml', null),
  ('BAR_BEB_S44', 'Shot de Aguardiente Amarillo',        'SHOT', 'TRAGO', 'shot Aguardiente amarillo',          20000, 'BAR_MPe_0157', 60, 'ml', null),
  ('BAR_BEB_S45', 'Shot de Jerez Tío Pepe',              'SHOT', 'TRAGO', 'shot Jerez Tio Pepe',                28000, 'BAR_MPe_0149', 60, 'ml', null),
  -- Botellas (su contenido)
  ('BAR_BEB_B01', 'Botella Aguardiente Amarillo 375 ml',      'BOTELLA', 'BOTELLA', 'Aguardiente amarillo bot 375',   100000, 'BAR_MPe_0157', 375, 'ml', null),
  ('BAR_BEB_B02', 'Botella Aguardiente Amarillo 750 ml',      'BOTELLA', 'BOTELLA', 'Aguardiente amarillo bot 750',   180000, 'BAR_MPe_0157', 750, 'ml', null),
  ('BAR_BEB_B03', 'Botella Aguardiente Cumbre Premium',       'BOTELLA', 'BOTELLA', 'Aguardiente cumbe premium',      350000, 'BAR_MPe_0158', 750, 'ml', null),
  ('BAR_BEB_B04', 'Botella Aguardiente Origen Atardecer',     'BOTELLA', 'BOTELLA', 'Aguardiente Origen atardecer',   140000, 'BAR_MPe_0154', 750, 'ml', null),
  ('BAR_BEB_B05', 'Botella Aguardiente Origen Nocturno',      'BOTELLA', 'BOTELLA', 'Aguardiente Origen nocturno',    125600, null, null, null, 'Sin ficha: el Origen Nocturno no está en el catálogo.'),
  ('BAR_BEB_B06', 'Botella Ginebra Hendrick''s 1000 ml',      'BOTELLA', 'BOTELLA', 'Ginebra Hendricks 1000ml',       615000, 'BAR_MPe_0132', 1000, 'ml', null),
  ('BAR_BEB_B07', 'Botella Ginebra Hendrick''s 750 ml',       'BOTELLA', 'BOTELLA', 'Ginebra Hendricks 750ml',        500000, 'BAR_MPe_0132', 750, 'ml', null),
  ('BAR_BEB_B08', 'Botella Ginebra Monkey 47',                'BOTELLA', 'BOTELLA', 'Ginebra Monkey 47',              392000, 'BAR_MPe_0133', 500, 'ml', null),
  ('BAR_BEB_B09', 'Botella Ginebra Tanqueray',                'BOTELLA', 'BOTELLA', 'Ginebra Tankeray',               450000, 'BAR_MPe_0079', 700, 'ml', null),
  ('BAR_BEB_B10', 'Botella Ginebra Beefeater Pink',           'BOTELLA', 'BOTELLA', 'Ginebra befeater pink',          396200, 'BAR_MPe_0108', 700, 'ml', null),
  ('BAR_BEB_B11', 'Botella Tequila José Cuervo 750 ml',       'BOTELLA', 'BOTELLA', 'Jose Cuervo Reposado Bot 750',   180000, 'BAR_MPe_0142', 750, 'ml', 'Supuesto: José Cuervo Reposado del TPV = José Cuervo Especial del catálogo.'),
  ('BAR_BEB_B12', 'Botella Tequila José Cuervo 375 ml',       'BOTELLA', 'BOTELLA', 'Jose Cuervo Reposado media 375 ml', 100000, 'BAR_MPe_0142', 375, 'ml', 'Supuesto: José Cuervo Reposado del TPV = José Cuervo Especial del catálogo.'),
  ('BAR_BEB_B13', 'Botella Tequila Olmeca Chocolate',         'BOTELLA', 'BOTELLA', 'Olmeca Chocolate Bot 700',       190000, 'BAR_MPe_0087', 700, 'ml', null),
  ('BAR_BEB_B14', 'Botella Tequila Olmeca Reposado 700 ml',   'BOTELLA', 'BOTELLA', 'Olmeca Reposado bot 700',        280000, 'BAR_MPe_0086', 700, 'ml', null),
  ('BAR_BEB_B15', 'Botella Tequila Olmeca Reposado 1000 ml',  'BOTELLA', 'BOTELLA', 'Olmeca Reposado bot 1000',       498000, 'BAR_MPe_0086', 1000, 'ml', null),
  ('BAR_BEB_B16', 'Botella Tequila Olmeca Blanco',            'BOTELLA', 'BOTELLA', 'Olmeca Blanco',                  195000, null, null, null, 'Sin ficha: el Olmeca Blanco no está en el catálogo.'),
  ('BAR_BEB_B17', 'Botella Tequila Don Julio 70',             'BOTELLA', 'BOTELLA', 'Don Julio 70',                   750000, 'BAR_MPe_0140', 700, 'ml', null),
  ('BAR_BEB_B18', 'Botella Tequila Don Julio Reposado',       'BOTELLA', 'BOTELLA', 'Don Julio Reposado',             600000, 'BAR_MPe_0141', 700, 'ml', null),
  ('BAR_BEB_B19', 'Botella Tequila Don Julio 1942',           'BOTELLA', 'BOTELLA', 'Don Julio 1942',                2000000, 'BAR_MPe_0139', 750, 'ml', null),
  ('BAR_BEB_B20', 'Botella Mezcal Ojo de Tigre',              'BOTELLA', 'BOTELLA', 'Mezcal Ojo De Tigre',            350000, 'BAR_MPe_0134', 750, 'ml', null),
  ('BAR_BEB_B21', 'Botella Mezcal Montelobos',                'BOTELLA', 'BOTELLA', 'Montelobos',                     648000, 'BAR_MPe_0106', 750, 'ml', null),
  ('BAR_BEB_B22', 'Botella Ron Flor de Caña',                 'BOTELLA', 'BOTELLA', 'Ron flor de caña',               210000, 'BAR_MPe_0159', 750, 'ml', null),
  ('BAR_BEB_B23', 'Botella Ron Zacapa 23 años',               'BOTELLA', 'BOTELLA', 'Zacapa 23',                      650000, 'BAR_MPe_0137', 700, 'ml', null),
  ('BAR_BEB_B24', 'Botella Ron Zacapa Ámbar',                 'BOTELLA', 'BOTELLA', 'Zacapa Ambar',                   378000, 'BAR_MPe_0138', 750, 'ml', null),
  ('BAR_BEB_B25', 'Botella Ron La Hechicera',                 'BOTELLA', 'BOTELLA', 'La Hechicera',                   570000, 'BAR_MPe_0136', 700, 'ml', null),
  ('BAR_BEB_B26', 'Botella Vodka Absolut 750 ml',             'BOTELLA', 'BOTELLA', 'Absolut 750 ml',                 200000, 'BAR_MPe_0069', 750, 'ml', null),
  ('BAR_BEB_B27', 'Botella Vodka Grey Goose',                 'BOTELLA', 'BOTELLA', 'Grey Goose',                     500000, 'BAR_MPe_0143', 700, 'ml', null),
  ('BAR_BEB_B28', 'Botella Whisky Buchanan''s Two Souls',     'BOTELLA', 'BOTELLA', 'Buchanan''S Two Souls',          465250, 'BAR_MPe_0144', 750, 'ml', null),
  ('BAR_BEB_B29', 'Botella Whisky Bulleit Bourbon',           'BOTELLA', 'BOTELLA', 'Bullet Bourbon',                 456500, 'BAR_MPe_0107', 750, 'ml', null),
  ('BAR_BEB_B30', 'Botella Whisky Glenfiddich 12 años',       'BOTELLA', 'BOTELLA', 'Glenfidich 12 Años',             350000, 'BAR_MPe_0145', 750, 'ml', null),
  ('BAR_BEB_B31', 'Botella Whisky Glenfiddich 18 años',       'BOTELLA', 'BOTELLA', 'Glenfidich 18 Años',            1026000, 'BAR_MPe_0146', 750, 'ml', null),
  ('BAR_BEB_B32', 'Botella Whisky Monkey Shoulder 700 ml',    'BOTELLA', 'BOTELLA', 'Monkey Shoulder',                365600, 'BAR_MPe_0147', 700, 'ml', 'Supuesto: el TPV trae dos Monkey Shoulder; $365.600 = la de 700 ml.'),
  ('BAR_BEB_B33', 'Botella Whisky Monkey Shoulder 1000 ml',   'BOTELLA', 'BOTELLA', 'Monkey Shoulder',                423000, 'BAR_MPe_0147', 1000, 'ml', 'Supuesto: el TPV trae dos Monkey Shoulder; $423.000 = la de 1.000 ml.'),
  ('BAR_BEB_B34', 'Botella Crema de Whisky Baileys',          'BOTELLA', 'BOTELLA', 'Crema De Whisky Baeily''S 1000ml', 300000, 'BAR_MPe_0102', 1000, 'ml', null),
  ('BAR_BEB_B35', 'Botella Champagne Veuve Clicquot Brut',    'BOTELLA', 'BOTELLA', 'Veuve Clicquot brut',           1600000, 'BAR_MPe_0173', 750, 'ml', null),
  ('BAR_BEB_B36', 'Botella Champagne Veuve Clicquot Rich',    'BOTELLA', 'BOTELLA', 'Champagne Veuve Clicquot Rich', 1700000, 'BAR_MPe_0175', 750, 'ml', null),
  ('BAR_BEB_B37', 'Botella Champagne Veuve Clicquot Rosé',    'BOTELLA', 'BOTELLA', 'Champagne Veuve Clicquot Rose', 2000000, 'BAR_MPe_0174', 750, 'ml', null),
  ('BAR_BEB_B38', 'Botella Champagne Moët Ice Imperial',      'BOTELLA', 'BOTELLA', 'Champane Moet Y Chandon Ice Imperial', 990000, null, null, null, 'Sin ficha: el Moët Ice Imperial no está en el catálogo.'),
  ('BAR_BEB_B39', 'Botella Espumante Chandon Extra Brut',     'BOTELLA', 'BOTELLA', 'Chandon Extrabrut',              300000, 'BAR_MPe_0169', 750, 'ml', null),
  ('BAR_BEB_B40', 'Botella Espumante Chandon Rosé',           'BOTELLA', 'BOTELLA', 'Chandon Rose',                   300000, 'BAR_MPe_0170', 750, 'ml', null),
  ('BAR_BEB_B41', 'Botella Espumante Barón de Rothberg',      'BOTELLA', 'BOTELLA', 'Baron De Rothberg Brut',         120000, 'BAR_MPe_0110', 750, 'ml', null),
  ('BAR_BEB_B42', 'Botella Espumante Piccini Extra Dry',      'BOTELLA', 'BOTELLA', 'Piccini Extra Dry',              300000, null, null, null, 'Sin ficha: el Piccini Extra Dry no está en el catálogo.'),
  ('BAR_BEB_B43', 'Botella Lambrusco Piccini Reggiano',       'BOTELLA', 'BOTELLA', 'Piccini Regiano Lambrusco',      170000, 'BAR_MPe_0171', 750, 'ml', null),
  ('BAR_BEB_B44', 'Botella JP Chenet',                        'BOTELLA', 'BOTELLA', 'Jp chenet',                      150000, null, null, null, 'Sin ficha: no se sabe a qué JP Chenet del catálogo corresponde.'),
  ('BAR_BEB_B45', 'Botella JP Chenet Brut Chardonnay',        'BOTELLA', 'BOTELLA', 'Jp chenet brut chardonay',       120000, null, null, null, 'Sin ficha: el JP Chenet Brut Chardonnay no está en el catálogo.'),
  ('BAR_BEB_B46', 'Botella Vino Trapiche Medalla Malbec',     'BOTELLA', 'BOTELLA', 'Vino trapiche medalla malbec',   450000, null, null, null, 'Sin ficha: el catálogo solo tiene el Trapiche Medalla Malbec Rosé; falta confirmar cuál es.'),
  ('BAR_BEB_B47', 'Botella Vino Diablo Dark Blend',           'BOTELLA', 'BOTELLA', 'Diablo Dark Blend',              300000, 'BAR_MPe_0160', 750, 'ml', null),
  ('BAR_BEB_B48', 'Botella Vino Finca de las Moras Malbec 375 ml', 'BOTELLA', 'BOTELLA', 'Finca De Las Moras Malbec 375ml', 30000, 'BAR_MPe_0161', 375, 'ml', null),
  ('BAR_BEB_B49', 'Botella Vino Marqués de Riscal Reserva',   'BOTELLA', 'BOTELLA', 'Marquez De Riscal Reserva Tempranillo', 490000, 'BAR_MPe_0162', 750, 'ml', null),
  ('BAR_BEB_B50', 'Botella Vino Marqués de Riscal Gran Reserva', 'BOTELLA', 'BOTELLA', 'M.De Riscal Gran Reserva Tempranillo', 1000000, 'BAR_MPe_0163', 750, 'ml', null),
  ('BAR_BEB_B51', 'Botella Vino Morandé Cabernet Sauvignon',  'BOTELLA', 'BOTELLA', 'Morande Reserva Cabernet Sauvignon', 210000, 'BAR_MPe_0164', 750, 'ml', 'Supuesto: Morandé Reserva del TPV = Morandé Pionero del catálogo.'),
  ('BAR_BEB_B52', 'Botella Vino Mar de Frades Albariño',      'BOTELLA', 'BOTELLA', 'Mar de Frades Albariño',         370000, 'BAR_MPe_0068', 750, 'ml', 'Supuesto: Mar de Frades = Vino blanco Albariño del catálogo.'),
  ('BAR_BEB_B53', 'Botella Vino Tarapacá Reserva Chardonnay', 'BOTELLA', 'BOTELLA', 'Tarapaca Reserva Chardonay',     180000, 'BAR_MPe_0168', 750, 'ml', null),
  ('BAR_BEB_B54', 'Botella Vino Tarapacá Sauvignon Blanc',    'BOTELLA', 'BOTELLA', 'Tarapaca Sauvigno Blanc',        200000, 'BAR_MPe_0176', 750, 'ml', null),
  ('BAR_BEB_B55', 'Botella Vino Tarapacá Reserva Merlot',     'BOTELLA', 'BOTELLA', 'Tarapaca Reserva Merlot',        200000, 'BAR_MPe_0165', 750, 'ml', null),
  ('BAR_BEB_B56', 'Botella Vino Tarapacá Rosé',               'BOTELLA', 'BOTELLA', 'Tarapaca Rose',                  220000, null, null, null, 'Sin ficha: el Tarapacá Rosé no está en el catálogo.'),
  ('BAR_BEB_B57', 'Botella Vino Tarapacá Joven Cabernet',     'BOTELLA', 'BOTELLA', 'Tarapaca Joven CaberSau',        200000, null, null, null, 'Sin ficha: el Tarapacá Joven Cabernet no está en el catálogo.'),
  ('BAR_BEB_B58', 'Botella Vino Cono Sur Bicicleta Pinot Noir Rosé', 'BOTELLA', 'BOTELLA', 'Cono Sur Bicicleta Pinot Noir rose', 150000, 'BAR_MPe_0167', 750, 'ml', null),
  -- Preparadas sin receta todavía (salen «Sin ficha»)
  ('BAR_BEB_P01', 'Limonada natural',                         'JUGOS Y LIMONADAS', 'PREPARADA', 'Limonada natural',          16000, null, null, null, 'Sin ficha: falta la receta.'),
  ('BAR_BEB_P02', 'Limonada cerezada',                        'JUGOS Y LIMONADAS', 'PREPARADA', 'Limonada cerezada',         18000, null, null, null, 'Sin ficha: falta la receta.'),
  ('BAR_BEB_P03', 'Limonada de hierbabuena',                  'JUGOS Y LIMONADAS', 'PREPARADA', 'Limonada de hierbabuena',   16000, null, null, null, 'Sin ficha: falta la receta.'),
  ('BAR_BEB_P04', 'Jugo de fresa',                            'JUGOS Y LIMONADAS', 'PREPARADA', 'Jugo de Fresa',             18000, null, null, null, 'Sin ficha: falta la receta.'),
  ('BAR_BEB_P05', 'Jugo de maracuyá',                         'JUGOS Y LIMONADAS', 'PREPARADA', 'Jugo de Maracuya',          18000, null, null, null, 'Sin ficha: falta la receta.'),
  ('BAR_BEB_P06', 'Jugo de mora',                             'JUGOS Y LIMONADAS', 'PREPARADA', 'Jugo de mora',              18000, null, null, null, 'Sin ficha: falta la receta.'),
  ('BAR_BEB_P07', 'Gin Tonic Premium Hendrick''s',            'CLÁSICA', 'PREPARADA', 'Gin Tonic Premium Hendricks',          65000, null, null, null, 'Sin ficha: falta la receta.'),
  ('BAR_BEB_P08', 'Gin Tonic Premium Monkey 47',              'CLÁSICA', 'PREPARADA', 'Gin Tonic Premium Monkey 74',          68000, null, null, null, 'Sin ficha: falta la receta.'),
  ('BAR_BEB_P09', 'Whiskey Sour',                             'CLÁSICA', 'PREPARADA', 'Whiskey Sour',                         50000, null, null, null, 'Sin ficha: falta la receta.'),
  ('BAR_BEB_P10', 'Old Fashioned Premium (Bulleit)',          'CLÁSICA', 'PREPARADA', 'Clasica Old Fashioned premium (bullet)', 75000, null, null, null, 'Sin ficha: falta la receta.'),
  ('BAR_BEB_P11', 'Envenenado Ginebra Beefeater Pink',        'ENVENENADO', 'PREPARADA', 'Envenenado beefeater pink',         50000, null, null, null, 'Sin ficha: falta la receta.'),
  ('BAR_BEB_P12', 'Envenenado Ginebra Tanqueray',             'ENVENENADO', 'PREPARADA', 'Envenenado ginebra tanqueray',      50000, null, null, null, 'Sin ficha: falta la receta.'),
  ('BAR_BEB_P13', 'Envenenado Ron Zacapa Ámbar',              'ENVENENADO', 'PREPARADA', 'Envenenado ron zacapa ambar',       50000, null, null, null, 'Sin ficha: falta la receta.'),
  ('BAR_BEB_P14', 'Envenenado Tequila Olmeca Reposado',       'ENVENENADO', 'PREPARADA', 'Envenenado tequila olmeca reposado', 50000, null, null, null, 'Sin ficha: falta la receta.'),
  ('BAR_BEB_P15', 'Envenenado Vodka Absolut',                 'ENVENENADO', 'PREPARADA', 'Envenenado vodka absolut',          50000, null, null, null, 'Sin ficha: falta la receta.');

-- genéricos de carta
insert into public.genericos (codigo, nombre, tipo, categoria, area, unidad_base, seccion_carta, forma_venta, nota)
select b.codigo, b.nombre, 'BEBIDA', 'BEBIDA_CARTA', 'BAR', 'und', b.seccion, b.forma,
       'Carta: ' || b.seccion || ' · TPV: ' || b.tpv || ' · Alta 08/11/2026 (bebida de carta, ficha de 1 línea)'
       || coalesce(' · ' || b.nota, '')
  from _bebidas b
on conflict do nothing;

-- ficha automática de una línea (solo si el genérico todavía no tiene ficha)
insert into public.fichas (codigo, generico_id, version, vigente_desde, nota, descripcion)
select replace(b.codigo, 'BAR_BEB_', ''), g.id, 1, '2026-11-08',
       'Ficha automática de una línea (decisión de Anthony, 06/11/2026).' || coalesce(' ' || b.nota, ''),
       case b.forma when 'REVENTA' then 'Se sirve tal como se compra.'
                    when 'TRAGO' then 'Shot de ' || b.cantidad || ' ml.'
                    when 'COPA' then 'Copa de ' || b.cantidad || ' ml.'
                    when 'BOTELLA' then 'Botella entera de ' || b.cantidad || ' ml.' end
  from _bebidas b
  join public.genericos g on g.codigo = b.codigo
 where b.insumo is not null
   and not exists (select 1 from public.fichas f where f.generico_id = g.id);

insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad)
select f.id, 1, i.id, b.cantidad, b.unidad
  from _bebidas b
  join public.genericos g on g.codigo = b.codigo
  join public.fichas f on f.generico_id = g.id and f.version = 1
  join public.genericos i on i.codigo = b.insumo
 where b.insumo is not null
   and not exists (select 1 from public.ficha_lineas l where l.ficha_id = f.id);

-- precio de carta del TPV (solo si todavía no tiene ninguno)
insert into public.precios_venta (generico_id, precio_con_impuesto, vigente_desde)
select g.id, b.precio, '2026-11-06'
  from _bebidas b
  join public.genericos g on g.codigo = b.codigo
 where not exists (select 1 from public.precios_venta v where v.generico_id = g.id);
