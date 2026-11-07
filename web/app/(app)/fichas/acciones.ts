'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';
import type { Resultado } from '@/lib/catalogo';
import { perfilActual } from '@/lib/sesion';
import { editaFicha } from '@/lib/roles';
import { proponerDescripcionConIA, type ResultadoDescripcion } from '@/lib/descripcion-ia';

// Permiso, ingredientes válidos, conversiones nuevas y versión nueva si ya costeó lotes: public.guardar_ficha.
export async function guardarFicha(payload: Record<string, unknown>): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('guardar_ficha', { p: payload });
  if (error) return { ok: false, id: null, codigo: null, fatales: [error.message], bloqueos: [], avisos: [] };
  if ((data as Resultado).ok) {
    revalidatePath('/fichas', 'layout');
    revalidatePath('/producir');
  }
  return data as Resultado;
}

// Propuesta de descripción con IA para la ficha de una BEBIDA o un PLATO. Toma lo que está en el
// editor (aunque no se haya guardado) y los nombres reales del catálogo; de cada MPI suma lo que lleva
// su ficha vigente. No guarda nada: la propuesta la acepta o descarta quien edita la ficha.
export async function proponerDescripcion(p: {
  generico_id: string; metodo: string; presentacion: string; pasos: string[]; descripcion: string;
  lineas: { generico_id: string; cantidad: string; unidad: string; nota: string }[];
}): Promise<ResultadoDescripcion> {
  const perfil = await perfilActual();
  const supabase = await supabaseServidor();
  const { data: g } = await supabase.from('genericos').select('id, nombre, tipo, area').eq('id', p.generico_id).maybeSingle();
  if (!g || (g.tipo !== 'BEBIDA' && g.tipo !== 'PLATO')) return { ok: false, error: 'La descripción con IA es solo para bebidas y platos de la carta.' };
  if (!editaFicha(perfil, g.area)) return { ok: false, error: `Solo el ${g.area === 'BAR' ? 'jefe de barra' : 'chef'} o administración editan esta ficha.` };
  const lineas = p.lineas.filter((l) => l.generico_id).slice(0, 60);
  if (!lineas.length) return { ok: false, error: 'Agrega los ingredientes antes de pedir la descripción.' };

  const ids = [...new Set(lineas.map((l) => l.generico_id))];
  const { data: ings } = await supabase.from('genericos').select('id, nombre, tipo').in('id', ids);
  const porId = new Map((ings ?? []).map((i) => [i.id, i]));
  const mpis = (ings ?? []).filter((i) => i.tipo === 'MPI').map((i) => i.id);
  const lleva = new Map<string, { descripcion: string | null; nombres: string[] }>();
  if (mpis.length) {
    const { data: fs } = await supabase.from('fichas').select('id, generico_id, descripcion').in('generico_id', mpis).is('vigente_hasta', null);
    const { data: ls } = fs?.length
      ? await supabase.from('ficha_lineas').select('ficha_id, linea, genericos(nombre)').in('ficha_id', fs.map((f) => f.id)).order('linea')
      : { data: [] };
    for (const f of fs ?? []) {
      const nombres = (ls ?? []).filter((l) => l.ficha_id === f.id)
        .map((l) => (l.genericos as unknown as { nombre: string } | null)?.nombre).filter((n): n is string => !!n);
      lleva.set(f.generico_id, { descripcion: f.descripcion, nombres });
    }
  }

  return proponerDescripcionConIA({
    nombre: g.nombre, tipo: g.tipo, area: g.area,
    metodo: p.metodo.slice(0, 300), presentacion: p.presentacion.slice(0, 600), descripcion_actual: p.descripcion.slice(0, 800),
    pasos: p.pasos.slice(0, 30).map((s) => s.slice(0, 400)),
    ingredientes: lineas.filter((l) => porId.has(l.generico_id)).map((l) => ({
      nombre: porId.get(l.generico_id)!.nombre, cantidad: String(l.cantidad ?? '').slice(0, 20), unidad: String(l.unidad ?? '').slice(0, 10),
      nota: String(l.nota ?? '').slice(0, 120), lleva: lleva.get(l.generico_id)?.nombres ?? [], descripcion: lleva.get(l.generico_id)?.descripcion ?? null,
    })),
  });
}
