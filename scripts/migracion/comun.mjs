// Utilidades compartidas por los extractores de bar y de cocina.
import { createHash } from 'node:crypto';

// minúsculas, sin tildes, espacios simples
export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim();

// UUID determinístico (forma v5) a partir de un tipo y una clave: regenerar no cambia los ids
export const uuid = (tipo, clave) => {
  const h = createHash('sha1').update(`sgi-diegida:${tipo}:${clave}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

// literal SQL
export const lit = (v) => (v === null || v === undefined ? 'null'
  : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

export const ent = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
export const redondear = (n, d = 6) => Math.round(n * 10 ** d) / 10 ** d;

// Parecido entre dos nombres de producto, de 0 a 1: promedio de Dice sobre trigramas y de la
// proporción de palabras del nombre corto que aparecen en el largo. Ignora artículos y unidades.
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'x', 'a', 'al', 'con', 'para', 'por',
  'gr', 'g', 'kg', 'ml', 'lt', 'und', 'un']);
const palabras = (s) => norm(s).replace(/[^a-z0-9ñ ]+/g, ' ').split(' ').filter((w) => w && !VACIAS.has(w));
const trigramas = (s) => {
  const t = ` ${palabras(s).join(' ')} `, out = new Set();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
};
export function parecido(a, b) {
  const ta = trigramas(a), tb = trigramas(b);
  let comunes = 0;
  for (const x of ta) if (tb.has(x)) comunes++;
  const dice = ta.size + tb.size ? (2 * comunes) / (ta.size + tb.size) : 0;
  const pa = palabras(a), pb = palabras(b);
  const [corta, larga] = pa.length <= pb.length ? [pa, new Set(pb)] : [pb, new Set(pa)];
  const cubre = corta.length ? corta.filter((w) => larga.has(w) || [...larga].some((l) => l.startsWith(w) || w.startsWith(l))).length / corta.length : 0;
  return (dice + cubre) / 2;
}

// Histórico de compras línea a línea → supabase/datos/compras_historicas_*.sql.
// filas: [{id, fecha, prov, doc, nombre, generico (código), producto (uuid|null), base, valor, motivo}]
// motivo null = computable (alimenta la banda de precio B7). Idempotente por (origen, id_origen).
export function sqlComprasHistoricas(origen, filas, script, corte) {
  const out = [`-- =====================================================================================
-- SGI Di Égida · Compras históricas ${origen} (antes de la app), línea a línea
-- Generado por ${script} (corte: ${corte}). NO editar a mano.
-- Solo referencia de precio para la banda B7: no entra al kardex. Idempotente.
-- Ejecutar después de las migraciones y del histórico del área (npm run bd:instalar).
-- =====================================================================================`];
  const sql = filas.map((h) => `(${lit(uuid('compra_historica', `${origen}|${h.id}`))}, ${lit(origen)}, ${lit(String(h.id))}, ${lit(h.fecha)}, `
    + `${lit(h.prov ? String(h.prov).trim() : null)}, ${lit(h.doc ? String(h.doc).trim() : null)}, ${lit(String(h.nombre).trim())}, `
    + `${lit(uuid('generico', h.generico))}, ${lit(h.producto)}, ${redondear(h.base, 4)}, ${h.valor}, ${!h.motivo}, ${lit(h.motivo || null)})`);
  for (let i = 0; i < sql.length; i += 200) {
    out.push(`\ninsert into public.compras_historicas (id, origen, id_origen, fecha, proveedor, documento, nombre_factura, generico_id, producto_id, cantidad_base, valor_total, computable, motivo_exclusion) values\n  ${sql.slice(i, i + 200).join(',\n  ')}\non conflict do nothing;`);
  }
  out.push(`\nselect privado.bitacora('MIGRACIÓN COMPRAS HISTÓRICAS', 'compras_historicas', ${lit(origen)}, jsonb_build_object(
  'lineas', ${filas.length}, 'computables', ${filas.filter((h) => !h.motivo).length}, 'corte', ${lit(corte)}));`);
  return out.join('\n') + '\n';
}
