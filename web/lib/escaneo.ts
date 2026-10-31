'use server';
import { supabaseServidor } from '@/lib/supabase/server';

export type Lote = {
  id: string; codigo: string; area: 'BAR' | 'COCINA'; fecha: string; producto_id: string; mpi: string; unidad: string;
  neto: number; unidades: number | null; vence: string | null; conservacion: string | null; zona: string; responsable: string;
  costo_unitario: number | null; estado_costo: string; anulado: boolean;
};
export type ProductoEscaneado = { producto_id: string; codigo: string; generico: string; marca: string; presentacion: string; area: 'BAR' | 'COCINA' };
export type Escaneo = { tipo: 'lote'; lote: Lote } | { tipo: 'producto'; producto: ProductoEscaneado } | { tipo: 'desconocido'; codigo: string };

// El QR de una etiqueta de lote lleva la dirección …/l/<código del lote>.
const codigoLote = (texto: string) => /\/l\/([A-Z0-9._-]+)\/?$/i.exec(texto.trim())?.[1] ?? null;

export async function loteEtiqueta(codigo: string): Promise<Lote | null> {
  const supabase = await supabaseServidor();
  const { data } = await supabase.rpc('lote_etiqueta', { p_codigo: codigo });
  return (data as Lote | null) ?? null;
}

// Lo leído por la cámara o por un lector: etiqueta de lote, código de barras conocido o uno nuevo.
export async function leerCodigo(texto: string): Promise<Escaneo> {
  const lote = codigoLote(texto);
  if (lote) {
    const l = await loteEtiqueta(decodeURIComponent(lote));
    if (l) return { tipo: 'lote', lote: l };
  }
  const supabase = await supabaseServidor();
  const { data } = await supabase.rpc('producto_por_codigo', { p_codigo: texto.trim() });
  const p = (data as ProductoEscaneado[] | null)?.[0];
  return p ? { tipo: 'producto', producto: p } : { tipo: 'desconocido', codigo: texto.trim() };
}

export async function asociarCodigo(codigo: string, producto: string): Promise<{ ok: boolean; error?: string; producto?: string }> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('asociar_codigo_barras', { p_codigo: codigo, p_producto: producto });
  if (error) return { ok: false, error: error.message };
  return data as { ok: boolean; error?: string; producto?: string };
}
