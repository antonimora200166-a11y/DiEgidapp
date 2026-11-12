'use server';
import { revalidatePath } from 'next/cache';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { enviar } from '@/lib/enviar';
import { puedeOperar, type Area } from '@/lib/roles';
import type { Resultado } from '@/lib/catalogo';
import { emparejarConIA, leerFacturaConIA, type PropuestaFactura, type SugerenciaIA } from '@/lib/factura-ia';
import type { ProductoRecepcion } from './Recibir';

export type Candidato = { producto_id: string; parecido: number; area: Area };
export type ProveedorNuevo = { id: string; nombre: string; creado: boolean; activo: boolean };
export type LineaLeida = PropuestaFactura['lineas'][number] & { candidatos: Candidato[]; sugerencia_ia: Omit<SugerenciaIA, 'n'> | null };
export type Lectura =
  | { ok: true; propuesta: PropuestaFactura; proveedor_id: string | null; proveedor_nuevo: ProveedorNuevo | null;
      proveedor_sugeridos: { id: string; nombre: string }[]; lineas: LineaLeida[] }
  | { ok: false; error: string };

// Ruta de la foto en el bucket «facturas»: <ÁREA>/<año>/<uuid>.<ext> (la base valida lo mismo)
const RUTA = /^(BAR|COCINA)\/\d{4}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;
const TIPOS: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const soloDigitos = (s: string | null) => (s ?? '').replace(/\D/g, '').slice(0, 9);   // NIT sin dígito de verificación
// palabras que no distinguen a un proveedor de otro
const GENERICAS = new Set(['sas', 'ltda', 'sa', 'cia', 'y', 'de', 'del', 'la', 'el', 'los', 'las', 'distribuidora', 'comercializadora', 'inversiones', 'grupo']);
const palabras = (s: string) => norm(s).split(' ').filter((w) => w.length >= 4 && !GENERICAS.has(w));

// Lee la foto ya subida con la IA y la cruza con lo que el sistema conoce. El proveedor se elige
// solo si coincide el NIT o el nombre completo; si se parece a otro, se proponen los parecidos y se
// ofrece crearlo; si no se parece a ninguno, se crea. Las líneas se emparejan con
// public.emparejar_factura. No guarda la recepción.
export async function leerFactura(ruta: string, area: Area): Promise<Lectura> {
  const perfil = await perfilActual();
  if (!puedeOperar(perfil, area)) return { ok: false, error: `No recibes mercancía en ${area === 'BAR' ? 'bar' : 'cocina'}.` };
  if (!RUTA.test(ruta) || !ruta.startsWith(`${area}/`)) return { ok: false, error: 'La foto no corresponde a esta área.' };
  const supabase = await supabaseServidor();
  const { data: archivo, error } = await supabase.storage.from('facturas').download(ruta);
  if (error || !archivo) return { ok: false, error: 'No se pudo abrir la foto subida. Vuelve a tomarla.' };

  const r = await leerFacturaConIA(new Uint8Array(await archivo.arrayBuffer()), TIPOS[ruta.split('.').pop()!]);
  if (!r.ok) return r;
  const p = r.propuesta;

  // se busca en el área de la recepción y en la otra donde la persona recibe: un fruver trae para las dos
  const otra: Area | null = area === 'BAR' ? 'COCINA' : 'BAR';
  const areasBusqueda: Area[] = puedeOperar(perfil, otra) ? [area, otra] : [area];
  const textos = p.lineas.map((l) => l.descripcion);
  const [{ data: proveedores }, ...emparejados] = await Promise.all([
    supabase.from('proveedores').select('id, nombre, nit').eq('activo', true),
    ...areasBusqueda.map((a) => supabase.rpc('emparejar_factura', { p_area: a, p_textos: textos })),
  ]);
  const pares = emparejados.flatMap((e, i) => ((e.data ?? []) as { n: number; producto_id: string; parecido: number }[])
    .map((x) => ({ ...x, area: areasBusqueda[i] })));
  const nombre = norm(p.proveedor ?? '');
  const nit = soloDigitos(p.nit);
  const prov = (proveedores ?? []).find((x) => nit.length >= 6 && soloDigitos(x.nit) === nit)
    ?? (proveedores ?? []).find((x) => nombre && norm(x.nombre) === nombre);

  // parecidos: comparten una palabra que distingue («Fruver» y «Agro Fruvers Guabal»), sin elegir por la persona
  const leidas = palabras(p.proveedor ?? '');
  const sugeridos = prov ? [] : (proveedores ?? []).filter((x) => {
    const suyas = palabras(x.nombre);
    return suyas.some((w) => leidas.some((l) => l === w || (Math.min(l.length, w.length) >= 5 && (l.startsWith(w) || w.startsWith(l)))));
  }).slice(0, 4).map((x) => ({ id: x.id, nombre: x.nombre }));

  // proveedor que no está y no se parece a ninguno: se crea solo (proveedor_desde_factura no duplica nombre ni NIT)
  let nuevo: ProveedorNuevo | null = null;
  if (!prov && !sugeridos.length && p.legible && p.proveedor && p.proveedor.trim().length >= 3) {
    const { data } = await supabase.rpc('proveedor_desde_factura', { p_area: area, p_nombre: p.proveedor, p_nit: p.nit });
    nuevo = (data as ProveedorNuevo | null) ?? null;
  }

  const porLinea = new Map<number, Candidato[]>();
  for (const x of pares) {
    porLinea.set(x.n, [...(porLinea.get(x.n) ?? []), { producto_id: x.producto_id, parecido: Number(x.parecido), area: x.area }]);
  }
  // el más parecido primero; si empatan, el del área de la recepción (el limón está en las dos)
  for (const [n, cs] of porLinea) porLinea.set(n, cs.sort((a, b) => b.parecido - a.parecido || Number(b.area === area) - Number(a.area === area)));
  // lo que la búsqueda por nombre no emparejó con seguridad se lo pregunta a la IA por significado
  const dudosas = p.lineas.map((l, i) => ({ n: i + 1, descripcion: l.descripcion }))
    .filter((l) => !(porLinea.get(l.n) ?? []).some((c) => c.parecido >= 0.75));
  let sugerencias: SugerenciaIA[] = [];
  if (dudosas.length) {
    const catalogos = await Promise.all(areasBusqueda.map((a) => supabase.rpc('productos_recepcion', { p_area: a })));
    sugerencias = await emparejarConIA(dudosas, catalogos.flatMap((c, i) => ((c.data ?? []) as ProductoRecepcion[])
      .map((x) => ({ producto_id: x.producto_id, generico: x.generico, presentacion: x.presentacion,
                     categoria: `${x.categoria} · ${areasBusqueda[i] === 'BAR' ? 'bar' : 'cocina'}` }))));
  }
  const lineas = p.lineas.map((l, i): LineaLeida => {
    const s = sugerencias.find((x) => x.n === i + 1);
    const sugerencia_ia = s ? { producto_id: s.producto_id, confianza: s.confianza, razon: s.razon } : null;
    return { ...l, candidatos: porLinea.get(i + 1) ?? [], sugerencia_ia };
  });
  return { ok: true, propuesta: p, proveedor_id: prov?.id ?? (nuevo?.activo ? nuevo.id : null), proveedor_nuevo: nuevo,
           proveedor_sugeridos: sugeridos, lineas };
}

