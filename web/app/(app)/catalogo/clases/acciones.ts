'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';
import type { Clase } from '@/lib/clases';

export type ResultadoClases = { ok: number; fallidos: number; detalle: { id: string; nombre: string; ok: boolean; mensaje?: string }[] };

// Aceptar aplica la clase con public.fijar_clase (con su categoría); rechazar lo deja como materia prima.
export async function decidirClases(ids: string[], decision: 'ACEPTAR' | 'RECHAZAR', clase: Clase | null = null):
  Promise<ResultadoClases | { error: string }> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('decidir_propuestas_clase', { p_ids: ids, p_decision: decision, p_clase: clase });
  if (error) return { error: error.message };
  revalidatePath('/catalogo', 'layout');
  return data as ResultadoClases;
}
