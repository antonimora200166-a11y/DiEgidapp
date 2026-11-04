// Solo servidor: lo importan las acciones de app/(app)/recibir (usa la clave secreta de la API).
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// Lectura de la foto de una factura con la API de Claude. Solo PROPONE: la persona confirma o
// corrige cada línea en la pantalla Recibir y la base vuelve a pasar todas las compuertas.
// Necesita ANTHROPIC_API_KEY en el servidor (Vercel → Environment Variables); nunca va al navegador.

const MODELO = 'claude-opus-5-5';

const numero = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const texto = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['legible', 'proveedor', 'nit', 'documento', 'fecha', 'lineas', 'total_factura', 'notas'],
  properties: {
    legible: { type: 'boolean' },
    proveedor: texto,
    nit: texto,
    documento: texto,
    fecha: texto,
    total_factura: numero,
    notas: texto,
    lineas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['descripcion', 'cantidad', 'unidad', 'valor_total'],
        properties: { descripcion: { type: 'string' }, cantidad: numero, unidad: texto, valor_total: numero },
      },
    },
  },
} as const;

const Propuesta = z.object({
  legible: z.boolean(),
  proveedor: z.string().nullable(),
  nit: z.string().nullable(),
  documento: z.string().nullable(),
  fecha: z.string().nullable(),
  total_factura: z.number().nullable(),
  notas: z.string().nullable(),
  lineas: z.array(z.object({
    descripcion: z.string(),
    cantidad: z.number().nullable(),
    unidad: z.string().nullable(),
    valor_total: z.number().nullable(),
  })),
});
export type PropuestaFactura = z.infer<typeof Propuesta>;

const INSTRUCCIONES = `Lees fotos de facturas y remisiones de proveedores de un restaurante en Cali, Colombia, para que el personal no tenga que digitarlas. Una persona revisará y corregirá todo lo que propongas, así que es mejor dejar un campo en null que adivinarlo.

Devuelve:
- proveedor: la razón social o el nombre comercial del que vende (no el del restaurante que compra, Di Égida / Tosca Bistró).
- nit: el NIT del proveedor, solo dígitos y guion, si aparece.
- documento: el número de la factura o remisión, tal como está impreso (con su prefijo, p. ej. «FE-12345»).
- fecha: la fecha de emisión en formato AAAA-MM-DD.
- lineas: una por producto, en el orden de la factura. descripcion es el texto del producto como está impreso. cantidad y unidad son las de la factura («2» y «KG», «6» y «UND», «1» y «CJA»). valor_total es lo que se cobra por esa línea en pesos, con el IVA incluido si la factura lo suma por línea.
- total_factura: el total a pagar.
- notas: en una frase, lo que la persona deba revisar (IVA solo en el total, descuentos globales, una línea ilegible, ítems que no son insumos como domicilio o bolsas). null si no hay nada.
- legible: false si la imagen no es una factura o no se puede leer; en ese caso deja lineas vacía.

Los montos colombianos usan punto para miles y coma para decimales: «$ 52.600» es 52600 y «1,5» es 1.5. Devuelve números sin símbolos ni separadores de miles. No inventes líneas que no se vean.`;

export type ResultadoIA = { ok: true; propuesta: PropuestaFactura } | { ok: false; error: string };

export async function leerFacturaConIA(datos: Uint8Array, tipo: string): Promise<ResultadoIA> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: 'La lectura con IA no está configurada (falta ANTHROPIC_API_KEY). Registra las líneas a mano.' };
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
      messages: [{ role: 'user', content: [adjunto, { type: 'text', text: 'Lee esta factura.' }] }],
    });
    if (respuesta.stop_reason === 'refusal') return { ok: false, error: 'La IA no quiso leer esta imagen. Registra las líneas a mano.' };
    if (respuesta.stop_reason === 'max_tokens') return { ok: false, error: 'La factura es demasiado larga para leerla de una vez. Registra las líneas a mano.' };
    const json = respuesta.content.find((b) => b.type === 'text')?.text;
    const leida = Propuesta.safeParse(json ? JSON.parse(json) : null);
    if (!leida.success) return { ok: false, error: 'La IA devolvió una respuesta que no se entiende. Registra las líneas a mano.' };
    return { ok: true, propuesta: leida.data };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: 'La IA está ocupada. Espera un minuto e inténtalo de nuevo.' };
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: 'La clave de la API de Claude no es válida. Avísale a administración.' };
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, error: 'No hubo conexión con la IA. Inténtalo de nuevo o registra las líneas a mano.' };
    if (e instanceof Anthropic.APIError) return { ok: false, error: `La IA respondió con un error (${e.status}). Registra las líneas a mano.` };
    if (e instanceof SyntaxError) return { ok: false, error: 'La IA devolvió una respuesta que no se entiende. Registra las líneas a mano.' };
    throw e;
  }
}

export type EstadoIA = { variable: boolean; final: string | null; clave: 'ok' | 'invalida' | 'error' | null; modelo: string;
                         prueba: 'ok' | 'sin-credito' | 'error' | null; detalle: string | null };

// Para la página de administración: si Vercel tiene la clave y Anthropic la acepta. Consultar el
// modelo no cuesta; la prueba opcional manda un mensaje de una palabra (fracciones de centavo) y es
// lo único que confirma que la cuenta tiene crédito.
export async function estadoIA(probar: boolean): Promise<EstadoIA> {
  const k = process.env.ANTHROPIC_API_KEY?.trim();
  const e: EstadoIA = { variable: !!k, final: k ? k.slice(-4) : null, clave: null, modelo: MODELO, prueba: null, detalle: null };
  if (!k) return e;
  const cliente = new Anthropic({ timeout: 20_000, maxRetries: 0 });
  try {
    await cliente.models.retrieve(MODELO);
    e.clave = 'ok';
  } catch (x) {
    e.clave = x instanceof Anthropic.AuthenticationError || x instanceof Anthropic.PermissionDeniedError ? 'invalida' : 'error';
    e.detalle = x instanceof Anthropic.APIError ? `${x.status ?? ''} ${x.message}`.trim() : String(x);
    return e;
  }
  if (!probar) return e;
  try {
    await cliente.messages.create({ model: MODELO, max_tokens: 5, messages: [{ role: 'user', content: 'Responde: ok' }] });
    e.prueba = 'ok';
  } catch (x) {
    const m = x instanceof Anthropic.APIError ? x.message : String(x);
    e.prueba = /credit|balance|billing/i.test(m) ? 'sin-credito' : 'error';
    e.detalle = x instanceof Anthropic.APIError ? `${x.status ?? ''} ${m}`.trim() : m;
  }
  return e;
}