// La recepción de la otra área necesita la foto en su carpeta (la base lo exige): se copia.
export async function copiarFoto(ruta: string, hacia: Area): Promise<{ ok: true; ruta: string } | { ok: false; error: string }> {
  const perfil = await perfilActual();
  if (!puedeOperar(perfil, hacia) || !RUTA.test(ruta)) return { ok: false, error: 'No se pudo preparar la foto para la otra área.' };
  const nueva = ruta.replace(/^(BAR|COCINA)\/(\d{4})\/[0-9a-f-]{36}/, `${hacia}/$2/${crypto.randomUUID()}`);
  const supabase = await supabaseServidor();
  const { error } = await supabase.storage.from('facturas').copy(ruta, nueva);
  return error ? { ok: false, error: `No se pudo copiar la foto: ${error.message}` } : { ok: true, ruta: nueva };
}

// Proveedor nuevo desde la pantalla (el que leyó la IA o uno escrito a mano).
export async function crearProveedor(area: Area, nombre: string, nit: string | null): Promise<{ ok: true; proveedor: ProveedorNuevo } | { ok: false; error: string }> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('proveedor_desde_factura', { p_area: area, p_nombre: nombre, p_nit: nit });
  if (error) return { ok: false, error: error.message };
  return { ok: true, proveedor: data as ProveedorNuevo };
}

export type CreadoRapido = { ok: true; producto: ProductoRecepcion } | { ok: false; fatales: string[]; bloqueos: string[] };

// Producto que no está en el catálogo, creado desde la línea de la factura: queda provisional
// (lo valida quien edita el área) y se puede recibir de una vez. Las reglas son las de
// public.crear_producto: si se parece a otro, pide el motivo.
export async function crearProductoRapido(area: Area, d: {
  nombre: string; unidad_base: 'g' | 'ml' | 'und'; presentacion: string; unidad_compra: string;
  contenido_base: number | null; contenido_variable: boolean; categoria: string | null; motivo: string | null; factura: string | null;
}): Promise<CreadoRapido> {
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('crear_producto', { p: {
    area, generico: { nombre: d.nombre, tipo: 'MPe', unidad_base: d.unidad_base, categoria: d.categoria },
    marca: '', presentacion: d.presentacion, unidad_compra: d.unidad_compra, contenido_base: d.contenido_base,
    contenido_variable: d.contenido_variable, motivo_forzado: d.motivo,
    nota: d.factura ? `Creado desde una factura: «${d.factura}».` : null,
  } });
  if (error) return { ok: false, fatales: [error.message], bloqueos: [] };
  const res = data as Resultado;
  if (!res.ok || !res.id) return { ok: false, fatales: res.fatales, bloqueos: res.bloqueos };
  const { data: lista } = await supabase.rpc('productos_recepcion', { p_area: area });
  const producto = ((lista ?? []) as ProductoRecepcion[]).find((x) => x.producto_id === res.id);
  return producto ? { ok: true, producto } : { ok: false, fatales: ['Se creó, pero no aparece entre lo que se recibe. Recarga la página.'], bloqueos: [] };
}

// Todas las reglas (compuertas F/B, banda de precio, sello, cadena de frío, costo promedio) las
// aplica public.registrar_recepcion en una sola transacción.
export async function registrarRecepcion(payload: Record<string, unknown>, clave?: string): Promise<Resultado> {
  const perfil = await perfilActual();
  const data = await enviar('registrar_recepcion', { ...payload, recibe_id: perfil.id }, clave);
  if (data.ok) {
    revalidatePath('/recibir');
    revalidatePath('/existencias');
  }
  return data as Resultado;
}
