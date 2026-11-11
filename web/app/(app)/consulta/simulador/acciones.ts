'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';
import { simular } from '@/lib/simulador';
import { cartaCompleta, mezclaDe, productoSim } from './datos';

export type Respuesta = { ok: boolean; error?: string; codigo?: string; precio_aplicado?: boolean; receta_pendiente?: boolean };

// El servidor vuelve a simular con lo que hay en la base (no con lo que mandó la pantalla) y la
// base vuelve a calcular el costo nuevo desde la ficha vigente.
export async function guardarPropuesta(p: {
  generico_id: string; precio_nuevo: number | null; cantidades: Record<string, number>; unidades_nuevas: number | null;
  nota: string; desde: string; hasta: string;
}): Promise<Respuesta> {
  const supabase = await supabaseServidor();
  const carta = await cartaCompleta(supabase);
  const prod = carta.find((x) => x.generico_id === p.generico_id);
  if (!prod) return { ok: false, error: 'No encontré el producto en la carta.' };
  const base = productoSim(prod);
  const mezcla = await mezclaDe(supabase, prod.generico_id, prod.area, p.desde, p.hasta);
  const r = simular(base, { precio_nuevo: p.precio_nuevo, cantidades: p.cantidades, unidades_nuevas: p.unidades_nuevas }, mezcla);
  const cambios = base.lineas.filter((l) => p.cantidades[l.generico_id] != null && p.cantidades[l.generico_id] !== l.cantidad)
    .map((l) => ({ generico_id: l.generico_id, cantidad_nueva: p.cantidades[l.generico_id] }));
  const { data, error } = await supabase.rpc('guardar_propuesta', { p: {
    generico_id: p.generico_id, precio_nuevo: p.precio_nuevo, cambios, nota: p.nota,
    resultado: { ...r, referencia: { desde: p.desde, hasta: p.hasta }, mezcla, unidades_nuevas: p.unidades_nuevas },
  } });
  if (error) return { ok: false, error: error.message };
  const res = data as Respuesta;
  if (res.ok) revalidatePath('/consulta/simulador');
  return res;
}

export async function decidirPropuesta(p: { id: string; decision: 'APROBAR' | 'DESCARTAR'; motivo: string; aplicar_precio: boolean }): Promise<Respuesta> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('decidir_propuesta', { p });
  if (error) return { ok: false, error: error.message };
  const res = data as Respuesta;
  if (res.ok) { revalidatePath('/consulta/simulador'); revalidatePath('/carta'); }
  return res;
}
