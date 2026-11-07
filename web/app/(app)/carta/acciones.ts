'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';

// El precio tiene historia: public.fijar_precio guarda uno por día y revisa el permiso del área.
export async function fijarPrecio(generico: string, precio: number): Promise<{ ok: boolean; error?: string }> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('fijar_precio', { p_generico: generico, p_precio: precio });
  if (error) return { ok: false, error: error.message };
  if ((data as { ok: boolean }).ok) revalidatePath('/carta');
  return data as { ok: boolean; error?: string };
}

// Baúl: cócteles y platos que no se venden. Guardan la ficha pero no salen en carta, fichas ni tableros.
export async function moverAlBaul(genericos: string[], motivo: string): Promise<{ ok: boolean; error?: string; movidos?: number }> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('mover_al_baul', { p_genericos: genericos, p_motivo: motivo || null });
  if (error) return { ok: false, error: error.message };
  revalidarBaul();
  return data as { ok: boolean; error?: string; movidos?: number };
}

export async function sacarDelBaul(genericos: string[]): Promise<{ ok: boolean; error?: string; sacados?: number }> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('sacar_del_baul', { p_genericos: genericos });
  if (error) return { ok: false, error: error.message };
  revalidarBaul();
  return data as { ok: boolean; error?: string; sacados?: number };
}

function revalidarBaul() {
  revalidatePath('/carta');
  revalidatePath('/fichas', 'layout');
  revalidatePath('/produccion/validar', 'layout');
}
