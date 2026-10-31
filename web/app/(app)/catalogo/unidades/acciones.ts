'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';

export type ResultadoPropuestas = { ok: number; fallidos: number; detalle: { id: string; codigo: string; ok: boolean; mensaje?: string }[] };

// Aceptar aplica cada propuesta con public.editar_producto y sus reglas; lo que no se puede queda
// pendiente con el motivo (public.decidir_propuestas_unidad).
export async function decidirPropuestas(ids: string[], decision: 'ACEPTAR' | 'RECHAZAR', correccion: Record<string, unknown> | null = null):
  Promise<ResultadoPropuestas | { error: string }> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('decidir_propuestas_unidad', { p_ids: ids, p_decision: decision, p_correccion: correccion });
  if (error) return { error: error.message };
  revalidatePath('/catalogo', 'layout');
  return data as ResultadoPropuestas;
}
