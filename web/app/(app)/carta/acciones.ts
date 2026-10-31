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
