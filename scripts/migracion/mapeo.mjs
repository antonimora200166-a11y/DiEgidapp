// =====================================================================================
// Decisiones de mapeo para migrar los Sheets de bar. Este archivo es la parte que una
// persona revisa y corrige (CLAUDE.md: la IA propone y una persona confirma).
// Las claves van normalizadas: minúsculas, sin tildes, espacios simples (ver norm()).
// Lo marcado como { pendiente } NO se migra: queda en el reporte para que alguien decida.
// =====================================================================================

// ---------------------------------------------------------------- INV-BAR-001: botellas
// Producto del inventario (nombre normalizado) → genérico existente del catálogo de costos.
// Lo que no está aquí se crea como genérico nuevo, con categoría según el TIPO de la fila.
export const INVENTARIO_A_GENERICO = {
  // Destilados y licores
  'beefeater pink': 'BAR_MPe_0108',
  'tanqueray clasica': 'BAR_MPe_0079',
  'montelobos': 'BAR_MPe_0106',
  'demonio de los andes': 'BAR_MPe_0105',
  'bacardi anejo': 'BAR_MPe_0092',
  'la hechicera bananero': 'BAR_MPe_0093',
  'olmeca chocolate': 'BAR_MPe_0087',
  'olmeca reposado': 'BAR_MPe_0086',
  'absolut': 'BAR_MPe_0069',
  'bulleit bourbon': 'BAR_MPe_0107',
  'baileys crema de whisky': 'BAR_MPe_0102',
  'licor 43 aperitivo': 'BAR_MPe_0094',
  'cachaca jamel': 'BAR_MPe_0104',
  'amaretto disaronno': 'BAR_MPe_0101',
  'coloma — licor de cafe': 'BAR_MPe_0028',
  'ancho reyes — licor de chile': 'BAR_MPe_0095',
  'cointreau — licor de naranja': 'BAR_MPe_0100',
  'convier — licor de durazno': 'BAR_MPe_0096',
  'jagermeister': 'BAR_MPe_0103',
  'soho — licor de lychee': 'BAR_MPe_0098',
  'campari — aperitivo de hierbas': 'BAR_MPe_0090',
  'aperol': 'BAR_MPe_0099',
  'villa massa limoncello': 'BAR_MPe_0097',
  'convier triple sec azul': 'BAR_MPe_0089',
  'convier triple sec': 'BAR_MPe_0088',
  'cinzano vermouth extra dry': 'BAR_MPe_0091',
  'cinzano vermouth rosso': 'BAR_MPe_0063',
  // Vinos y espumantes
  'rosaleda — merlot': 'BAR_MPe_0113',
  'rosaleda rose': 'BAR_MPe_0111',
  'rosaleda — sauvignon blanc': 'BAR_MPe_0112',
  'mar de frades — albarino': 'BAR_MPe_0068',
  'baron de rothberg brut': 'BAR_MPe_0110',
  'mioneto prosecco': 'BAR_MPe_0109',          // el genérico «Prosecco» tiene dos marcas
  'piccini prosecco extradry': 'BAR_MPe_0109',
  // Embotellados y enlatados
  'ginger ale schweppes': 'BAR_MPe_0114',
  'soda bretana': 'BAR_MPe_0058',
  'hatsu frambuesa': 'BAR_MPe_0119',
  'mil976 ginger beer': 'BAR_MPe_0115',
  'mil976 manzana': 'BAR_MPe_0118',
  'mil976 ocean': 'BAR_MPe_0117',
  'mil976 pink': 'BAR_MPe_0116',
  'bbc rose': 'BAR_MPe_0121',
  'bbc monserrate roja': 'BAR_MPe_0122',
  'jp chenet rose': 'BAR_MPe_0120',             // la lata de 250 ml (cóctel fizzy)
};

