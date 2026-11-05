'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';
import { analizarRiesgosConIA, MODELO_PROVEEDORES, type AnalisisRiesgos } from '@/lib/proveedores-ia';

type Resultado = { ok: true; mensaje?: string } | { ok: false; error: string };

export async function unirProveedores(queda: string, va: string): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('unir_proveedores', { p_queda: queda, p_va: va });
  if (error) return { ok: false, error: error.message };
  const r = data as { ok: boolean; fatales?: string[]; avisos?: string[] };
  revalidatePath('/proveedores');
  return r.ok ? { ok: true, mensaje: (r.avisos ?? []).join(' ') } : { ok: false, error: (r.fatales ?? []).join(' ') };
}

export async function marcarDistintos(a: string, b: string): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const { error } = await supabase.rpc('marcar_proveedores_distintos', { p_a: a, p_b: b });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/proveedores');
  return { ok: true };
}

export type AnalisisGuardado = { id: string; creado_en: string; resultado: AnalisisRiesgos };

// Cada vez que se toca el botón: dependencia de hoy + lo que la IA encuentra hoy en la web. Se guarda.
export async function analizarRiesgos(meses: number): Promise<{ ok: true; analisis: AnalisisGuardado } | { ok: false; error: string }> {
  const supabase = await supabaseServidor();
  const { data: datos, error } = await supabase.rpc('dependencia_proveedores', { p_meses: meses });
  if (error) return { ok: false, error: error.message };
  const hoy = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const r = await analizarRiesgosConIA(datos, hoy);
  if (!r.ok) return r;
  const { data: id, error: e2 } = await supabase.rpc('guardar_analisis_proveedores', { p_datos: datos, p_resultado: r.analisis, p_modelo: MODELO_PROVEEDORES });
  if (e2) return { ok: false, error: `El análisis se hizo pero no se pudo guardar: ${e2.message}` };
  revalidatePath('/proveedores');
  return { ok: true, analisis: { id: id as string, creado_en: new Date().toISOString(), resultado: r.analisis } };
}

export async function editarProveedor(id: string, nombre: string, nit: string, activo: boolean): Promise<Resultado> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('editar_proveedor', { p_id: id, p_nombre: nombre, p_nit: nit, p_activo: activo });
  if (error) return { ok: false, error: error.message };
  const r = data as { ok: boolean; fatales?: string[] };
  revalidatePath('/proveedores');
  return r.ok ? { ok: true } : { ok: false, error: (r.fatales ?? []).join(' ') };
}
