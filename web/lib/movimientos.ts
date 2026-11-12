'use server';
import { revalidatePath } from 'next/cache';
import { enviar } from '@/lib/enviar';
import type { Resultado } from '@/lib/catalogo';

// Bajas y traslados: todas las reglas (permiso, causa, saldo en la zona, conversiones) las aplican
// public.registrar_baja y public.registrar_traslado en una sola transacción, por la puerta public.enviar.
async function registrar(nombre: 'registrar_baja' | 'registrar_traslado', payload: Record<string, unknown>, clave?: string): Promise<Resultado> {
  const r = await enviar(nombre, payload, clave);
  if (r.ok) {
    revalidatePath('/existencias');
    revalidatePath(nombre === 'registrar_baja' ? '/bajas' : '/trasladar');
  }
  return r;
}

export async function registrarBaja(payload: Record<string, unknown>, clave?: string) { return registrar('registrar_baja', payload, clave); }
export async function registrarTraslado(payload: Record<string, unknown>, clave?: string) { return registrar('registrar_traslado', payload, clave); }
