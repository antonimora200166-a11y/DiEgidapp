'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';

export type Cierre = { ok: boolean; error?: string; faltan?: string[]; id?: string };

export async function cerrarPeriodo(p: { area: string; desde: string; hasta: string; nota: string; forzar: boolean; motivo: string }): Promise<Cierre> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('cerrar_periodo', { p });
  if (error) return { ok: false, error: error.message };
  const r = data as Cierre;
  if (r.ok) revalidatePath('/consulta', 'layout');
  return r;
}
