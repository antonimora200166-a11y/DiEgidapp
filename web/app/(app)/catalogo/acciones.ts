'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';
import type { Resultado } from '@/lib/catalogo';
import type { Clase } from '@/lib/clases';

// Todas las reglas (permisos, duplicados, parecidos, código) las aplica public.crear_producto.
// clase: desechable, aseo, menaje o herramienta (public.fijar_clase); materia prima no hace nada más.
export async function crearProducto(datos: Record<string, unknown>, clase: Clase = 'MATERIA_PRIMA'): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('crear_producto', { p: datos });
  if (error) return { ok: false, id: null, codigo: null, fatales: [error.message], bloqueos: [], avisos: [] };
  const r = data as Resultado;
  if (r.ok && r.id && clase !== 'MATERIA_PRIMA') {
    const { data: p } = await supabase.from('productos').select('generico_id').eq('id', r.id).maybeSingle();
    const aviso = p ? await fijarClase([p.generico_id as string], clase) : 'No se encontró el producto creado.';
    if (aviso) r.avisos = [...(r.avisos ?? []), aviso];
  }
  if (r.ok) revalidatePath('/catalogo');
  return r;
}

// Devuelve null si quedó, o el motivo si no se pudo.
export async function fijarClase(genericos: string[], clase: Clase): Promise<string | null> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('fijar_clase', { p_genericos: genericos, p_clase: clase });
  if (error) return error.message;
  const r = data as { ok: number; detalle: { ok: boolean; mensaje?: string }[] };
  revalidatePath('/catalogo', 'layout');
  return r.ok === genericos.length ? null : r.detalle.filter((d) => !d.ok).map((d) => d.mensaje).join(' ');
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

// Mínimo y máximo para el pedido sugerido (public.fijar_stock revisa el permiso del área).
export async function fijarStock(id: string, minimo: number | null, maximo: number | null): Promise<{ ok: boolean; error?: string }> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('fijar_stock', { p_producto: id, p_minimo: minimo, p_maximo: maximo });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/pedido');
  return data as { ok: boolean; error?: string };
}
