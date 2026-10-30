'use server';
import { revalidatePath } from 'next/cache';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import type { Resultado } from '@/lib/catalogo';

export type ResultadoLote = Resultado & { costo_total?: number; costo_unitario?: number | null; estado_costo?: string; rendimiento?: number };

// Todas las reglas (permiso, MPI y ficha válidos, conversiones, saldo en la zona, neto) y el costo
// del lote las aplica public.registrar_lote en una sola transacción.
export async function registrarLote(payload: Record<string, unknown>): Promise<ResultadoLote> {
  const perfil = await perfilActual();
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('registrar_lote', { p: { ...payload, responsable_id: perfil.id } });
  if (error) return { ok: false, id: null, codigo: null, fatales: [error.message], bloqueos: [], avisos: [] };
  if ((data as Resultado).ok) {
    revalidatePath('/producir');
    revalidatePath('/existencias');
  }
  return data as ResultadoLote;
}
