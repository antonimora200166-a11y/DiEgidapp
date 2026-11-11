// Solo servidor: lo que necesita el simulador, leído de la base (carta_margen y consulta_ventas).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LineaSim, MezclaSim, ProductoSim } from '@/lib/simulador';

export type ProductoCarta = {
  generico_id: string; codigo: string; nombre: string; area: 'BAR' | 'COCINA'; seccion: string | null; estado_ficha: string;
  costo: number | null; precio: number | null; impoconsumo_pct: number; meta_pct: number | null; banda_pp: number | null;
  pct_costo: number | null; semaforo: string | null;
  ingredientes: { generico_id: string; nombre: string; cantidad: number; unidad: string; costo: number | null; falta: string | null }[];
};

type Ventas = { productos: { generico_id: string; unidades: number; unidades_sin_valor: number; valor_neto: number; completa: boolean; costo_total: number | null }[] };

export async function cartaCompleta(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc('carta_margen', { p_area: null });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductoCarta[];
}

export function productoSim(p: ProductoCarta): ProductoSim {
  const lineas: LineaSim[] = p.ingredientes.map((i) => ({
    generico_id: i.generico_id, nombre: i.nombre, unidad: i.unidad, cantidad: Number(i.cantidad),
    costo: i.falta || i.costo == null ? null : Number(i.costo),
  }));
  return { lineas, precio: p.precio == null ? null : Number(p.precio), imp_pct: Number(p.impoconsumo_pct),
           meta_pct: p.meta_pct == null ? null : Number(p.meta_pct), banda_pp: p.banda_pp == null ? null : Number(p.banda_pp) };
}

// La mezcla de ventas del área del producto en el período: sus unidades y lo que pesa en el teórico.
export async function mezclaDe(supabase: SupabaseClient, generico_id: string, area: string, desde: string, hasta: string): Promise<MezclaSim | null> {
  const { data, error } = await supabase.rpc('consulta_ventas', { p_desde: desde, p_hasta: hasta, p_area: area });
  if (error) throw new Error(error.message);
  const v = data as Ventas | null;
  if (!v?.productos?.length) return null;
  const completos = v.productos.filter((x) => x.completa);
  const costo = completos.reduce((s, x) => s + Number(x.costo_total ?? 0), 0);
  const ventas = completos.reduce((s, x) => s + Number(x.valor_neto ?? 0), 0);
  const p = v.productos.find((x) => x.generico_id === generico_id);
  return {
    unidades: Number(p?.unidades ?? 0), unidades_sin_valor: Number(p?.unidades_sin_valor ?? 0), valor_neto: Number(p?.valor_neto ?? 0),
    completa: !!p?.completa, costo_teorico_area: costo, ventas_completas_area: ventas,
  };
}
