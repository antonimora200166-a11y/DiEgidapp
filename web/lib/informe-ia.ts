// Solo servidor: redacta el resumen de 5 líneas del informe quincenal con la API de Claude.
// La IA solo REDACTA: recibe las cifras que calculó la base (informe_cifras) y no puede usar
// otras. La persona lo lee, lo corrige si hace falta y lo guarda; lo guardado queda con sus cifras.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const MODELO = 'claude-opus-5-5';

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lineas'],
  properties: { lineas: { type: 'array', items: { type: 'string' } } },
} as const;
const Respuesta = z.object({ lineas: z.array(z.string()) });

const INSTRUCCIONES = `Redactas el resumen gerencial de cierre de quincena de un restaurante en Cali, Colombia (Di Égida – Tosca Bistró), para su administrador. Recibes en JSON las cifras del período que calculó el sistema de inventarios: ventas netas sin impoconsumo, CMV real (inventario inicial + compras + traslados − inventario final), CMV teórico (lo que debieron costar las ventas según las fichas técnicas), pérdidas reportadas (bajas), lo no explicado (real − teórico − pérdidas), los porcentajes sobre ventas, el período anterior del área si existe, los insumos con más diferencia entre teórico y real, las alertas abiertas que más pesan y las propuestas de carta sin decidir.

Escribe exactamente 5 líneas en español, cada una una frase completa y corta (máximo 30 palabras), en este orden:
1. Cómo cerró el período: % de costo real contra el teórico y la diferencia en puntos, con el semáforo si viene.
2. Qué explica la diferencia: pérdidas reportadas contra lo no explicado, en pesos.
3. Los insumos que más pesan en la diferencia (máximo tres), con su diferencia en pesos.
4. Comparación con el período anterior; si no hay período anterior, dilo en pocas palabras y usa la línea para ventas netas o cobertura.
5. Qué hacer primero: la alerta o la acción de mayor impacto según las cifras.

Reglas: usa solo los números que vienen en el JSON, sin calcular cifras nuevas salvo restas evidentes entre dos que vienen; si un dato falta o es null, no lo inventes ni lo estimes. Pesos colombianos con punto de miles y sin decimales («$1.250.000»); porcentajes con coma decimal («31,4 %»). Sin saludos, títulos, viñetas ni numeración: solo las 5 frases.`;

export type ResultadoInforme = { ok: true; texto: string; modelo: string } | { ok: false; error: string };

export async function redactarResumen(cifras: unknown): Promise<ResultadoInforme> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: 'La redacción con IA no está configurada (falta ANTHROPIC_API_KEY en el servidor). Puedes escribir el resumen a mano.' };
  }
  const cliente = new Anthropic({ timeout: 90_000, maxRetries: 1 });
  try {
    const respuesta = await cliente.beta.messages.create({
      model: MODELO,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: ESQUEMA } },
      system: INSTRUCCIONES,
      messages: [{ role: 'user', content: `Cifras del período:\n${JSON.stringify(cifras)}` }],
    });
    if (respuesta.stop_reason === 'refusal') return { ok: false, error: 'La IA no quiso redactar este resumen. Escríbelo a mano.' };
    if (respuesta.stop_reason === 'max_tokens') return { ok: false, error: 'La IA no terminó el resumen. Inténtalo de nuevo.' };
    const json = respuesta.content.find((b) => b.type === 'text')?.text;
    const r = Respuesta.safeParse(json ? JSON.parse(json) : null);
    if (!r.success || !r.data.lineas.length) return { ok: false, error: 'La IA devolvió una respuesta que no se entiende. Inténtalo de nuevo.' };
    return { ok: true, texto: r.data.lineas.slice(0, 5).map((l) => l.trim()).join('\n'), modelo: respuesta.model ?? MODELO };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: 'La IA está ocupada. Espere un minuto e inténtelo de nuevo.' };
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: 'La clave de la API de Claude no es válida.' };
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, error: 'No hubo conexión con la IA. Inténtalo de nuevo.' };
    if (e instanceof Anthropic.APIError) return { ok: false, error: `La IA respondió con un error (${e.status}).` };
    if (e instanceof SyntaxError) return { ok: false, error: 'La IA devolvió una respuesta que no se entiende. Inténtalo de nuevo.' };
    throw e;
  }
}
