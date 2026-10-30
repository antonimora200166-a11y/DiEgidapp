'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';
import type { Resultado } from '@/lib/catalogo';

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