// TIPO de la fila del inventario → categoría y unidad base de un genérico NUEVO.
// Licores y vinos se miden en ml; lo que se vende por botella o lata cerrada, en und.
export const TIPO_INVENTARIO = {
  ginebra: ['LICOR', 'ml'], mezcal: ['LICOR', 'ml'], pisco: ['LICOR', 'ml'], ron: ['LICOR', 'ml'],
  tequila: ['LICOR', 'ml'], vodka: ['LICOR', 'ml'], whisky: ['LICOR', 'ml'], licor: ['LICOR', 'ml'],
  aguardiente: ['LICOR', 'ml'],
  'vino tinto': ['VINO', 'ml'], 'vino rosado': ['VINO', 'ml'], 'vino blanco': ['VINO', 'ml'],
  espumante: ['VINO', 'ml'], champagne: ['VINO', 'ml'],
  agua: ['MIXER', 'und'], gaseosa: ['MIXER', 'und'], tonica: ['MIXER', 'und'], 'coctel fizzy': ['MIXER', 'und'],
  cerveza: ['CERVEZA', 'und'],
};
// Excepción: la soda Schweppes se usa para completar cócteles: se mide en ml como la Bretaña.
export const UNIDAD_BASE_NUEVO = { 'soda schweppes': 'ml' };

// Nombre de las taras que no coincide con el inventario.
export const TARAS_ALIAS = { 'la hechicera banano': 'la hechicera bananero' };

// ---------------------------------------------------------------- INV-BAR-001: fruver
// Decisiones de Anthony (22/10/2026): pulpas congeladas y porcionados x110 g son MPI propios.
export const FRUVER_INVENTARIO = {
  'albahaca': 'BAR_MPe_0002',
  'arandano congelado': 'BAR_MPe_0003',
  'arandano fresco': 'BAR_MPe_0072',
  'frambuesa': { nuevo: 'Frambuesa', categoria: 'FRUVER', unidad_base: 'g' },
  'fresa porcionada x110 gr': 'BAR_MPi_0069',
  'hierbabuena': { nuevo: 'Hierbabuena', categoria: 'FRUVER', unidad_base: 'g' },
  'kiwi': 'BAR_MPe_0025',
  'limon tahiti': 'BAR_MPe_0030',
  'lulo pulpa porcionado x110 gr': { nuevo: 'Porcionado de pulpa de lulo', tipo: 'MPI', categoria: 'MPI', unidad_base: 'g' },
  'mango pulpa porcionado x110 gr': { nuevo: 'Porcionado de pulpa de mango', tipo: 'MPI', categoria: 'MPI', unidad_base: 'g' },
  'mango viche porcionado x110 gr': { nuevo: 'Porcionado de mango viche', tipo: 'MPI', categoria: 'MPI', unidad_base: 'g' },
  'manzana gala': 'BAR_MPe_0035',
  'manzana roja': 'BAR_MPe_0036',
  'manzana verde': 'BAR_MPe_0037',
  'menta francesa': 'BAR_MPe_0042',
  'menta fresca': 'BAR_MPe_0041',
  'mora': 'BAR_MPe_0046',
  'mora pulpa porcionado x110 gr': 'BAR_MPi_0071',
  'naranja': 'BAR_MPe_0047',
  'naranja importada': 'BAR_MPe_0048',
  'pina': 'BAR_MPe_0054',
  'romero': 'BAR_MPe_0056',
  'pulpa de pina': { nuevo: 'Pulpa de piña', tipo: 'MPI', categoria: 'MPI', unidad_base: 'g' },
  'pulpa de maracuya': 'BAR_MPi_0051',
  'triple blend (pricesmart)': 'BAR_MPe_0045',
  'pulpa de sandia': { nuevo: 'Pulpa de sandía', tipo: 'MPI', categoria: 'MPI', unidad_base: 'g' },
  'pulpa de tamarindo': { nuevo: 'Pulpa de tamarindo', tipo: 'MPI', categoria: 'MPI', unidad_base: 'g' },
  'pulpa de borojo': { nuevo: 'Pulpa de borojó', tipo: 'MPI', categoria: 'MPI', unidad_base: 'g' },
};

