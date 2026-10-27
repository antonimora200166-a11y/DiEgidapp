'use server';
import { revalidatePath } from 'next/cache';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { puedeOperar, type Area } from '@/lib/roles';
import type { Resultado } from '@/lib/catalogo';
import { leerFacturaConIA, type PropuestaFactura } from '@/lib/factura-ia';

export type Candidato = { producto_id: string; parecido: number };
export type ProveedorNuevo = { id: string; nombre: string; creado: boolean; activo: boolean };
export type LineaLeida = PropuestaFactura['lineas'][number] & { candidatos: Candidato[] };
export type Lectura =
  | { ok: true; propuesta: PropuestaFactura; proveedor_id: string | null; proveedor_nuevo: ProveedorNuevo | null; lineas: LineaLeida[] }
  | { ok: false; error: string };

// Ruta de la foto en el bucket «facturas»: <ÁREA>/<año>/<uuid>.<ext> (la base valida lo mismo)
const RUTA = /^(BAR|COCINA)\/\d{4}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;
const TIPOS: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const soloDigitos = (s: string | null) => (s ?? '').replace(/\D/g, '').slice(0, 9);   // NIT sin dígito de verificación

// Lee la foto ya subida con la IA y la cruza con lo que el sistema conoce: el proveedor contra la
// lista cerrada y cada línea contra el catálogo y sus alias (public.buscar_productos). No guarda nada.
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

  const { data: proveedores } = await supabase.from('proveedores').select('id, nombre, nit').eq('activo', true);
  const nombre = norm(p.proveedor ?? '');
  const nit = soloDigitos(p.nit);
  const prov = (proveedores ?? []).find((x) => nit.length >= 6 && soloDigitos(x.nit) === nit)
    ?? (proveedores ?? []).find((x) => nombre && norm(x.nombre) === nombre)
    ?? (proveedores ?? []).find((x) => nombre && norm(x.nombre).length >= 4 && (nombre.includes(norm(x.nombre)) || norm(x.nombre).includes(nombre)));

  // proveedor que no está en la lista: se crea solo (public.proveedor_desde_factura no duplica nombre ni NIT)
  let nuevo: ProveedorNuevo | null = null;
  if (!prov && p.legible && p.proveedor && p.proveedor.trim().length >= 3) {
    const { data } = await supabase.rpc('proveedor_desde_factura', { p_area: area, p_nombre: p.proveedor, p_nit: p.nit });
    nuevo = (data as ProveedorNuevo | null) ?? null;
  }

  const lineas = await Promise.all(p.lineas.map(async (l): Promise<LineaLeida> => {
    const { data } = await supabase.rpc('buscar_productos', { p_texto: l.descripcion, p_area: area, p_limite: 5 });
    const candidatos = ((data ?? []) as { producto_id: string; parecido: number; activo: boolean }[])
      .filter((c) => c.activo).map((c) => ({ producto_id: c.producto_id, parecido: Number(c.parecido) }));
    return { ...l, candidatos };
  }));
  return { ok: true, propuesta: p, proveedor_id: prov?.id ?? (nuevo?.activo ? nuevo.id : null), proveedor_nuevo: nuevo, lineas };
}

// Todas las reglas (compuertas F/B, banda de precio, sello, cadena de frío, costo promedio) las
// aplica public.registrar_recepcion en una sola transacción.
export async function registrarRecepcion(payload: Record<string, unknown>): Promise<Resultado> {
  const perfil = await perfilActual();
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('registrar_recepcion', { p: { ...payload, recibe_id: perfil.id } });
  if (error) return { ok: false, id: null, codigo: null, fatales: [error.message], bloqueos: [], avisos: [] };
  if ((data as Resultado).ok) {
    revalidatePath('/recibir');
    revalidatePath('/existencias');
  }
  return data as Resultado;
}
