'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';

export type ResultadoEliminar = { ok: number; fallidos: number; detalle: { id: string; codigo: string; ok: boolean; mensaje?: string }[] };

// Solo administración (la base lo revisa): eliminar deja el producto inactivo, con motivo en la
// bitácora; no deja si tiene saldo o si su genérico está en una ficha vigente.
export async function eliminarProductos(ids: string[], motivo: string): Promise<ResultadoEliminar | { error: string }> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('eliminar_productos', { p_ids: ids, p_motivo: motivo });
  if (error) return { error: error.message };
  revalidatePath('/', 'layout');
  return data as ResultadoEliminar;
}

export async function reactivarProductos(ids: string[]): Promise<ResultadoEliminar | { error: string }> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('reactivar_productos', { p_ids: ids });
  if (error) return { error: error.message };
  revalidatePath('/', 'layout');
  return data as ResultadoEliminar;
}
