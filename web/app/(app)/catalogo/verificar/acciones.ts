'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';

type Resultado = { ok: true; avisos?: string[] } | { ok: false; error: string };

export async function verificar(ids: string[], ok = true): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('verificar_productos', { p_ids: ids, p_ok: ok });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/catalogo/verificar');
  const r = data as { ok: number; fallidos: number };
  return r.fallidos ? { ok: false, error: `${r.fallidos} producto(s) no se pudieron marcar: solo el jefe del área o administración verifican.` } : { ok: true };
}

export async function marcarParecido(generico: string, otro: string, decision: 'REVISAR' | 'SEPARAR'): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('marcar_parecido', { p_generico: generico, p_otro: otro, p_decision: decision });
  if (error) return { ok: false, error: error.message };
  const r = data as { ok: boolean; mensaje?: string };
  revalidatePath('/catalogo', 'layout');
  return r.ok ? { ok: true } : { ok: false, error: r.mensaje ?? 'No se pudo.' };
}

export type Correccion = { unidad_base?: string; unidad_compra?: string; contenido_base?: number; contenido_variable?: boolean; presentacion?: string };

// Corrige con public.editar_producto (todas sus reglas) y, si queda bien, lo marca verificado.
export async function corregirYVerificar(id: string, c: Correccion): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const generico = c.unidad_base ? { unidad_base: c.unidad_base } : {};
  const producto: Record<string, unknown> = {};
  for (const k of ['unidad_compra', 'contenido_base', 'contenido_variable', 'presentacion'] as const) if (c[k] !== undefined) producto[k] = c[k];
  const { data, error } = await supabase.rpc('editar_producto', { p: { id, generico, producto } });
  if (error) return { ok: false, error: error.message };
  const r = data as { ok: boolean; fatales?: string[]; avisos?: string[] };
  if (!r.ok) return { ok: false, error: (r.fatales ?? []).join(' ') || 'No se pudo corregir.' };
  const v = await verificar([id], true);
  if (!v.ok) return v;
  revalidatePath('/catalogo', 'layout');
  return { ok: true, avisos: r.avisos };
}

type ResultadoBD = { ok: boolean; fatales?: string[]; avisos?: string[] };
const deBD = (data: unknown, error: { message: string } | null, exito?: string): Resultado => {
  if (error) return { ok: false, error: error.message };
  const r = data as ResultadoBD;
  if (!r.ok) return { ok: false, error: (r.fatales ?? []).join(' ') || 'No se pudo.' };
  return { ok: true, avisos: [exito, ...(r.avisos ?? [])].filter(Boolean) as string[] };
};

// Une dos genéricos desde la hoja (public.unir_genericos → public.decidir_par y sus reglas).
export async function unir(queda: string, va: string, factor: number | null): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('unir_genericos', { p_queda: queda, p_va: va, p_factor: factor });
  revalidatePath('/catalogo', 'layout');
  return deBD(data, error);
}

// Precio conocido → costo de referencia «a mano». por: COMPRA (1 unidad de compra) · KILO · BASE.
export async function fijarCosto(producto: string, valor: number, por: 'COMPRA' | 'KILO' | 'BASE', otras: boolean): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('fijar_costo', { p_producto: producto, p_valor: valor, p_por: por, p_otras: otras });
  revalidatePath('/catalogo', 'layout');
  return deBD(data, error);
}

// Presentación repetida del mismo genérico: queda inactiva y sus nombres de factura pasan a la otra.
export async function quitarRepetido(repetido: string, queda: string): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('quitar_repetido', { p_repetido: repetido, p_queda: queda });
  revalidatePath('/catalogo', 'layout');
  return deBD(data, error);
}