// ---------------------------------------------------------------- INV-BAR-001: subprocesos (MPI)
// Se usan para el alias de inventario y la vida útil del MPI.
// Decisión de Anthony (22/10/2026): sirope de canela, licor amargo de limón y mango
// deshidratado son MPI propios (el mango, distinto del insumo comprado BAR_MPe_0076).
export const SUBPROCESOS_INVENTARIO = {
  'sirope simple': 'BAR_MPi_0006', 'sirope stella du solei': 'BAR_MPi_0013', 'sirope stella di mango': 'BAR_MPi_0014',
  'sirope stella di rosso': 'BAR_MPi_0015', 'sirope de jengibre': 'BAR_MPi_0007', 'sirope de cardamomo': 'BAR_MPi_0009',
  'sirope de naranja amarga': 'BAR_MPi_0010', 'sirope de romero': 'BAR_MPi_0011',
  'sirope de canela': { nuevo: 'Sirope de canela', tipo: 'MPI', categoria: 'MPI', unidad_base: 'g' },
  'sirope de chamoy': 'BAR_MPi_0020', 'sirope de tabaco-naranja': 'BAR_MPi_0019', 'sirope de flor de jamaica': 'BAR_MPi_0038',
  'sirope morfeo pee': 'BAR_MPi_0023', 'sirope pinefizz': 'BAR_MPi_0017', 'sirope scarlet kiss': 'BAR_MPi_0018',
  'sirope green velvet': 'BAR_MPi_0028', 'sirope de tamarindo': 'BAR_MPi_0016', 'sirope de manzanilla': 'BAR_MPi_0032',
  'mix de citricos': 'BAR_MPi_0012', 'zumo de limon': 'BAR_MPi_0001', 'zumo de naranja': 'BAR_MPi_0003',
  'zumo manzana-pera': 'BAR_MPi_0002', 'picadillo sangria tradicional': 'BAR_MPi_0021', 'picadillo morfeo pee': 'BAR_MPi_0022',
  'picadillo fairy blood': 'BAR_MPi_0024', 'picadillo green velvet': 'BAR_MPi_0027', 'orchata di egida': 'BAR_MPi_0026',
  'licor de vainilla': 'BAR_MPi_0030', 'licor de jamaica': 'BAR_MPi_0039', 'licor de menta fresca': 'BAR_MPi_0036',
  'licor de manzanilla': 'BAR_MPi_0033', 'licor de limoncillo': 'BAR_MPi_0042', 'te de manzanilla': 'BAR_MPi_0031',
  'cerezas maceradas en vermouth': 'BAR_MPi_0044', 'laminas de jengibre': 'BAR_MPi_0043', 'sal de fresa': 'BAR_MPi_0046',
  'garnitura de limon': 'BAR_MPi_0047', 'garnitura fideos de naranja': 'BAR_MPi_0048', 'papel de frutos rojos': 'BAR_MPi_0056',
  'papel de mango': 'BAR_MPi_0053',
  'licor amargo de limon': { nuevo: 'Licor amargo de limón', tipo: 'MPI', categoria: 'MPI', unidad_base: 'g' },
  'limon deshidratado': 'BAR_MPi_0059', 'naranja deshidratada': 'BAR_MPi_0060',
  'mango deshidratado': { nuevo: 'Deshidratado de mango', tipo: 'MPI', categoria: 'MPI', unidad_base: 'g' },
};

