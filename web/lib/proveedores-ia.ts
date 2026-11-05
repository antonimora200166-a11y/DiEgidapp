// Solo servidor: usa la clave secreta de la API. Dos usos:
//   · elegirProveedorConIA: de la lista de proveedores, cuál es el de la foto aunque esté escrito distinto.
//   · analizarRiesgosConIA: cada vez que alguien lo pide (botón), busca en la web la situación del
//     momento y cruza con la dependencia de proveedores del restaurante. Solo propone: nada se cambia solo.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

export const MODELO_PROVEEDORES = 'claude-opus-5-5';

// ---------------------------------------------------------------- proveedor de la foto
const ESQUEMA_PROVEEDOR = {
  type: 'object', additionalProperties: false, required: ['proveedor', 'confianza', 'razon'],
  properties: {
    proveedor: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
    razon: { type: 'string' },
  },
} as const;
const Elegido = z.object({ proveedor: z.number().int().nullable(), confianza: z.enum(['alta', 'media', 'baja']), razon: z.string() });
export type ProveedorIA = { proveedor_id: string | null; confianza: 'alta' | 'media' | 'baja'; razon: string };

export async function elegirProveedorConIA(leido: { nombre: string | null; nit: string | null },
  lista: { id: string; nombre: string; alias: string[] }[]): Promise<ProveedorIA | null> {
  if (!process.env.ANTHROPIC_API_KEY || !leido.nombre || !lista.length) return null;
  const catalogo = lista.map((p, i) => `${i + 1}. ${p.nombre}${p.alias.length ? ` (también escrito: ${p.alias.join(', ')})` : ''}`).join('\n');
  const cliente = new Anthropic({ timeout: 45_000, maxRetries: 1 });
  try {
    const r = await cliente.beta.messages.create({
      model: MODELO_PROVEEDORES, max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA_PROVEEDOR } },
      system: [
        { type: 'text', text: `Un restaurante en Cali, Colombia, tiene una lista de proveedores escrita a mano a lo largo del tiempo, con el mismo proveedor a veces escrito de formas distintas («Fruver JC» y «Frutas y Verduras del Campo JC», «Carulla» y «Carulla La María»). Te paso el nombre (y NIT, si hay) leído en una factura y la lista. Di cuál de la lista es el mismo negocio que emitió la factura: por nombre comercial, razón social, siglas, sede o sucursal del mismo negocio, abreviaturas y errores de escritura. Si ninguno lo es, null: un negocio distinto con un nombre parecido no sirve (dos fruvers distintos no son el mismo). razon: una frase corta en español para quien revisa.` },
        { type: 'text', text: `Proveedores:\n${catalogo}`, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: `En la factura dice: «${leido.nombre}»${leido.nit ? `, NIT ${leido.nit}` : ''}.` }],
    });
    if (r.stop_reason !== 'end_turn') return null;
    const json = r.content.find((b) => b.type === 'text')?.text;
    const e = Elegido.safeParse(json ? JSON.parse(json) : null);
    if (!e.success) return null;
    const p = e.data.proveedor;
    return { proveedor_id: p !== null && p >= 1 && p <= lista.length ? lista[p - 1].id : null, confianza: e.data.confianza, razon: e.data.razon };
  } catch (x) {
    if (x instanceof Anthropic.APIError || x instanceof SyntaxError) return null;
    throw x;
  }
}

// ---------------------------------------------------------------- análisis de riesgos (cada vez que se pide)
const ESQUEMA_RIESGOS = {
  type: 'object', additionalProperties: false, required: ['resumen', 'riesgos', 'calendario'],
  properties: {
    resumen: { type: 'string' },
    riesgos: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['titulo', 'tipo', 'nivel', 'cuando', 'afecta', 'por_que', 'que_hacer'],
        properties: {
          titulo: { type: 'string' },
          tipo: { type: 'string', enum: ['concentracion', 'temporada', 'clima', 'logistica', 'precio', 'regulatorio', 'calidad', 'otro'] },
          nivel: { type: 'string', enum: ['alto', 'medio', 'bajo'] },
          cuando: { type: 'string' },
          afecta: { type: 'array', items: { type: 'string' } },
          por_que: { type: 'string' },
          que_hacer: { type: 'string' },
        },
      },
    },
    calendario: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['cuando', 'evento', 'efecto'],
        properties: { cuando: { type: 'string' }, evento: { type: 'string' }, efecto: { type: 'string' } },
      },
    },
  },
} as const;
const Riesgos = z.object({
  resumen: z.string(),
  riesgos: z.array(z.object({
    titulo: z.string(), tipo: z.enum(['concentracion', 'temporada', 'clima', 'logistica', 'precio', 'regulatorio', 'calidad', 'otro']),
    nivel: z.enum(['alto', 'medio', 'bajo']), cuando: z.string(), afecta: z.array(z.string()), por_que: z.string(), que_hacer: z.string(),
  })),
  calendario: z.array(z.object({ cuando: z.string(), evento: z.string(), efecto: z.string() })),
});
export type AnalisisRiesgos = z.infer<typeof Riesgos> & { contexto: string; fuentes: { titulo: string; url: string }[]; fecha: string };

