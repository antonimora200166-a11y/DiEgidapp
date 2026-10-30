'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';
import type { Resultado } from '@/lib/catalogo';

// Las reglas (permiso, saldo, fichas, kardex al cambiar de unidad) las aplica public.decidir_par.
// factor: con unidades distintas, cuánto vale 1 unidad del lado que se absorbe en la del que queda.
export async function decidirPar(id: string, decision: 'FUSIONAR' | 'SEPARAR', conserva: 'A' | 'B', factor: number | null = null): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('decidir_par', { p_id: id, p_decision: decision, p_conserva: conserva, p_factor: factor });
  if (error) return { ok: false, id: null, codigo: null, fatales: [error.message], bloqueos: [], avisos: [] };
  revalidatePath('/catalogo/revision');
  revalidatePath('/');
  return data as Resultado;
}
