// Solo servidor: lo importa la acción proponerDescripcion de app/(app)/fichas (usa la clave secreta de la API).
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// Propuesta de descripción para la ficha de una bebida o un plato de la carta, hecha con los
// ingredientes reales de la ficha (y lo que lleva cada MPI). Es solo una propuesta: el jefe de barra
// o el chef la lee, la cambia o la descarta, y nada se guarda hasta que guarde la versión de la ficha.

const MODELO = 'claude-opus-5-5';

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['descripcion', 'perfil', 'aviso'],
  properties: {
    descripcion: { type: 'string' },
    perfil: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['eje', 'detalle'],
        properties: { eje: { type: 'string' }, detalle: { type: 'string' } },
      },
    },
    aviso: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const;

const Propuesta = z.object({
  descripcion: z.string().min(1),
  perfil: z.array(z.object({ eje: z.string(), detalle: z.string() })),
  aviso: z.string().nullable(),
});
export type PropuestaDescripcion = z.infer<typeof Propuesta>;

export type EntradaDescripcion = {
  nombre: string;
  tipo: 'BEBIDA' | 'PLATO';
  area: 'BAR' | 'COCINA';
  metodo: string;
  presentacion: string;
  pasos: string[];
  descripcion_actual: string;
  ingredientes: { nombre: string; cantidad: string; unidad: string; nota: string; lleva: string[]; descripcion: string | null }[];
};

const INSTRUCCIONES = `Eres el asesor de carta de Di Égida (Tosca Bistró), un restaurante y bar en Cali, Colombia. Escribes la descripción de la ficha técnica de una bebida o un plato a partir de su receta real. La lee el equipo (barra, cocina y meseros) para saber qué es, cómo debe quedar y cómo contárselo al cliente; el jefe de barra o el chef decide si la usa.

Cómo trabajar:
1. Lee los ingredientes con sus cantidades. Lo que pesa más en la receta manda en el sabor; un dash, unas gotas o una decoración aportan aroma o acento, no la base. Si un ingrediente es una preparación propia (MPI), ten en cuenta lo que lleva por dentro.
2. Arma el perfil de sabor con la teoría del balance: dulce, ácido, amargo, salado, umami, picante, graso, alcohol o cuerpo, y los aromáticos (cítricos, herbales, florales, especiados, tostados, ahumados, frutales). Fíjate en cómo se equilibran: el ácido corta el dulce y la grasa, el amargo alarga el final, la sal realza, la textura (espuma, crocante, cremoso, burbuja) cambia la sensación. En bebidas piensa en la familia (sour, highball, stirred, tiki, spritz, sin alcohol); en platos, en la técnica de cocción y el contraste de texturas y temperaturas.
3. Escribe la descripción: 2 a 4 frases en español de Colombia, en tercera persona, cálida y precisa, sin exagerar. Di qué es, a qué sabe (de la entrada al final), su textura o cuerpo y, si ayuda, cómo se ve (color, montaje, decoración) según la presentación. Nombra solo ingredientes que estén en la receta y no inventes técnicas, orígenes, marcas ni maridajes que no se desprendan de ella. Nada de clichés vacíos («explosión de sabores», «experiencia única»), emojis ni signos de exclamación. Máximo unas 70 palabras.
4. Si hay una descripción actual, consérvale lo que sea cierto y útil, y corrige lo que no cuadre con los ingredientes.

Devuelve:
- descripcion: el texto listo para la ficha.
- perfil: de 3 a 6 ejes que expliquen la propuesta, cada uno con «eje» (Dulce, Ácido, Amargo, Aromático, Cuerpo, Textura, Final…) y «detalle» corto que diga qué ingrediente lo aporta («limón y maracuyá, bien marcado»).
- aviso: en una frase, lo que el jefe deba revisar (ingredientes sin cantidad, una combinación que se ve descompensada, la descripción actual dice algo que no está en la receta). null si no hay nada.`;

function armarReceta(e: EntradaDescripcion) {
  const ing = e.ingredientes.map((i) => {
    const cant = i.cantidad.trim() ? `${i.cantidad} ${i.unidad}` : 'sin cantidad';
    let s = `- ${i.nombre}: ${cant}${i.nota.trim() ? ` (${i.nota.trim()})` : ''}`;
    if (i.lleva.length) s += `\n    preparación propia; lleva: ${i.lleva.join(', ')}`;
    if (i.descripcion) s += `\n    así se describe: ${i.descripcion}`;
    return s;
  }).join('\n');
  const pasos = e.pasos.map((p) => p.trim()).filter(Boolean);
  return [
    `${e.tipo === 'BEBIDA' ? 'Bebida' : 'Plato'}: ${e.nombre} (${e.area === 'BAR' ? 'barra' : 'cocina'})`,
    `Ingredientes:\n${ing || '- (sin ingredientes)'}`,
    e.metodo.trim() && `Método o técnica: ${e.metodo.trim()}`,
    pasos.length > 0 && `Procedimiento:\n${pasos.map((p, i) => `${i + 1}. ${p}`).join('\n')}`,
    e.presentacion.trim() && `Presentación: ${e.presentacion.trim()}`,
    e.descripcion_actual.trim() && `Descripción actual: ${e.descripcion_actual.trim()}`,
  ].filter(Boolean).join('\n\n');
}

export type ResultadoDescripcion = { ok: true; propuesta: PropuestaDescripcion } | { ok: false; error: string };

export async function proponerDescripcionConIA(e: EntradaDescripcion): Promise<ResultadoDescripcion> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: 'La IA no está configurada (falta ANTHROPIC_API_KEY en el servidor). Avísale a administración.' };
  }
  const cliente = new Anthropic({ timeout: 60_000, maxRetries: 1 });
  try {
    const respuesta = await cliente.beta.messages.create({
      model: MODELO,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: ESQUEMA } },
      system: INSTRUCCIONES,
      messages: [{ role: 'user', content: `Propón la descripción para esta ficha.\n\n${armarReceta(e)}` }],
    });
    if (respuesta.stop_reason === 'refusal') return { ok: false, error: 'La IA no quiso proponer una descripción. Inténtalo de nuevo.' };
    if (respuesta.stop_reason === 'max_tokens') return { ok: false, error: 'La respuesta de la IA quedó cortada. Inténtalo de nuevo.' };
    const json = respuesta.content.find((b) => b.type === 'text')?.text;
    const leida = Propuesta.safeParse(json ? JSON.parse(json) : null);
    if (!leida.success) return { ok: false, error: 'La IA devolvió una respuesta que no se entiende. Inténtalo de nuevo.' };
    return { ok: true, propuesta: leida.data };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return { ok: false, error: 'La IA está ocupada. Espera un minuto e inténtalo de nuevo.' };
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, error: 'La clave de la API de Claude no es válida. Avísale a administración.' };
    if (err instanceof Anthropic.APIConnectionError) return { ok: false, error: 'No hubo conexión con la IA. Inténtalo de nuevo.' };
    if (err instanceof Anthropic.APIError) return { ok: false, error: `La IA respondió con un error (${err.status}). Inténtalo de nuevo.` };
    if (err instanceof SyntaxError) return { ok: false, error: 'La IA devolvió una respuesta que no se entiende. Inténtalo de nuevo.' };
    throw err;
  }
}
