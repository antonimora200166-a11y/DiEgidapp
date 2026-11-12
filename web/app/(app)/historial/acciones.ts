'use server';
import { revalidatePath } from 'next/cache';
import { enviar } from '@/lib/enviar';
import type { Resultado } from '@/lib/catalogo';

// Permiso (admin o jefe del área), motivo mínimo y reversa de los movimientos: public.anular_documento.
export async function anularDocumento(tipo: string, id: string, motivo: string, lineaId: string | null, pin?: string, clave?: string): Promise<Resultado> {
  const data = await enviar('anular_documento', { tipo, id, motivo, linea_id: lineaId, pin: pin || null }, clave);
  if (data.ok) {
    revalidatePath('/historial', 'layout');
    revalidatePath('/existencias');
  }
  return data;
}
