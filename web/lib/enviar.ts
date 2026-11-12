import { supabaseServidor } from '@/lib/supabase/server';
import type { Resultado } from '@/lib/catalogo';

export type FuncionRegistro = 'registrar_recepcion' | 'registrar_conteo' | 'registrar_baja' | 'registrar_traslado'
  | 'registrar_lote' | 'registrar_baja_carta' | 'anular_documento';

// Todo registro que mueve el kardex pasa por public.enviar: envío único por clave, cantidades fuera
// de lo normal y contenidos sin verificar (piden confirmar), y PIN cuando está activo.
// La clave la genera el formulario al abrirse; si llega dos veces, la base devuelve el primer resultado.
export async function enviar<T extends Resultado = Resultado>(funcion: FuncionRegistro, p: Record<string, unknown>, clave?: string | null): Promise<T> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('enviar', { p_clave: clave || null, p_funcion: funcion, p });
  if (error) return { ok: false, id: null, codigo: null, fatales: [error.message], bloqueos: [], avisos: [] } as unknown as T;
  const r = data as T;
  // lo que hay que confirmar lo muestra el aviso de revisión, no la lista de errores
  if (r.revisar?.length) r.fatales = [];
  return r;
}
