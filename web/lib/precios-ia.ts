// Solo servidor: lo importan las acciones de app/(app)/catalogo/precios (usa la clave secreta de la API).
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// Lectura de una foto SOLO para sacar precios (Precios desde fotos): factura, tiquete, lista de
// precios, cotización o empaque. No es la lectura de Recibir (lib/factura-ia.ts): aquí no hay
// recepción, y lo que se lee lo confirma o corrige una persona antes de guardar nada.

const MODELO = 'claude-opus-5-5';

const numero = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const texto = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['legible', 'tipo_documento', 'proveedor', 'nit', 'documento', 'fecha', 'lineas', 'notas'],
  properties: {
    legible: { type: 'boolean' },
    tipo_documento: { type: 'string', enum: ['factura', 'tiquete', 'lista_precios', 'cotizacion', 'empaque', 'otro'] },
    proveedor: texto,
    nit: texto,
    documento: texto,
    fecha: texto,
    notas: texto,
    lineas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['descripcion', 'nombre_generico', 'marca', 'area_sugerida', 'cantidad', 'unidad', 'presentacion', 'valor_total', 'precio_unitario'],
        properties: {
          descripcion: { type: 'string' }, nombre_generico: texto, marca: texto, area_sugerida: { type: 'string', enum: ['BAR', 'COCINA', 'AMBAS'] }, cantidad: numero, unidad: texto, presentacion: texto,
          valor_total: numero, precio_unitario: numero,
        },
      },
    },
  },
} as const;

const Lectura = z.object({
  legible: z.boolean(),
  tipo_documento: z.enum(['factura', 'tiquete', 'lista_precios', 'cotizacion', 'empaque', 'otro']),
  proveedor: z.string().nullable(),
  nit: z.string().nullable(),
  documento: z.string().nullable(),
  fecha: z.string().nullable(),
  notas: z.string().nullable(),
  lineas: z.array(z.object({
    descripcion: z.string(),
    nombre_generico: z.string().nullable(),
    marca: z.string().nullable(),
    area_sugerida: z.enum(['BAR', 'COCINA', 'AMBAS']),
    cantidad: z.number().nullable(),
    unidad: z.string().nullable(),
    presentacion: z.string().nullable(),
    valor_total: z.number().nullable(),
    precio_unitario: z.number().nullable(),
  })),
});
export type LecturaPrecios = z.infer<typeof Lectura>;

