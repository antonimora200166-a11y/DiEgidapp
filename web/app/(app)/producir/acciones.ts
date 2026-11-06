'use server';
import { revalidatePath } from 'next/cache';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import type { Resultado } from '@/lib/catalogo';

export type ResultadoLote = Resultado & {
  costo_total?: number; costo_unitario?: number | null; estado_costo?: string; rendimiento?: number | null;
  entrada_g?: number | null; neto_g?: number | null; merma_g?: number | null; desvio_pp?: number | null; costo_gramo?: number | null;
  vence?: string | null; conservacion?: string | null;
};

// Todas las reglas (permiso, MPI y ficha válidos, conversiones, saldo en la zona, neto) y el costo
// del lote las aplica public.registrar_lote en una sola transacción.
export async function registrarLote(payload: Record<string, unknown>): Promise<ResultadoLote> {
  const perfil = await perfilActual();
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('registrar_lote', { p: { ...payload, responsable_id: payload.responsable_id || perfil.id } });
  if (error) return { ok: false, id: null, codigo: null, fatales: [error.message], bloqueos: [], avisos: [] };
  if ((data as Resultado).ok) {
    revalidatePath('/producir');
    revalidatePath('/existencias');
    revalidatePath('/produccion', 'layout');
  }
  return data as ResultadoLote;
}
