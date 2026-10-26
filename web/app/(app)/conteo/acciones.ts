'use server';
import { revalidatePath } from 'next/cache';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import type { Resultado } from '@/lib/catalogo';

export type LineaConteo = { producto_id: string; cantidad?: number; unidades_compra?: number; peso_bruto_g?: number };
export type ResultadoConteo = Resultado & { ajustes?: number; sin_costo?: number };

// Fecha operativa en Cali (la base vuelve a validarla: no se cuenta en el futuro).
const hoyCali = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

// Todas las reglas (permiso, inicial solo para jefes, taras, duplicados) las aplica public.registrar_conteo.
export async function registrarConteo(ubicacion: string, inicial: boolean, lineas: LineaConteo[], observaciones: string): Promise<ResultadoConteo> {
  const perfil = await perfilActual();
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('registrar_conteo', {
    p: { ubicacion, fecha: hoyCali(), responsable_id: perfil.id, inicial, observaciones, lineas },
  });
  if (error) return { ok: false, id: null, codigo: null, fatales: [error.message], bloqueos: [], avisos: [] };
  if ((data as Resultado).ok) {
    revalidatePath('/conteo', 'layout');
    revalidatePath('/existencias');
  }
  return data as ResultadoConteo;
}