// ---------------------------------------------------------------- productos fuera del inventario
// Presentaciones que solo aparecen en las compras. clave → definición.
// generico: código existente o { nuevo, categoria, unidad_base }.
export const PRODUCTOS_EXTRA = {
  'azucar-manuelita-2500': { generico: 'BAR_MPe_0005', marca: 'Manuelita', presentacion: 'Bolsa 2.500 g', unidad_compra: 'PAQ', contenido: 2500 },
  'acido-citrico-1000': { generico: 'BAR_MPe_0001', marca: '', presentacion: 'Bolsa 1.000 g', unidad_compra: 'PAQ', contenido: 1000 },
  'bretana-300': { generico: 'BAR_MPe_0058', marca: 'Bretaña', presentacion: 'Botella vidrio 300 ml', unidad_compra: 'BOT', contenido: 300 },
  'canada-dry-ginger-300': { generico: 'BAR_MPe_0114', marca: 'Canada Dry', presentacion: 'Botella 300 ml', unidad_compra: 'BOT', contenido: 300 },
  'tonica-canada-dry-cero-300': { generico: { nuevo: 'Tónica Canada Dry Cero', categoria: 'MIXER', unidad_base: 'und' },
                                  marca: 'Canada Dry', presentacion: 'Botella 300 ml', unidad_compra: 'BOT', contenido: 1 },
  'mitica-easy-lager-300': { generico: { nuevo: 'Cerveza Mítica Easy Lager', categoria: 'CERVEZA', unidad_base: 'und' },
                             marca: 'Mítica', presentacion: 'Botella 300 ml', unidad_compra: 'BOT', contenido: 1 },
  'mitica-pale-lager-300': { generico: { nuevo: 'Cerveza Mítica Pale Lager', categoria: 'CERVEZA', unidad_base: 'und' },
                             marca: 'Mítica', presentacion: 'Botella 300 ml', unidad_compra: 'BOT', contenido: 1 },
  'gatorade-tropical': { generico: { nuevo: 'Gatorade tropical', categoria: 'MIXER', unidad_base: 'und' },
                         marca: 'Gatorade', presentacion: 'Botella', unidad_compra: 'BOT', contenido: 1,
                         nota: 'Presentación (ml) por confirmar.' },
  'red-bull-250': { generico: { nuevo: 'Red Bull', categoria: 'MIXER', unidad_base: 'und' },
                    marca: 'Red Bull', presentacion: 'Lata 250 ml', unidad_compra: 'LATA', contenido: 1 },
  'agua-hatsu-300': { generico: { nuevo: 'Agua Hatsu', categoria: 'MIXER', unidad_base: 'und' },
                      marca: 'Hatsu', presentacion: 'Botella 300 ml', unidad_compra: 'BOT', contenido: 1 },
  'hielo-iglu-3kg': { generico: { nuevo: 'Hielo iglú', categoria: 'HIELO', unidad_base: 'g' },
                      marca: 'Iglú', presentacion: 'Bolsa 3 kg', unidad_compra: 'PAQ', contenido: 3000 },
  'menta-francesa-caja': { generico: 'BAR_MPe_0042', marca: '', presentacion: 'Caja / bandeja', unidad_compra: 'CJA',
                           contenido_variable: true,
                           nota: 'Unidades por caja por confirmar (las compras dicen x25 y x50): se registran en cada recepción.' },
};

