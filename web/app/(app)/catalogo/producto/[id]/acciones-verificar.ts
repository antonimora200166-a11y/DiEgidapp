'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';

export async function verificarContenido(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('verificar_contenido', { p_producto: id });
  if (error) return { ok: false, error: error.message };
  const r = data as { ok: boolean; error?: string };
  if (r.ok) { revalidatePath(`/catalogo/producto/${id}`); revalidatePath('/conteo', 'layout'); }
  return r;
}
