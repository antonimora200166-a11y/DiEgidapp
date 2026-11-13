'use server';
import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';
import { perfilActual } from '@/lib/sesion';
import { leerXlsx } from '@/lib/xlsx';
import { leerTablaDinamica, type ReporteVentas } from '@/lib/ventas-odoo';

export type Lectura = { ok: true; archivo: string; huella: string; reporte: ReporteVentas } | { ok: false; error: string };

// Lee el Excel de Odoo y devuelve lo que trae, sin guardar nada todavía.
export async function leerReporte(datos: FormData): Promise<Lectura> {
  const perfil = await perfilActual();
  if (perfil.rol !== 'admin') return { ok: false, error: 'Las ventas las carga administración.' };
  const archivo = datos.get('archivo');
  if (!(archivo instanceof File) || !archivo.size) return { ok: false, error: 'Escoja el archivo de Excel que bajó de Odoo.' };
  if (archivo.size > 15 * 1024 * 1024) return { ok: false, error: 'El archivo pesa más de 15 MB: no parece el reporte de ventas.' };
  try {
    const buf = Buffer.from(await archivo.arrayBuffer());
    const hojas = leerXlsx(buf);
    if (!hojas.length) return { ok: false, error: 'El archivo no tiene hojas.' };
    const reporte = leerTablaDinamica(hojas[0]);
    return { ok: true, archivo: archivo.name, huella: createHash('sha256').update(buf).digest('hex'), reporte };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo leer el archivo.' };
  }
}

export async function guardarVentas(l: Extract<Lectura, { ok: true }>): Promise<{ ok: boolean; error?: string; lineas?: number; omitidos?: string[]; sin_equivalencia?: number }> {
  const supabase = await supabaseServidor();
  const r = l.reporte;
  const { data, error } = await supabase.rpc('cargar_ventas', { p: {
    formato: 'TABLA_DINAMICA', archivo: l.archivo, huella: l.huella, desde: r.desde, hasta: r.hasta, por_dia: true,
    total_odoo: r.total, neto_estimado: r.netoEstimado,
    nota: r.netoEstimado ? 'Sin subtotal sin impuestos en el reporte: neto estimado con el impoconsumo.' : null,
    lineas: r.lineas.map((x) => ({ ...x, categoria: null })),
  } });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/consulta', 'layout');
  return data as { ok: boolean; error?: string; lineas?: number; omitidos?: string[]; sin_equivalencia?: number };
}

export async function fijarEquivalencia(p: { clave: string; nombre_odoo: string; tipo: string; partes: { generico_id: string; cantidad: number }[] }) {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('fijar_equivalencia', { p });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/consulta', 'layout');
  return data as { ok: boolean; error?: string };
}
