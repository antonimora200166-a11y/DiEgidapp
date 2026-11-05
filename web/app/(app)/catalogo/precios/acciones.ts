'use server';
import { revalidatePath } from 'next/cache';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { editaArea, type Area } from '@/lib/roles';
import { leerPreciosConIA, type LecturaPrecios } from '@/lib/precios-ia';
import { emparejarConIA, type SugerenciaIA } from '@/lib/factura-ia';
import { deTipoInsumo, type TipoInsumo } from '@/lib/clases';
import { elegirProveedorConIA } from '@/lib/proveedores-ia';
import type { Resultado } from '@/lib/catalogo';

// Precios desde fotos: leer y guardar. No usa nada de la recepción (no crea proveedores, no
// registra recepciones, no toca el kardex). Reconoce al proveedor y lo que ya se le compra.

const RUTA = /^(BAR|COCINA)\/\d{4}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;
const TIPOS: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

export type CandidatoPrecio = { producto_id: string; parecido: number; del_proveedor?: boolean; area: Area };
export type LineaPrecio = LecturaPrecios['lineas'][number] & { candidatos: CandidatoPrecio[]; sugerencia_ia: Omit<SugerenciaIA, 'n'> | null };
export type LecturaFoto = { ok: true; lectura: LecturaPrecios; lineas: LineaPrecio[]; proveedor_id: string | null;
                            proveedor_sugeridos: string[]; del_proveedor: string[]; proveedor_razon: string | null } | { ok: false; error: string };

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const soloDigitos = (s: string | null) => (s ?? '').replace(/\D/g, '').slice(0, 9);   // NIT sin dígito de verificación
const GENERICAS = new Set(['sas', 'ltda', 'sa', 'cia', 'y', 'de', 'del', 'la', 'el', 'los', 'las', 'distribuidora', 'comercializadora', 'inversiones', 'grupo']);
const palabras = (s: string) => norm(s).split(' ').filter((w) => w.length >= 4 && !GENERICAS.has(w));

