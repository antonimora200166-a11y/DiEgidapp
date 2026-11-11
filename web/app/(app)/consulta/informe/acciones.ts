'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';
import { redactarResumen, type ResultadoInforme } from '@/lib/informe-ia';

// Las cifras se leen otra vez de la base (no de la pantalla) antes de dárselas a la IA.
export async function redactar(periodo_id: string): Promise<ResultadoInforme> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('informe_cifras', { p_periodo: periodo_id });
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'No encontré el período.' };
  return redactarResumen(data);
}

export async function guardar(p: { periodo_id: string; resumen: string; modelo: string | null }): Promise<{ ok: boolean; error?: string; version?: number }> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('guardar_informe', { p });
  if (error) return { ok: false, error: error.message };
  const r = data as { ok: boolean; error?: string; version?: number };
  if (r.ok) revalidatePath('/consulta/informe');
  return r;
}
