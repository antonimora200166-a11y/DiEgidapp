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