// Busca en todas las áreas que la persona edita (bar y cocina para administración): una factura trae de todo.
export async function leerPrecios(ruta: string): Promise<LecturaFoto> {
  const perfil = await perfilActual();
  const areas = (['BAR', 'COCINA'] as Area[]).filter((a) => editaArea(perfil, a));
  if (!areas.length) return { ok: false, error: 'Solo los jefes de área o administración cargan precios.' };
  if (!RUTA.test(ruta) || !areas.some((a) => ruta.startsWith(`${a}/`))) return { ok: false, error: 'La foto no se subió en una carpeta válida.' };
  const supabase = await supabaseServidor();
  const { data: archivo, error } = await supabase.storage.from('facturas').download(ruta);
  if (error || !archivo) return { ok: false, error: 'No se pudo abrir la foto subida. Vuelve a subirla.' };

  const r = await leerPreciosConIA(new Uint8Array(await archivo.arrayBuffer()), TIPOS[ruta.split('.').pop()!]);
  if (!r.ok) return r;
  const l = r.lectura;

  // proveedor: por NIT o por nombre igual; si no, los que comparten una palabra que distingue
  const [{ data: proveedores }, { data: alias }] = await Promise.all([
    supabase.from('proveedores').select('id, nombre, nit').eq('activo', true),
    supabase.from('proveedor_alias').select('proveedor_id, alias'),
  ]);
  const nit = soloDigitos(l.nit);
  const aliasDe = (id: string) => (alias ?? []).filter((a) => a.proveedor_id === id).map((a) => a.alias as string);
  // por NIT, por nombre o por un nombre con que ya se unió a otro; si no, la IA lo busca por significado
  let prov = (proveedores ?? []).find((x) => nit.length >= 6 && soloDigitos(x.nit) === nit)
    ?? (proveedores ?? []).find((x) => l.proveedor && (norm(x.nombre) === norm(l.proveedor) || aliasDe(x.id).some((a) => norm(a) === norm(l.proveedor!))));
  let proveedorRazon: string | null = null;
  if (!prov && l.proveedor && (proveedores ?? []).length) {
    const ia = await elegirProveedorConIA({ nombre: l.proveedor, nit: l.nit },
      (proveedores ?? []).map((x) => ({ id: x.id as string, nombre: x.nombre as string, alias: aliasDe(x.id) })));
    if (ia?.proveedor_id && ia.confianza !== 'baja') {
      prov = (proveedores ?? []).find((x) => x.id === ia.proveedor_id);
      proveedorRazon = `La IA cree que es «${prov?.nombre}»: ${ia.razon}`;
    } else if (ia) proveedorRazon = ia.razon;
  }
  const leidas = palabras(l.proveedor ?? '');
  const sugeridos = prov ? [] : (proveedores ?? []).filter((x) => palabras(x.nombre).some((w) =>
    leidas.some((y) => y === w || (Math.min(y.length, w.length) >= 5 && (y.startsWith(w) || w.startsWith(y)))))).slice(0, 4).map((x) => x.id as string);
  // lo que ya se le compra a ese proveedor, con el nombre de su factura
  const { data: suyos } = prov
    ? await supabase.from('proveedor_productos').select('producto_id, nombre_factura').eq('proveedor_id', prov.id)
    : { data: [] as { producto_id: string; nombre_factura: string | null }[] };
  const delProveedor = (suyos ?? []).map((x) => x.producto_id as string);
  const porNombreProveedor = new Map((suyos ?? []).filter((x) => x.nombre_factura).map((x) => [norm(x.nombre_factura as string), x.producto_id as string]));
  if (!l.lineas.length) return { ok: true, lectura: l, lineas: [], proveedor_id: prov?.id ?? null, proveedor_sugeridos: sugeridos, del_proveedor: delProveedor, proveedor_razon: proveedorRazon };

  // por nombre (la misma búsqueda de Recibir) y, lo que quede dudoso, por significado con la IA
  const textos = l.lineas.map((x) => x.descripcion);
  const emparejados = await Promise.all(areas.map((a) => supabase.rpc('emparejar_factura', { p_area: a, p_textos: textos })));
  const porLinea = new Map<number, CandidatoPrecio[]>();
  emparejados.forEach((e, i) => {
    for (const x of (e.data ?? []) as { n: number; producto_id: string; parecido: number }[]) {
      porLinea.set(x.n, [...(porLinea.get(x.n) ?? []), { producto_id: x.producto_id, parecido: Number(x.parecido), area: areas[i] }]);
    }
  });
  const areaDe = new Map<string, Area>();
  for (const cs of porLinea.values()) for (const c of cs) areaDe.set(c.producto_id, c.area);
  // el nombre con que ese proveedor ya lo facturó gana; lo que ya se le compra va primero ante un empate
  l.lineas.forEach((x, i) => {
    const id = porNombreProveedor.get(norm(x.descripcion));
    if (id) porLinea.set(i + 1, [{ producto_id: id, parecido: 1, del_proveedor: true, area: areaDe.get(id) ?? areas[0] },
                                 ...(porLinea.get(i + 1) ?? []).filter((c) => c.producto_id !== id)]);
  });
  // el más parecido primero; si empatan (el limón está en bar y en cocina): el del proveedor y luego el de la zona que sugiere la IA
  for (const [n, cs] of porLinea) {
    const zona = l.lineas[n - 1]?.area_sugerida;
    const enZona = (c: CandidatoPrecio) => Number(zona === 'AMBAS' || c.area === zona);
    porLinea.set(n, cs.map((c) => ({ ...c, del_proveedor: c.del_proveedor || delProveedor.includes(c.producto_id) }))
      .sort((a, b) => (Math.abs(b.parecido - a.parecido) > 0.05 ? b.parecido - a.parecido : 0)
        || Number(!!b.del_proveedor) - Number(!!a.del_proveedor) || enZona(b) - enZona(a) || b.parecido - a.parecido));
  }
  const dudosas = l.lineas.map((x, i) => ({ n: i + 1, descripcion: x.descripcion }))
    .filter((x) => !(porLinea.get(x.n) ?? []).some((c) => c.parecido >= 0.75));
  let sugerencias: SugerenciaIA[] = [];
  if (dudosas.length) {
    const catalogos = await Promise.all(areas.map((a) => supabase.rpc('productos_recepcion', { p_area: a })));
    sugerencias = await emparejarConIA(dudosas, catalogos.flatMap((c, i) => ((c.data ?? []) as { producto_id: string; generico: string; presentacion: string; categoria: string }[])
      .map((p) => ({ producto_id: p.producto_id, generico: p.generico, presentacion: p.presentacion,
                     categoria: `${p.categoria} · ${areas[i] === 'BAR' ? 'bar' : 'cocina'}` }))));
  }
  const lineas = l.lineas.map((x, i): LineaPrecio => {
    const s = sugerencias.find((y) => y.n === i + 1);
    return { ...x, candidatos: porLinea.get(i + 1) ?? [], sugerencia_ia: s ? { producto_id: s.producto_id, confianza: s.confianza, razon: s.razon } : null };
  });
  return { ok: true, lectura: l, lineas, proveedor_id: prov?.id ?? null, proveedor_sugeridos: sugeridos, del_proveedor: delProveedor, proveedor_razon: proveedorRazon };
}

