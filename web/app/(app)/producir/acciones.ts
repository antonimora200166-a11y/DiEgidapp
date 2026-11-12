'use server';
import { revalidatePath } from 'next/cache';
import { perfilActual } from '@/lib/sesion';
import { enviar } from '@/lib/enviar';
import type { Resultado } from '@/lib/catalogo';

export type ResultadoLote = Resultado & {
  costo_total?: number; costo_unitario?: number | null; estado_costo?: string; rendimiento?: number | null;
  entrada_g?: number | null; neto_g?: number | null; merma_g?: number | null; desvio_pp?: number | null; costo_gramo?: number | null;
  vence?: string | null; conservacion?: string | null;
};

// Todas las reglas (permiso, MPI y ficha válidos, conversiones, saldo en la zona, neto) y el costo
// del lote las aplica public.registrar_lote en una sola transacción.
export async function registrarLote(payload: Record<string, unknown>, clave?: string): Promise<ResultadoLote> {
  const perfil = await perfilActual();
  const data = await enviar<ResultadoLote>('registrar_lote', { ...payload, responsable_id: payload.responsable_id || perfil.id }, clave);
  if (data.ok) {
    revalidatePath('/producir');
    revalidatePath('/existencias');
    revalidatePath('/produccion', 'layout');
  }
  return data;
}
