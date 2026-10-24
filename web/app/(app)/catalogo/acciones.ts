'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';
import type { Resultado } from '@/lib/catalogo';

// Todas las reglas (permisos, duplicados, parecidos, código) las aplica public.crear_producto.
export async function crearProducto(datos: Record<string, unknown>): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('crear_producto', { p: datos });
  if (error) return { ok: false, id: null, codigo: null, fatales: [error.message], bloqueos: [], avisos: [] };
  if ((data as Resultado).ok) revalidatePath('/catalogo');
  return data as Resultado;
}

export async function validarProducto(form: FormData) {
  const supabase = await supabaseServidor();
  await supabase.rpc('validar_producto', { p_id: String(form.get('id')) });
  revalidatePath('/catalogo');
}