export type ResultadoGuardar = { ok: number; fallidos: number; detalle: { n: number; ok: boolean; mensaje: string }[] } | { error: string };

export async function guardarPrecios(datos: Record<string, unknown>): Promise<ResultadoGuardar> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('guardar_precios_foto', { p: datos });
  if (error) return { error: error.message };
  revalidatePath('/catalogo', 'layout');
  return data as ResultadoGuardar;
}

// ---------------------------------------------------------------- agregar al catálogo desde la línea
// Producto que no está: se crea con public.crear_producto y todas sus reglas (si se parece a
// otro, pide el motivo). Puede ser un genérico nuevo o otra presentación de uno que ya existe.
export type NuevoDesdeFoto = {
  hermano: string | null;   // otra presentación del genérico de este producto
  nombre: string; tipo: TipoInsumo; unidad_base: 'g' | 'ml' | 'und'; categoria: string | null;
  marca: string; presentacion: string; unidad_compra: string; contenido_base: number | null; contenido_variable: boolean;
  motivo: string | null; factura: string;
};
export type Creado =
  | { ok: true; producto_id: string; avisos: string[] }
  | { ok: false; fatales: string[]; bloqueos: string[] };

export async function crearDesdeFoto(area: Area, d: NuevoDesdeFoto): Promise<Creado> {
  const perfil = await perfilActual();
  if (!editaArea(perfil, area)) return { ok: false, fatales: ['Solo el jefe del área o administración agregan productos desde aquí.'], bloqueos: [] };
  const supabase = await supabaseServidor();
  const { tipo, clase } = deTipoInsumo(d.tipo);
  const p: Record<string, unknown> = {
    area, marca: d.marca.trim(), presentacion: d.presentacion.trim(), unidad_compra: d.unidad_compra.trim().toUpperCase(),
    contenido_base: d.contenido_variable ? null : d.contenido_base, contenido_variable: d.contenido_variable,
    motivo_forzado: d.motivo?.trim() || null, nota: `Creado desde Precios desde fotos: «${d.factura}».`,
  };
  let genId: string | null = null;
  if (d.hermano) {
    const { data: h } = await supabase.from('productos').select('generico_id').eq('id', d.hermano).maybeSingle();
    if (!h) return { ok: false, fatales: ['No se encontró el producto del que es la presentación.'], bloqueos: [] };
    genId = h.generico_id as string;
    p.generico_id = genId;
  } else p.generico = { nombre: d.nombre.trim(), tipo, unidad_base: d.unidad_base, categoria: d.categoria };
  const { data, error } = await supabase.rpc('crear_producto', { p });
  if (error) return { ok: false, fatales: [error.message], bloqueos: [] };
  const r = data as Resultado;
  if (!r.ok || !r.id) return { ok: false, fatales: r.fatales ?? [], bloqueos: r.bloqueos ?? [] };
  const avisos = [...(r.avisos ?? [])];
  if (!genId && clase !== 'MATERIA_PRIMA') {
    const { data: prod } = await supabase.from('productos').select('generico_id').eq('id', r.id).maybeSingle();
    const { data: fc } = prod ? await supabase.rpc('fijar_clase', { p_genericos: [prod.generico_id], p_clase: clase }) : { data: null };
    if (!fc || (fc as { ok: number }).ok !== 1) avisos.push('Se creó como materia prima: cambia su tipo en el catálogo.');
  }
  revalidatePath('/catalogo', 'layout');
  return { ok: true, producto_id: r.id, avisos };
}
