'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';
import type { Resultado } from '@/lib/catalogo';

// un archivo 'use server' solo exporta funciones
const FUENTE = 'RECETARIO COCINA';
type Ok = { ok: boolean; error?: string; n?: number };

async function rpc(nombre: string, args: Record<string, unknown>): Promise<Ok & Record<string, unknown>> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc(nombre, args);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/produccion/validar', 'layout');
  return { ok: true, ...(data as object) };
}

export async function decidirIngredientes(codigos: string[], decision: 'CONFIRMAR' | 'NUEVO' | 'EXCLUIR' | 'PENDIENTE', generico?: string | null) {
  return rpc('decidir_ingredientes_recetario', { p_fuente: FUENTE, p_codigos: codigos, p_decision: decision, p_generico: generico ?? null });
}
export async function elegirReceta(codigo: string, generico: string | null) {
  return rpc('elegir_receta_mpi', { p_fuente: FUENTE, p_codigo: codigo, p_generico: generico });
}
export async function marcarMpi(generico: string, estado: 'SIN_RECETA' | 'NO_ES_MPI' | null, nota?: string) {
  return rpc('marcar_mpi', { p_generico: generico, p_estado: estado, p_nota: nota ?? null, p_fuente: FUENTE });
}
export async function crearMpi(codigo: string, motivo?: string): Promise<Resultado & { error?: string }> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('crear_mpi_desde_receta', { p_fuente: FUENTE, p_codigo: codigo, p_motivo: motivo ?? null });
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
  }
  return data as Resultado;
}
