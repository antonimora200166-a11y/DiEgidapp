'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';
import type { Resultado } from '@/lib/catalogo';

// Bajas y traslados: todas las reglas (permiso, causa, saldo en la zona, conversiones) las aplican
// public.registrar_baja y public.registrar_traslado en una sola transacción.
async function rpc(nombre: 'registrar_baja' | 'registrar_traslado', payload: Record<string, unknown>): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc(nombre, { p: payload });
  if (error) return { ok: false, id: null, codigo: null, fatales: [error.message], bloqueos: [], avisos: [] };
  if ((data as Resultado).ok) {
    revalidatePath('/existencias');
    revalidatePath(nombre === 'registrar_baja' ? '/bajas' : '/trasladar');
  }
  return data as Resultado;
}

export async function registrarBaja(payload: Record<string, unknown>) { return rpc('registrar_baja', payload); }
export async function registrarTraslado(payload: Record<string, unknown>) { return rpc('registrar_traslado', payload); }
