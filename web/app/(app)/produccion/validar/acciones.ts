'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';
import type { Resultado } from '@/lib/catalogo';
import type { DatosFicha } from '../../fichas/[generico]/EditorFicha';
import { inicialDesdePropuesta, payloadSinCambios, type Propuesta } from '@/lib/propuesta-ficha';

// un archivo 'use server' solo exporta funciones: la fuente llega como texto
type Ok = { ok: boolean; error?: string; n?: number };
const FUENTES = ['RECETARIO COCINA', 'CARTA COCTELERÍA'];
const f = (fuente?: string) => (fuente && FUENTES.includes(fuente) ? fuente : 'RECETARIO COCINA');

async function rpc(nombre: string, args: Record<string, unknown>): Promise<Ok & Record<string, unknown>> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc(nombre, args);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/produccion/validar', 'layout');
  return { ok: true, ...(data as object) };
}

export async function decidirIngredientes(codigos: string[], decision: 'CONFIRMAR' | 'NUEVO' | 'EXCLUIR' | 'PENDIENTE', generico?: string | null, fuente?: string) {
  return rpc('decidir_ingredientes_recetario', { p_fuente: f(fuente), p_codigos: codigos, p_decision: decision, p_generico: generico ?? null });
}
export async function elegirReceta(codigo: string, generico: string | null, fuente?: string) {
  return rpc('elegir_receta_mpi', { p_fuente: f(fuente), p_codigo: codigo, p_generico: generico });
}
export async function marcarMpi(generico: string, estado: 'SIN_RECETA' | 'NO_ES_MPI' | null, nota?: string, fuente?: string) {
  return rpc('marcar_mpi', { p_generico: generico, p_estado: estado, p_nota: nota ?? null, p_fuente: f(fuente) });
}
export async function crearMpi(codigo: string, motivo?: string, fuente?: string): Promise<Resultado & { error?: string }> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('crear_mpi_desde_receta', { p_fuente: f(fuente), p_codigo: codigo, p_motivo: motivo ?? null });
  if (error) return { ok: false, id: null, codigo: null, fatales: [error.message], bloqueos: [], avisos: [] };
  revalidatePath('/produccion/validar', 'layout');
  return data as Resultado;
}
export async function aprobarReceta(payload: Record<string, unknown>): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('aprobar_receta', { p: payload });
  if (error) return { ok: false, id: null, codigo: null, fatales: [error.message], bloqueos: [], avisos: [] };
  if ((data as Resultado).ok) {
    revalidatePath('/produccion', 'layout');
    revalidatePath('/fichas', 'layout');
    revalidatePath('/carta');
  }
  return data as Resultado;
}

// Aprobar varias propuestas como vienen (sin editar), una tras otra; cada una pasa por las mismas reglas que en el editor.
// Si la receta aún no tiene su genérico, primero se le asigna el indicado (el de la propuesta por código igual).
export type ResultadoGrupo = { aprobadas: string[]; fallidas: { codigo: string; nombre: string; motivo: string }[] };
export async function aprobarComoVienen(items: { codigo: string; generico_id: string }[], fuente?: string): Promise<ResultadoGrupo> {
  const fu = f(fuente);
  const conIngredientes = fu === 'RECETARIO COCINA';
  const supabase = await supabaseServidor();
  const out: ResultadoGrupo = { aprobadas: [], fallidas: [] };
  for (const it of items.slice(0, 200)) {
    let nombre = it.codigo;
    const falla = (motivo: string) => out.fallidas.push({ codigo: it.codigo, nombre, motivo });
    try {
      let pr = await supabase.rpc('propuesta_receta', { p_fuente: fu, p_codigo: it.codigo });
      if (pr.error) { falla(pr.error.message); continue; }
      let p = pr.data as Propuesta;
      nombre = p.receta.nombre;
      if (p.receta.estado === 'APROBADA') { out.aprobadas.push(nombre); continue; }
      if (p.receta.generico_id !== it.generico_id) {
        const e = await supabase.rpc('elegir_receta_mpi', { p_fuente: fu, p_codigo: it.codigo, p_generico: it.generico_id });
        if (e.error) { falla(e.error.message); continue; }
        pr = await supabase.rpc('propuesta_receta', { p_fuente: fu, p_codigo: it.codigo });
        if (pr.error) { falla(pr.error.message); continue; }
        p = pr.data as Propuesta;
      }
      const fe = await supabase.rpc('ficha_para_editar', { p_generico: it.generico_id });
      if (fe.error) { falla(fe.error.message); continue; }
      const datos = fe.data as DatosFicha;
      const ini = inicialDesdePropuesta(p, datos, conIngredientes);
      if (conIngredientes && p.lineas.some((l) => !l.generico_id)) { falla('Tiene ingredientes sin emparejar: apruébala desde el editor.'); continue; }
      if (!ini.lineas.length) { falla('La ficha no tiene ingredientes.'); continue; }
      const motivo = `Aprobada en grupo con ${p.receta.codigo} de ${fu.toLowerCase()}`;
      const ap = await supabase.rpc('aprobar_receta', { p: { ...payloadSinCambios(datos, ini, motivo), fuente: fu, receta: it.codigo } });
      if (ap.error) { falla(ap.error.message); continue; }
      const r = ap.data as Resultado;
      if (r.ok) out.aprobadas.push(nombre);
      else falla([...r.fatales, ...r.bloqueos].join(' ') || 'No se pudo aprobar.');
    } catch (e) {
      falla(e instanceof Error ? e.message : String(e));
    }
  }
  revalidatePath('/produccion', 'layout');
  revalidatePath('/fichas', 'layout');
  revalidatePath('/carta');
  revalidatePath('/producir');
  return out;
}