// ---------------------------------------------------------------- compras (BD_RECEPCION_BAR)
// Nombre de factura → producto. Los nombres que ya son alias de recepción en el catálogo de
// costos y tienen un solo producto no necesitan estar aquí.
//   { inv: 'nombre del inventario|ml' } · { extra: 'clave de PRODUCTOS_EXTRA' } · { granel: 'código' }
//   { excluir: 'razón' } · { pendiente: 'razón' }
export const RECEPCION = {
  'agua hatsu x300': { extra: 'agua-hatsu-300' },
  'aguardiente origen atardecer sin azucar': { inv: 'aguardiente origen atardecer|750' },
  'aperitivo campari': { inv: 'campari — aperitivo de hierbas|750', aviso: 'La compra dice «Botx700ml»; inventario, taras y factores dicen 750 ml.' },
  'azucar blanca manuelita': { extra: 'azucar-manuelita-2500' },
  'acido citrico': { extra: 'acido-citrico-1000' },
  'bandeja menta francesa x25 und': { extra: 'menta-francesa-caja' },
  'menta francesa': { extra: 'menta-francesa-caja' },
  'bolsa': { excluir: 'Desechable de servicio: no es insumo del kardex.' },
  'domicilio': { excluir: 'Servicio de transporte: no es insumo.' },
  'sobrecosto por flete': { excluir: 'Servicio de transporte: no es insumo.' },
  'prueba alta bar': { excluir: 'Línea de prueba del motor (05/10/2026).' },
  'bretana vidrio x300': { extra: 'bretana-300' },
  'soda bretana x300': { extra: 'bretana-300' },
  'cerveza mitica easy lager x300': { extra: 'mitica-easy-lager-300' },
  'cerveza mitica pale lager x300': { extra: 'mitica-pale-lager-300' },
  'gatorade tropical': { extra: 'gatorade-tropical' },
  'ginebra hendricks': { inv: "hendrick's|750" },
  'ginger canad dry x300': { extra: 'canada-dry-ginger-300' },
  'tonica canada dry cero x300': { extra: 'tonica-canada-dry-cero-300' },
  'hielo iglu bolsa': { extra: 'hielo-iglu-3kg' },
  'hielo iglu': { extra: 'hielo-iglu-3kg' },
  'jagermaister': { inv: 'jagermeister|700', aviso: 'La compra dice «Botx750»; inventario, taras y factores dicen 700 ml.' },
  'mezcal ojo de tigre': { inv: 'ojo de tigre|750' },
  'mil976 ginger beef': { inv: 'mil976 ginger beer|330' },
  'mil976 agua tonica pink': { inv: 'mil976 pink|330' },
  'mil976 fourpack pink': { inv: 'mil976 pink|330' },
  'mil976 sparkling manzana': { inv: 'mil976 manzana|330' },
  'red bull x250': { extra: 'red-bull-250' },
  'tequila olmeca dark chocolate': { inv: 'olmeca chocolate|700' },
  'triple sec convier': { inv: 'convier triple sec|750' },
  'uva verde': { pendiente: 'Una sola línea, sin precio ni unidad, y no está en el catálogo de costos.' },
  'vino tarapaca, reserva merlot bot 750 ml': { inv: 'tarapaca reserva — merlot|750' },
  'vino tarapaca, reserva merlot': { inv: 'tarapaca reserva — merlot|750' },
  'vino blanco mar de frades albarino': { inv: 'mar de frades — albarino|750' },
  'vino rosaleda rose': { inv: 'rosaleda rose|750' },
  'vodka absolut': { inv: 'absolut|1000' },
  'whisky glenfiddich 12 anos': { inv: 'glenfiddich 12 anos|750' },
  'ginebra tanqueray': { inv: 'tanqueray clasica|700' },
};

// Factores de unidades de compra que no son la unidad del producto (además de FACTORES_COMPRA
// de SGI-COSTOS). producto (clave interna) → { UNIDAD: unidades base por unidad }.
export const FACTORES_EXTRA = {
  'x:mitica-easy-lager-300': { SIX: 6 },
  'x:mitica-pale-lager-300': { SIX: 6 },
  'x:hielo-iglu-3kg': { UND: 3000 },          // «Bolsa 3 kl» registrada como UND
  'x:agua-hatsu-300': { BOT: 1 },
  'x:gatorade-tropical': { UND: 1 },
  'inv:mil976 ginger beer|330': { PAQ: 4 },
  'inv:mil976 pink|330': { PAQ: 4 },
  'inv:mil976 manzana|330': { PAQ: 4 },
};

// ---------------------------------------------------------------- alias y fichas corregidos
// Decisión de Anthony (22/10/2026): «vino blanco» en las fichas es Vino Rosaleda Sauvignon Blanc.
// fuente|alias normalizado → genérico que gana (los demás destinos se descartan sin conflicto).
export const ALIAS_FORZADO = { 'FICHA|vino blanco': 'BAR_MPe_0112' };
// ficha|línea → código de insumo que reemplaza al de FICHAS_DETALLE.
export const RECODIFICAR_FICHAS = { '#44|2': 'BAR_MPe_0112' };   // Espuma de Café: «Vino Blanco»
