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

// Corrige genérico y presentación; con validar: true también lo valida (public.editar_producto).
export async function editarProducto(datos: Record<string, unknown>): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('editar_producto', { p: datos });
  if (error) return { ok: false, id: null, codigo: null, fatales: [error.message], bloqueos: [], avisos: [] };
  if ((data as Resultado).ok) revalidatePath('/catalogo', 'layout');
  return data as Resultado;
}

export async function validarProducto(form: FormData) {
  const supabase = await supabaseServidor();
  await supabase.rpc('validar_producto', { p_id: String(form.get('id')) });
  revalidatePath('/catalogo');
}

export type ResultadoBloque = { ok: number; fallidos: number; detalle: { id: string; codigo: string; ok: boolean; mensajes: string[] }[] };

// Mismo cambio a varios productos: cada uno pasa por las reglas de public.editar_producto (public.editar_productos).
export async function editarEnBloque(ids: string[], cambios: Record<string, unknown>, validar: boolean): Promise<ResultadoBloque | { error: string }> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('editar_productos', { p_ids: ids, p_cambios: cambios, p_validar: validar });
  if (error) return { error: error.message };
  revalidatePath('/catalogo', 'layout');
  return data as ResultadoBloque;
}