const INSTRUCCIONES = `Lees fotos que muestran precios de lo que compra un restaurante en Cali, Colombia: facturas, tiquetes de supermercado o fruver, listas de precios, cotizaciones de proveedores y etiquetas de empaque. El objetivo es solo saber cuánto cuesta cada producto y en qué cantidad se compra; nada de esto entra al inventario. Una persona revisará y corregirá todo lo que propongas, así que es mejor dejar un campo en null que adivinarlo.

Devuelve:
- tipo_documento: qué es la foto.
- proveedor: quien vende, tal como está impreso (nunca el restaurante que compra: Di Égida / Tosca Bistró). null si no aparece.
- nit: el NIT del proveedor, solo dígitos y guion, si aparece.
- documento: número de factura, tiquete o cotización si lo hay.
- fecha: la fecha del documento en formato AAAA-MM-DD, si aparece.
- lineas: una por producto con precio, en el orden de la foto.
  - descripcion: el texto del producto como está impreso.
  - nombre_generico: cómo se llamaría el producto en el catálogo, sin marca, tamaño ni empaque, con mayúscula inicial y tildes correctas («AZUCAR MANUELITA 2500G» → «Azúcar blanca»; «GIN TANQUERAY LONDON DRY 700ML» → «Ginebra»; «CHAMPIÑON PARIS BANDEJA» → «Champiñón París»). Conserva lo que distingue un producto de otro (variedad, corte, calibre: «Camarón 36/40», «Lomo de cerdo», «Tomate cherry»).
  - area_sugerida: a qué zona del restaurante va: «BAR» para licores, vinos, cervezas, mixers, gaseosas, hielo, siropes y frutas o hierbas que se usan sobre todo en coctelería (piña, maracuyá, limón, hierbabuena, frutos rojos para cócteles); «COCINA» para carnes, pescados, verduras, abarrotes, lácteos y lo de aseo de cocina; «AMBAS» si se usa claramente en las dos (limón, naranja, azúcar). Ante la duda, la que más lo usaría.
  - marca: la marca comercial si aparece («Manuelita», «Tanqueray London Dry», «Alpina»); null en productos a granel o sin marca (frutas, verduras, carnes del proveedor).
  - cantidad y unidad: cuánto se compró o a qué cantidad corresponde el precio, con la unidad escrita como aparece («2» y «KG», «6» y «UNIDAD», «1» y «LIBRA», «1» y «CAJA»). En una lista de precios sin cantidad, la cantidad es 1 y la unidad la que indique el precio («$ 8.500 / kg» → 1 y «KG»).
  - presentacion: el tamaño del empaque si se ve («Bolsa 1000 g», «Botella 750 ml», «Caja x 12 und», «Galón 3,78 L»). null si no se dice.
  - valor_total: lo que vale esa línea en pesos (cantidad × precio unitario), con el IVA incluido si se suma por línea.
  - precio_unitario: el precio de una unidad de las que dice «unidad», si se ve.
  Lo que no es un producto (domicilio, propina, subtotales, descuentos globales, impuestos sueltos) no es una línea.
- notas: en una frase, lo que la persona deba revisar (IVA solo en el total, descuentos, una línea ilegible, precios que parecen de otra unidad). null si no hay nada.
- legible: false si la imagen no muestra precios o no se puede leer; en ese caso deja lineas vacía.

Los montos colombianos usan punto para miles y coma para decimales: «$ 52.600» es 52600 y «1,5» es 1.5. Devuelve números sin símbolos ni separadores de miles. No inventes líneas que no se vean.`;

export type ResultadoLectura = { ok: true; lectura: LecturaPrecios } | { ok: false; error: string };

export async function leerPreciosConIA(datos: Uint8Array, tipo: string): Promise<ResultadoLectura> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: 'La lectura con IA no está configurada (falta ANTHROPIC_API_KEY en el servidor). Avísele a administración.' };
  }
  const base64 = Buffer.from(datos).toString('base64');
  const adjunto: Anthropic.Beta.BetaContentBlockParam = tipo === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: tipo as 'image/jpeg' | 'image/png' | 'image/webp', data: base64 } };

  const cliente = new Anthropic({ timeout: 90_000, maxRetries: 1 });
  try {
    const respuesta = await cliente.beta.messages.create({
      model: MODELO,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: ESQUEMA } },
      system: INSTRUCCIONES,
      messages: [{ role: 'user', content: [adjunto, { type: 'text', text: 'Saca los precios de esta foto.' }] }],
    });
    if (respuesta.stop_reason === 'refusal') return { ok: false, error: 'La IA no quiso leer esta imagen. Pruebe con otra foto.' };
    if (respuesta.stop_reason === 'max_tokens') return { ok: false, error: 'La foto tiene demasiadas líneas para leerla de una vez: tómala por partes.' };
    const json = respuesta.content.find((b) => b.type === 'text')?.text;
    const leida = Lectura.safeParse(json ? JSON.parse(json) : null);
    if (!leida.success) return { ok: false, error: 'La IA devolvió una respuesta que no se entiende. Inténtalo de nuevo.' };
    return { ok: true, lectura: leida.data };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: 'La IA está ocupada. Espere un minuto e inténtelo de nuevo.' };
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: 'La clave de la API de Claude no es válida. Avísele a administración.' };
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, error: 'No hubo conexión con la IA. Inténtalo de nuevo.' };
    if (e instanceof Anthropic.APIError) return { ok: false, error: `La IA respondió con un error (${e.status}). Inténtalo de nuevo.` };
    if (e instanceof SyntaxError) return { ok: false, error: 'La IA devolvió una respuesta que no se entiende. Inténtalo de nuevo.' };
    throw e;
  }
}
