'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';
import type { Resultado } from '@/lib/catalogo';

// Permiso (admin o jefe del área), motivo mínimo y reversa de los movimientos: public.anular_documento.
export async function anularDocumento(tipo: string, id: string, motivo: string, lineaId: string | null): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('anular_documento', { p_tipo: tipo, p_id: id, p_motivo: motivo, p_linea_id: lineaId });
  if (error) return { ok: false, id: null, codigo: null, fatales: [error.message], bloqueos: [], avisos: [] };
  if ((data as Resultado).ok) {
    revalidatePath('/historial', 'layout');
    revalidatePath('/existencias');
  }
  return data as Resultado;
}
