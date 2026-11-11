'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';

export type Evento = { accion: string; texto: string | null; usuario: string | null; en: string };

export async function accionAlerta(p: { id: string; accion: string; responsable_id?: string | null; fecha?: string | null; texto?: string; causa?: string }) {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('alerta_accion', { p });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/alertas'); revalidatePath('/consulta');
  return data as { ok: boolean; error?: string };
}

export async function historialAlerta(id: string): Promise<Evento[]> {
  const supabase = await supabaseServidor();
  const { data } = await supabase.rpc('alerta_eventos_lista', { p_alerta: id });
  return (data ?? []) as Evento[];
}

export async function revisarAlertas(desde: string, hasta: string) {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('generar_alertas', { p_desde: desde, p_hasta: hasta });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/alertas'); revalidatePath('/consulta');
  return { ok: true, nuevas: data as number };
}
