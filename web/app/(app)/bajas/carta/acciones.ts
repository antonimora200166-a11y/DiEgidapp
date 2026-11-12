'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';
import type { Resultado } from '@/lib/catalogo';
import { enviar } from '@/lib/enviar';

export type ResultadoCarta = Resultado & { costo_mp?: number | null; lineas?: number };

// Todas las reglas (ficha vigente, quién autoriza, saldo en la zona, costo) las aplica la base.
export async function registrarBajaCarta(p: Record<string, unknown>, clave?: string): Promise<ResultadoCarta> {
  const data = await enviar<ResultadoCarta>('registrar_baja_carta', p, clave);
  if (data.ok) { revalidatePath('/bajas', 'layout'); revalidatePath('/existencias'); }
  return data;
}

export async function registrarCobro(p: { baja_id: string; estado: 'DESCONTADO' | 'CONDONADO' | 'PENDIENTE'; nota: string }) {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('cobro_baja_carta', { p });
  if (error) return { ok: false, error: error.message };
  const r = data as { ok: boolean; error?: string };
  if (r.ok) revalidatePath('/bajas/carta');
  return r;
}
