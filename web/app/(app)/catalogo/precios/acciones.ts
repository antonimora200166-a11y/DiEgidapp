'use server';
import { revalidatePath } from 'next/cache';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { editaArea, type Area } from '@/lib/roles';
import { leerPreciosConIA, type LecturaPrecios } from '@/lib/precios-ia';
import { emparejarConIA, type SugerenciaIA } from '@/lib/factura-ia';

// Precios desde fotos: leer y guardar. No usa nada de la recepción (no crea proveedores, no
// registra recepciones, no toca el kardex).

const RUTA = /^(BAR|COCINA)\/\d{4}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;
const TIPOS: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

export type CandidatoPrecio = { producto_id: string; parecido: number };
export type LineaPrecio = LecturaPrecios['lineas'][number] & { candidatos: CandidatoPrecio[]; sugerencia_ia: Omit<SugerenciaIA, 'n'> | null };
export type LecturaFoto = { ok: true; lectura: LecturaPrecios; lineas: LineaPrecio[] } | { ok: false; error: string };

export async function leerPrecios(ruta: string, area: Area): Promise<LecturaFoto> {
  const perfil = await perfilActual();
  if (!editaArea(perfil, area)) return { ok: false, error: 'Solo el jefe del área o administración cargan precios.' };
  if (!RUTA.test(ruta) || !ruta.startsWith(`${area}/`)) return { ok: false, error: 'La foto no corresponde a esta área.' };
  const supabase = await supabaseServidor();
  const { data: archivo, error } = await supabase.storage.from('facturas').download(ruta);
  if (error || !archivo) return { ok: false, error: 'No se pudo abrir la foto subida. Vuelve a subirla.' };

  const r = await leerPreciosConIA(new Uint8Array(await archivo.arrayBuffer()), TIPOS[ruta.split('.').pop()!]);
  if (!r.ok) return r;
  const l = r.lectura;
  if (!l.lineas.length) return { ok: true, lectura: l, lineas: [] };

  // por nombre (la misma búsqueda de Recibir) y, lo que quede dudoso, por significado con la IA
  const { data: pares } = await supabase.rpc('emparejar_factura', { p_area: area, p_textos: l.lineas.map((x) => x.descripcion) });
  const porLinea = new Map<number, CandidatoPrecio[]>();
  for (const x of (pares ?? []) as { n: number; producto_id: string; parecido: number }[]) {
    porLinea.set(x.n, [...(porLinea.get(x.n) ?? []), { producto_id: x.producto_id, parecido: Number(x.parecido) }]);
  }
  for (const [n, cs] of porLinea) porLinea.set(n, cs.sort((a, b) => b.parecido - a.parecido));
  const dudosas = l.lineas.map((x, i) => ({ n: i + 1, descripcion: x.descripcion }))
    .filter((x) => !(porLinea.get(x.n) ?? []).some((c) => c.parecido >= 0.75));
  let sugerencias: SugerenciaIA[] = [];
  if (dudosas.length) {
    const { data: cat } = await supabase.rpc('productos_recepcion', { p_area: area });
    sugerencias = await emparejarConIA(dudosas, ((cat ?? []) as { producto_id: string; generico: string; presentacion: string; categoria: string }[])
      .map((p) => ({ producto_id: p.producto_id, generico: p.generico, presentacion: p.presentacion, categoria: p.categoria })));
  }
  const lineas = l.lineas.map((x, i): LineaPrecio => {
    const s = sugerencias.find((y) => y.n === i + 1);
    return { ...x, candidatos: porLinea.get(i + 1) ?? [], sugerencia_ia: s ? { producto_id: s.producto_id, confianza: s.confianza, razon: s.razon } : null };
  });
  return { ok: true, lectura: l, lineas };
}

export type ResultadoGuardar = { ok: number; fallidos: number; detalle: { n: number; ok: boolean; mensaje: string }[] } | { error: string };

export async function guardarPrecios(datos: Record<string, unknown>): Promise<ResultadoGuardar> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('guardar_precios_foto', { p: datos });
  if (error) return { error: error.message };
  revalidatePath('/catalogo', 'layout');
  return data as ResultadoGuardar;
}