const CONTEXTO_NEGOCIO = `Di Égida / Tosca Bistró es un restaurante con bar de coctelería en Cali (Valle del Cauca, Colombia). Compra fruver, cárnicos, pescados y mariscos, lácteos, abarrotes, licores (muchos importados), mixers y desechables, a distribuidores locales y supermercados mayoristas. Los mariscos llegan sobre todo del Pacífico (Buenaventura) y los productos de otras regiones por carretera (vía Buga–Buenaventura, Panamericana, Línea en La Línea).`;

export async function analizarRiesgosConIA(datos: unknown, hoy: string): Promise<{ ok: true; analisis: AnalisisRiesgos } | { ok: false; error: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: 'La IA no está configurada (falta ANTHROPIC_API_KEY en el servidor).' };
  const cliente = new Anthropic({ timeout: 240_000, maxRetries: 1 });
  try {
    // 1. lo que está pasando ahora: búsqueda en la web (puede pausarse y se continúa)
    const pedido = `Hoy es ${hoy}. ${CONTEXTO_NEGOCIO}

Busca en la web lo que en este momento y en los próximos tres meses puede afectar el abastecimiento o los precios de este restaurante: clima (El Niño / La Niña, lluvias y derrumbes en las vías del Valle y hacia Buenaventura), paros o bloqueos, vedas de pesca en el Pacífico, temporadas de alta demanda (Feria de Cali, diciembre, Semana Santa, temporada de fin de año), tasa de cambio para importados, alzas de salario mínimo, impuestos o precios regulados al empezar el año, escasez o alzas de alimentos reportadas en Colombia. Resume en viñetas solo lo que encuentres con fecha y fuente; di cuando algo es estacional y no una noticia de hoy.`;
    const mensajes: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: pedido }];
    let contexto = '';
    const fuentes = new Map<string, string>();
    for (let vuelta = 0; vuelta < 4; vuelta++) {
      const r = await cliente.beta.messages.stream({
        model: MODELO_PROVEEDORES, max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        output_config: { effort: 'medium' },
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8, user_location: { type: 'approximate', city: 'Cali', country: 'CO', timezone: 'America/Bogota' } }],
        messages: mensajes,
      }).finalMessage();
      for (const b of r.content) {
        if (b.type === 'text') contexto += b.text;
        if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
          for (const x of b.content) if (x.type === 'web_search_result') fuentes.set(x.url, x.title);
        }
      }
      if (r.stop_reason === 'refusal') return { ok: false, error: 'La IA no quiso hacer el análisis. Inténtalo de nuevo más tarde.' };
      if (r.stop_reason !== 'pause_turn') break;
      mensajes.push({ role: 'assistant', content: r.content });
    }

    // 2. cruzar con la dependencia del restaurante y devolverlo ordenado
    const r2 = await cliente.beta.messages.stream({
      model: MODELO_PROVEEDORES, max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'high', format: { type: 'json_schema', schema: ESQUEMA_RIESGOS } },
      system: `${CONTEXTO_NEGOCIO}

Eres quien asesora a la administración en compras. Con la dependencia de proveedores (gasto, participación, categorías concentradas, insumos que solo trae un proveedor) y lo que está pasando ahora, explica los riesgos concretos para este restaurante, de mayor a menor. Cada riesgo nombra los proveedores, categorías o insumos que afecta y una acción práctica (proveedor alterno, comprar antes, subir stock mínimo, cambiar el plato, negociar precio). Separa lo que es dependencia de un proveedor de lo que es temporada o situación externa. El calendario cubre los próximos 6 meses desde hoy. No inventes noticias: lo que no venga del contexto de la búsqueda trátalo como estacional o como posibilidad. Escribe en español claro, sin tecnicismos; «HHI» es un índice de concentración (más de 2.500 es muy concentrado, 1.500–2.500 moderado).`,
      messages: [{ role: 'user', content: `Hoy: ${hoy}

Dependencia de proveedores (JSON):
${JSON.stringify(datos)}

Lo que se encontró en la web hoy:
${contexto || '(no se encontró nada; usa solo lo estacional)'}` }],
    }).finalMessage();
    if (r2.stop_reason === 'refusal') return { ok: false, error: 'La IA no quiso hacer el análisis. Inténtalo de nuevo más tarde.' };
    if (r2.stop_reason === 'max_tokens') return { ok: false, error: 'El análisis quedó demasiado largo. Inténtalo de nuevo.' };
    const json = r2.content.find((b) => b.type === 'text')?.text;
    const a = Riesgos.safeParse(json ? JSON.parse(json) : null);
    if (!a.success) return { ok: false, error: 'La IA devolvió un análisis que no se entiende. Inténtalo de nuevo.' };
    return { ok: true, analisis: { ...a.data, contexto, fecha: hoy, fuentes: [...fuentes].slice(0, 15).map(([url, titulo]) => ({ url, titulo })) } };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: 'La IA está ocupada. Espera un minuto e inténtalo de nuevo.' };
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: 'La clave de la API de Claude no es válida. Revísala en Administración → IA.' };
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, error: 'No hubo conexión con la IA. Inténtalo de nuevo.' };
    if (e instanceof Anthropic.APIError) return { ok: false, error: `La IA respondió con un error (${e.status}): ${e.message}` };
    if (e instanceof SyntaxError) return { ok: false, error: 'La IA devolvió un análisis que no se entiende. Inténtalo de nuevo.' };
    throw e;
  }
}
