// =====================================================================================
// Catálogo unificado: CATALOGO_MAESTRO (SGI-COSTOS) + INV-COC-001 + nombres de las recepciones.
//   node scripts/migracion/unificar.mjs [--corte AAAA-MM-DD] [--cargar]
// Escribe:
//   scripts/migracion/revision_catalogo.csv        — duplicados y casi-duplicados para decidir
//                                                    (se reescribe conservando las decisiones)
//   scripts/migracion/catalogo_unificado.csv       — un renglón por producto: genérico, marca,
//                                                    presentación, unidad base, factor y clase ABC
//   supabase/datos/REPORTE_CATALOGO_UNIFICADO.md   — resumen y lo que falta
//   supabase/datos/catalogo_unificado.sql          — solo con --cargar y sin decisiones pendientes
//
// Qué hace:
//   · Separa genérico, marca y presentación de cada nombre («Agua Hatsu x300» → Agua · Hatsu ·
//     300 ml). La marca sale de las marcas conocidas (INV-COC-001 col. C, mapeo de bar y una
//     lista base); lo que no se reconoce queda en el genérico y aparece como casi-duplicado.
//   · Enlaza solo lo que ya está decidido: los alias de recepción del catálogo maestro, el
//     mapeo de bar (mapeo.mjs) y los nombres que coinciden palabra por palabra.
//   · Lo demás que se parezca va a revision_catalogo.csv: una persona escribe FUSIONAR, SEPARAR
//     u OK (acepta la propuesta). La IA propone; nada dudoso se carga.
//   · Unidad base: la de la fuente; si no hay, la de la presentación. Factor de compra: cuánto
//     trae una unidad de compra en unidad base (INV-COC-001 PESO/VOL, contenido de la recepción,
//     FACTORES_COMPRA).
//   · Clase ABC por valor comprado en las recepciones (líneas activas), por área: A hasta el
//     80 % acumulado, B hasta el 95 %, C el resto y lo que no tiene compras.
// El SQL corre después de historico_bar.sql e historico_cocina.sql: ubica cada fuente por su
// código o alias, fusiona lo decidido, crea como PROVISIONAL lo que no existe y fija la ABC.
// =====================================================================================
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerXlsx, fechaExcel } from './xlsx.mjs';
import * as M from './mapeo.mjs';
import { norm, lit, ent } from './comun.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '..', '..');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const CORTE = arg('--corte', new Date().toISOString().slice(0, 10));
const CARGAR = process.argv.includes('--cargar');
const UMBRAL_CASI = 0.72;            // parecido mínimo para pedir revisión
const ABC_A = 0.80, ABC_B = 0.95;
const RUTA_REVISION = join(aqui, 'revision_catalogo.csv');

const ref = (f) => join(raiz, 'referencia', f);
const costos = leerXlsx(ref('SGI-COSTOS · Producción y costo de MPI (LLENAR AQUÍ).xlsx'));
const inv = leerXlsx(ref('INV-COC-001-Inventario-Cocina-v6.5.1 (1).xlsx'));
const recCoc = leerXlsx(ref('REG_REC_COC_003.xlsx'));
const recBar = leerXlsx(ref('REG FMT-REC-BAR-001 · Recepción de bar (LLENAR AQUÍ).xlsx'));
const hoja = (libro, nombre, desde) => {
  if (!libro[nombre]) throw new Error(`Falta la hoja ${nombre}`);
  return libro[nombre].filter((f) => f._fila >= desde);
};
const cap = (s) => { const t = String(s || '').trim(); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
const ubDe = (u) => ({ un: 'und', und: 'und', unidad: 'und', ml: 'ml', g: 'g', gr: 'g' })[norm(u)] || null;
const csvCelda = (v) => String(v ?? '').replace(/[;\r\n]+/g, ',');
const fmtN = (n) => (n === null || n === undefined ? '' : String(Math.round(n * 1000) / 1000).replace('.', ','));
const moda = (lista) => {
  const m = new Map();
  for (const x of lista) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

// =====================================================================================
// Separar genérico · marca · presentación
// =====================================================================================
const MARCAS_BASE = ['Manuelita', 'Incauca', 'Riopaila', 'Diana', 'Roa', 'Florhuila', 'Alpina', 'Colanta', 'Alquería',
  'Parmalat', 'La Fina', 'Zenú', 'Rica', 'Ranchera', 'Fruco', 'Knorr', 'Maggi', 'Doria', 'La Muñeca', 'Monticello',
  'Nestlé', 'La Constancia', 'Bretaña', 'Canada Dry', 'Canadá Dry', 'Canad Dry', 'Hatsu', 'Postobón', 'Coca-Cola',
  'Tanqueray', 'Absolut', 'Campari', 'Carapelli', 'Carapeli', "Member's Selection", 'Members Selection', 'Biossens',
  'Kikkoman', 'San Jorge', 'Olivetto', 'Tosh', 'Quaker', 'Ramo', 'Bimbo', 'Colombina', 'Castillo', 'Del Monte', 'Heinz',
  'McCormick', 'Badia', 'El Rey', 'Frescampo', 'Ekono', 'Seletti', 'Belgioioso', 'Belgiosioso', 'Dibufala', 'Corlaza',
  'Centurion', 'Cordillera', 'Susanita', 'Etter', 'La Mansión', 'Frutaroma', 'Reviana', 'Viejo Molino', 'YumCraft',
  'ISI', 'Molisana', 'Mae Ploy', 'Mariani', 'Doña Lupe', 'Familia', 'Best Choice', 'S Y B', 'SYB', 'Iglú', 'Red Bull',
  'Gatorade', 'Mítica', 'Mil976', "Hendrick's", 'Hendricks', 'Olmeca', 'Convier', 'Glenfiddich', 'Tarapacá', 'Rosaleda',
  'Mar de Frades', 'Jagermeister', 'Jagermaister', 'Ojo de Tigre', 'Origen', 'Barilla', 'Oma', 'Sello Rojo',
  'Juan Valdez', 'Levapan', 'Fleischmann', 'Noel', 'Savoy', 'Hershey', 'Philadelphia', 'Président', 'Kraft', 'Lindt',
  'Callebaut', 'Valrhona', 'Torani', 'Monin', 'Angostura', 'Alfa', 'Member Selection', 'Colavita', 'Olitalia', 'Kari',
  'Crystal Farms', 'Crystal Farm', 'Haz de Oros', 'Castellano', 'Nortindal', 'Camoti'];
// palabras que la columna MARCA de INV-COC-001 trae pero que describen el producto
const DESCRIPTORES = /^(seco|fresco|fresca|molido|molida|entero|entera|polvo|pasta|sin azucar|natural|light|dulce|picante)$/;

const ENVASES = [
  [/\bbotellas?\b|\bbot\b/i, 'Botella', 'BOT'], [/\blatas?\b/i, 'Lata', 'LATA'], [/\bcajas?\b|\bcja\b/i, 'Caja', 'CJA'],
  [/\bbolsas?\b/i, 'Bolsa', 'BOLSA'], [/\bpaquetes?\b|\bpaq\b/i, 'Paquete', 'PAQ'], [/\bfrascos?\b/i, 'Frasco', 'FCO'],
  [/\btarros?\b/i, 'Tarro', 'TARRO'], [/\bgal[oó]n\b/i, 'Galón', 'GAL'], [/\bbandejas?\b/i, 'Bandeja', 'BAND'],
  [/\bsobres?\b/i, 'Sobre', 'SOBRE'], [/\bmanojos?\b/i, 'Manojo', 'MANOJO'], [/\bcostal\b/i, 'Costal', 'COSTAL'],
  [/\b(?:four ?pack|4 ?pack|fourpack)\b/i, 'Paquete x4', 'PACK4'], [/\b(?:six ?pack|six)\b/i, 'Paquete x6', 'PACK6'],
];
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'a', 'al', 'con', 'para', 'por', 'x']);
const UNIDADES = { ml: ['ml', 1], cc: ['ml', 1], l: ['ml', 1000], lt: ['ml', 1000], lts: ['ml', 1000], litro: ['ml', 1000],
  litros: ['ml', 1000], g: ['g', 1], gr: ['g', 1], grs: ['g', 1], gramos: ['g', 1], kg: ['g', 1000], kl: ['g', 1000],
  kilo: ['g', 1000], kilos: ['g', 1000], und: ['und', 1], un: ['und', 1], unidades: ['und', 1] };
const UNIDAD_CONTEO = { botella: 'BOT', lata: 'LATA', caja: 'CJA', bolsa: 'BOLSA', paquete: 'PAQ', frasco: 'FCO', tarro: 'TARRO',
  unidad: 'UND', 'porcion': 'POR', 'cuna': 'CUNA', pieza: 'PZA', bloque: 'BLQ', bandeja: 'BAND', posta: 'POSTA', galon: 'GAL' };

const marcasConocidas = [];      // [{ n: normalizada, nombre, base }] — más larga primero
const palabrasGenerico = new Set();   // palabras de los nombres de genérico: «Filete», «Mejillón» no son marcas
function registrarMarca(m, base = false) {
  const t = String(m || '').replace(/^\([^)]*\)\s*/, '').replace(/[()]/g, '').trim();
  if (!t || t.length < 2 || DESCRIPTORES.test(norm(t)) || /\d/.test(t)) return;
  if (!base && norm(t).split(' ').every((w) => palabrasGenerico.has(w))) return;
  if (!marcasConocidas.some((x) => x.n === norm(t))) marcasConocidas.push({ n: norm(t), nombre: t, base });
}
MARCAS_BASE.forEach((m) => registrarMarca(m, true));

// «Agua Hatsu x300» → { generico: 'Agua', marca: 'Hatsu', envase: null, contenido: 300, unidad: null }
function separar(texto) {
  let s = ` ${String(texto || '').replace(/\s+/g, ' ').trim()} `;
  s = s.replace(/\b(bot|botella|caja|cja|bolsa)\s*([x*])\s*/gi, '$1 x');
  // medidas como «16x15» o tallas como «61/70» son parte del nombre, no contenido
  const medidas = [];
  s = s.replace(/\b\d+\s*[x/]\s*\d+\b/gi, (m) => { medidas.push(m); return ` §${medidas.length - 1}§ `; });
  const out = { generico: '', marca: '', envase: null, ucompra: null, contenido: null, unidad: null };
  // cantidad con unidad: «750 ml», «x300», «Bolsa 3kl», «X1000gr», «*50»
  const q = /\s[x*]?\s*(\d+(?:[.,]\d+)?)\s*(ml|cc|lts?|litros?|grs?|gramos|g|kg|kl|kilos?|und|unidades|un)\b\.?/i.exec(s)
         || /\s[x*]\s*(\d+(?:[.,]\d+)?)\b/i.exec(s);
  if (q) {
    const [ub, f] = UNIDADES[norm(q[2] || '')] || [null, 1];
    out.contenido = Number(q[1].replace(',', '.')) * f;
    out.unidad = ub;
    s = s.replace(q[0], ' ');
  }
  // el envase se separa salvo que abra el nombre: «Bolsa de vacío» es el producto, no su empaque
  for (const [re, etiqueta, codigo] of ENVASES) {
    const m = re.exec(s);
    if (!m) continue;
    if (s.slice(0, m.index).trim()) { out.envase = etiqueta; out.ucompra = codigo; s = s.replace(re, ' '); }
    break;
  }
  s = s.replace(/\b(vidrio|pl[aá]stic[oa])\b/i, ' ');
  // marca: la frase conocida más larga, como palabras completas. Una marca aprendida de INV-COC-001
  // no puede abrir el nombre (el genérico va primero); las de la lista base sí («Mil976 Ginger beer»).
  let palabras = s.trim().split(/\s+/).filter(Boolean);
  const pn = palabras.map((w) => norm(w).replace(/[^a-z0-9']+/g, ''));
  buscar: for (const m of marcasConocidas) {
    const mw = m.n.split(' ');
    for (let i = 0; i + mw.length <= pn.length; i++) {
      if (pn.slice(i, i + mw.length).join(' ') !== m.n || (i === 0 && !m.base) || (i === 0 && pn.length === mw.length)) continue;
      out.marca = m.nombre;
      palabras = [...palabras.slice(0, i), ...palabras.slice(i + mw.length)];
      break buscar;
    }
  }
  // sin puntuación suelta ni palabras vacías al final («Harina de trigo en [costal]»)
  while (palabras.length > 1 && VACIAS.has(norm(palabras[palabras.length - 1]).replace(/[^a-z]+/g, ''))) palabras.pop();
  out.generico = cap(palabras.join(' ').replace(/§(\d+)§/g, (_, i) => medidas[+i]).replace(/\s+,/g, ',').replace(/^[,;:\-–—\s]+|[,;:\-–—\s]+$/g, ''));
  return out;
}

// Clave de genérico: sin tildes, sin palabras vacías, singular simple. «Aceite de ajonjolí» = «Aceite ajonjolí».
const clave = (s) => norm(s).replace(/[^a-z0-9ñ ]+/g, ' ').split(' ').filter((w) => w && !VACIAS.has(w))
  .map((w) => (w.length > 4 && /es$/.test(w) && !/[aeiou]es$/.test(w.slice(0, -1)) ? w.slice(0, -2) : w.length > 3 && /s$/.test(w) ? w.slice(0, -1) : w))
  .join(' ');

// Parecido para duplicados (0 a 1): Dice sobre trigramas de la clave. Que un nombre contenga al otro
// solo cuenta si lo contiene al principio («Fresa» ≈ «Fresa congelada»), no al final
// («Papa» ≠ «Croqueta de papa», «Naranja» ≠ «Zumo de naranja»).
// ~750 genéricos de cocina comparados de a pares: los trigramas se calculan una vez por clave
const cacheTrigramas = new Map();
const trigramas = (k) => {
  let o = cacheTrigramas.get(k);
  if (o) return o;
  const t = ` ${k} `;
  o = new Set();
  for (let i = 0; i < t.length - 2; i++) o.add(t.slice(i, i + 3));
  cacheTrigramas.set(k, o);
  return o;
};
function parecidoClave(ka, kb, mismaMarca = false) {
  const ta = trigramas(ka), tb = trigramas(kb);
  let c = 0;
  for (const x of ta) if (tb.has(x)) c++;
  const dice = (2 * c) / (ta.size + tb.size || 1);
  const [corta, larga] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  // una sola palabra («Queso», «Arroz») es demasiado general, salvo que la marca coincida
  const prefijo = larga.startsWith(`${corta} `) && (corta.includes(' ') || mismaMarca) ? 0.75 : 0;
  return Math.max(dice, prefijo);
}

// =====================================================================================
// Registros: uno por nombre en cada fuente
// =====================================================================================
// { id, fuente, area, ref, nombre, generico, marca, presentacion, ucompra, contenido, variable, ub, tipo,
//   categoria, activo, valor, compras, origenFactor, enlace }
const registros = [];
const PRIORIDAD = { CATALOGO_MAESTRO: 0, 'INV-COC-001': 1, 'REC-COC': 2, 'REC-BAR': 2 };
const excluidos = [];
const avisos = [];

// ---------------------------------------------------------------- CATALOGO_MAESTRO (bar)
const cmPorCodigo = new Map();
const cmPorAlias = new Map();
for (const f of hoja(costos, 'CATALOGO_MAESTRO', 4)) {
  if (!f.A || !/^BAR_/.test(f.A) || !['MPe', 'MPI', 'SIN_COSTO'].includes(f.C)) continue;
  const r = { id: `CM:${f.A}`, fuente: 'CATALOGO_MAESTRO', area: 'BAR', ref: f.A, nombre: f.B, generico: cap(f.B), marca: '',
              presentacion: '', ucompra: null, contenido: null, variable: false, ub: ubDe(f.F) || 'g', tipo: f.C,
              categoria: String(f.D || '').startsWith('MPI') ? 'MPI' : f.D || null, activo: true, valor: 0, compras: 0,
              origenFactor: '' };
  registros.push(r);
  cmPorCodigo.set(f.A, r);
  for (const a of String(f.G || '').split('|').map((x) => x.trim()).filter(Boolean)) cmPorAlias.set(norm(a), r);
}

// ---------------------------------------------------------------- INV-COC-001 (cocina)
const filasInv = hoja(inv, 'CATALOGO', 5).filter((f) => f.D);
for (const n of [...filasInv.map((f) => f.B || f.D), ...[...cmPorCodigo.values()].map((r) => r.nombre)]) for (const w of norm(n).split(' ')) palabrasGenerico.add(w.replace(/[^a-z0-9']+/g, ''));
for (const f of filasInv) registrarMarca(f.C);
marcasConocidas.sort((a, b) => b.n.length - a.n.length);
for (const f of filasInv) {
  if (/sin clasificar/i.test(f.F || '')) { excluidos.push(`INV-COC-001 «${f.D}»: alta sin clasificar (decisión 22/10/2026).`); continue; }
  const t = norm(f.F) || norm(f.E);
  const tipo = t.startsWith('mpi') || t.startsWith('pla') ? 'MPI' : 'MPe';
  // la columna MARCA a veces trae presentación («20 gr») o un descriptor («Seco», «(Pasta) S Y B»)
  let base = String(f.B || f.D).trim(), marca = String(f.C || '').trim();
  const desc = /^\(([^)]*)\)\s*/.exec(marca);
  if (desc) { base = `${base} ${desc[1].toLowerCase()}`; marca = marca.slice(desc[0].length); }
  if (DESCRIPTORES.test(norm(marca))) { base = `${base} ${marca.toLowerCase()}`; marca = ''; }
  if (/^\d/.test(marca)) { base = `${base} ${marca}`; marca = ''; }
  marca = marca.replace(/[()]/g, '').trim();
  const s = separar(base);
  if (!marca) marca = s.marca;
  const ub = ubDe(f.G) || 'g';
  const conteo = cap(f.H);
  const peso = ent(f.I);
  let contenido = null, variable = false, ucompra, presentacion;
  if (!conteo) { contenido = 1; ucompra = { g: 'GR', ml: 'ML', und: 'UND' }[ub]; presentacion = ub === 'und' ? 'Unidad' : 'Granel'; }
  else {
    ucompra = UNIDAD_CONTEO[norm(conteo)] || norm(conteo).toUpperCase().slice(0, 6);
    if (ub === 'und') contenido = 1;
    else if (norm(f.J) === 'variable' || !peso) variable = true;
    else contenido = peso;
    presentacion = `${conteo}${contenido && ub !== 'und' ? ` ${contenido} ${ub}` : ''}`;
  }
  if (s.contenido && !contenido && s.unidad === ub) { contenido = s.contenido; variable = false; }
  registros.push({ id: `INV:${norm(f.D)}`, fuente: 'INV-COC-001', area: 'COCINA', ref: f.D, nombre: f.D, generico: s.generico, peso,
                   marca, presentacion, ucompra, contenido, variable, ub, tipo, categoria: null,
                   activo: norm(f.Q) !== 'no' && !/· baja/i.test(f.T || ''), valor: 0, compras: 0,
                   origenFactor: variable ? 'variable (se registra en cada recepción)' : conteo ? 'INV-COC-001 PESO/VOL C/U' : 'granel' });
}

// ---------------------------------------------------------------- REG_REC_COC_003 (cocina)
const lineasCoc = hoja(recCoc, 'BD_RECEPCIONES', 6).filter((f) => f.A && f.H && norm(f.AG) === 'activa');
const CATEGORIA = { 'abarrotes y secos': 'COC_ABARROTES', 'aves y huevos': 'COC_AVES_HUEVOS', carnicos: 'COC_CARNICOS',
  fruver: 'COC_FRUVER', lacteos: 'COC_LACTEOS', 'pesca y mariscos': 'COC_PESCA', 'aseo y desechables': 'COC_ASEO' };
const vistosCoc = new Set();
const nombresCoc = [...hoja(recCoc, 'CATALOGO', 6).filter((f) => f.B).map((f) => ({ nombre: String(f.B).trim(), f })),
                    ...lineasCoc.map((f) => ({ nombre: String(f.H).trim(), f: null }))];
for (const { nombre, f } of nombresCoc) {
  if (vistosCoc.has(norm(nombre))) continue;
  vistosCoc.add(norm(nombre));
  const lineas = lineasCoc.filter((l) => norm(l.H) === norm(nombre));
  const s = separar(nombre);
  const ub = ubDe(f?.C) || ubDe(lineas[0]?.I) || s.unidad || 'und';
  // presentación de compra más frecuente: «Bolsa» × 1.000 g, «Granel» × 1
  const pres = moda(lineas.map((l) => `${cap(l.J) || 'Granel'}|${ent(l.L) ?? ''}`)) || '';
  let [envase, cont] = pres.split('|');
  if (norm(envase) === 'migrado v1.0') envase = '';
  cont = cont === '' || cont === undefined ? null : Number(cont);
  const granel = !envase || norm(envase) === 'granel';
  const contenido = granel ? 1 : cont || s.contenido;
  const valor = lineas.reduce((t, l) => t + (ent(l.Q) || 0), 0);
  registros.push({ id: `RCOC:${norm(nombre)}`, fuente: 'REC-COC', area: 'COCINA', ref: nombre, nombre, generico: s.generico,
                   marca: s.marca, presentacion: granel ? (ub === 'und' ? 'Unidad' : 'Granel') : `${envase}${contenido && ub !== 'und' ? ` ${contenido} ${ub}` : ''}`,
                   ucompra: granel ? { g: 'GR', ml: 'ML', und: 'UND' }[ub] : UNIDAD_CONTEO[norm(envase)] || norm(envase).toUpperCase().slice(0, 6),
                   contenido, variable: !contenido, ub, tipo: 'MPe', categoria: CATEGORIA[norm(f?.D)] || null,
                   activo: f ? norm(f.I) !== 'inactivo' : true, valor, compras: lineas.length,
                   origenFactor: granel ? 'granel' : cont ? `recepción: contenido más frecuente (${lineas.length} línea(s))` : s.contenido ? 'nombre' : '' });
}

// ---------------------------------------------------------------- FMT-REC-BAR-001 (bar)
const factoresCompra = new Map();
for (const f of hoja(costos, 'FACTORES_COMPRA', 2)) {
  if (f.A && f.B && typeof f.C === 'number') factoresCompra.set(`${norm(f.A)}|${String(f.B).toUpperCase()}`, f.C);
}
const lineasBar = hoja(recBar, 'BD_RECEPCION_BAR', 2).filter((f) => f.A && f.G);
const vistosBar = new Set();
for (const f0 of lineasBar) {
  const nombre = String(f0.G).trim(), n = norm(nombre);
  if (vistosBar.has(n)) continue;
  vistosBar.add(n);
  const d = M.RECEPCION[n] || {};
  if (d.excluir) { excluidos.push(`REC-BAR «${nombre}»: ${d.excluir}`); continue; }
  const lineas = lineasBar.filter((l) => norm(l.G) === n);
  const activas = lineas.filter((l) => String(l.AA) === 'ACTIVA');
  const s = separar(nombre);
  // enlace ya decidido: mapeo de bar, alias del catálogo maestro o nombre idéntico
  const extra = d.extra ? M.PRODUCTOS_EXTRA[d.extra] : null;
  let cm = null;
  if (extra && typeof extra.generico === 'string') cm = cmPorCodigo.get(extra.generico);
  if (d.inv) { const c = M.INVENTARIO_A_GENERICO[d.inv.split('|')[0]]; if (typeof c === 'string') cm = cmPorCodigo.get(c); }
  cm ||= cmPorAlias.get(n) || [...cmPorCodigo.values()].find((r) => norm(r.nombre) === n) || null;
  const ub = cm?.ub || (extra && typeof extra.generico === 'object' ? extra.generico.unidad_base : null) || s.unidad
             || ubDe(String(moda(activas.map((l) => l.K)) || '').replace('GR', 'g').replace('ML', 'ml')) || 'und';
  // factor de compra: la unidad más usada en las compras y lo que trae
  const u = String(moda(activas.map((l) => String(l.K || '').toUpperCase()).filter(Boolean)) || '').toUpperCase();
  const pj = separar(moda(activas.map((l) => l.J).filter(Boolean)) || '');
  let contenido = null, origen = '';
  if (extra?.contenido) { contenido = extra.contenido; origen = 'mapeo de bar (PRODUCTOS_EXTRA)'; }
  else if ((u === 'GR' && ub === 'g') || (u === 'ML' && ub === 'ml')) { contenido = 1; origen = 'granel'; }
  else if (u === 'KG' && ub === 'g') { contenido = 1000; origen = 'kg'; }
  else if (d.inv && ub === 'ml') { contenido = Number(d.inv.split('|')[1]); origen = 'mapeo de bar (INV-BAR-001)'; }
  else if (ub === 'und' && ['UND', 'BOT', 'LATA'].includes(u)) { contenido = 1; origen = 'por unidad'; }
  else if ((s.contenido || pj.contenido) && (!(s.unidad || pj.unidad) || (s.unidad || pj.unidad) === ub)) {
    contenido = s.contenido || pj.contenido; origen = s.contenido ? 'nombre' : 'presentación de la compra';
  } else if (factoresCompra.has(`${norm(cm?.nombre || nombre)}|${u}`)) { contenido = factoresCompra.get(`${norm(cm?.nombre || nombre)}|${u}`); origen = 'FACTORES_COMPRA'; }
  const valor = activas.reduce((t, l) => t + (ent(l.P) || 0), 0);
  registros.push({ id: `RBAR:${n}`, fuente: 'REC-BAR', area: 'BAR', ref: nombre, nombre, generico: cm ? cm.generico : s.generico,
                   marca: extra?.marca ?? s.marca, presentacion: extra?.presentacion || (contenido === 1 && origen === 'granel' ? 'Granel'
                     : [s.envase || pj.envase || (u ? cap(u.toLowerCase()) : ''), contenido && ub !== 'und' ? `${contenido} ${ub}` : ''].filter(Boolean).join(' ')),
                   ucompra: extra?.unidad_compra || (origen === 'granel' ? { g: 'GR', ml: 'ML', und: 'UND' }[ub] : u || null),
                   contenido, variable: !contenido, ub, tipo: 'MPe', categoria: cm?.categoria || (extra?.generico?.categoria ?? null),
                   activo: true, valor, compras: activas.length, origenFactor: origen, enlace: cm ? cm.id : null,
                   mapeo: d.extra || d.inv || null,
                   enlaceVia: cm ? (d.extra || d.inv ? 'mapeo de bar' : cmPorAlias.has(n) ? 'alias del catálogo maestro' : 'nombre idéntico') : null });
}

// =====================================================================================
// Unificación: genéricos (unión de registros) y pares para revisar
// =====================================================================================
const padre = new Map(registros.map((r) => [r.id, r.id]));
const raizDe = (id) => { while (padre.get(id) !== id) { padre.set(id, padre.get(padre.get(id))); id = padre.get(id); } return id; };
const unir = (a, b) => { const x = raizDe(a), y = raizDe(b); if (x !== y) padre.set(y, x); };
const porId = new Map(registros.map((r) => [r.id, r]));
const enlaces = [];       // { a, b, via }

for (const r of registros) {
  r.clave = `${r.area}|${clave(r.generico)}`;
  if (r.enlace) { unir(r.enlace, r.id); enlaces.push({ a: r.enlace, b: r.id, via: r.enlaceVia }); }
}
// mismo genérico (palabra por palabra): es el mismo insumo, visto en otra fuente o en otra marca o
// presentación. Dos genéricos del catálogo maestro con el mismo nombre no se unen solos: salen como duplicado.
const primeroPorClave = new Map();
for (const r of [...registros].sort((a, b) => PRIORIDAD[a.fuente] - PRIORIDAD[b.fuente])) {
  const k = r.clave;
  const p = primeroPorClave.get(k);
  if (!p) { primeroPorClave.set(k, r); continue; }
  if (raizDe(p.id) === raizDe(r.id) || (p.fuente === 'CATALOGO_MAESTRO' && r.fuente === 'CATALOGO_MAESTRO')) continue;
  unir(p.id, r.id);
  if (p.fuente !== r.fuente) enlaces.push({ a: p.id, b: r.id, via: 'mismo genérico' });
}

// unidad base del grupo: la del catálogo maestro; si no, la de peso o volumen más usada (como extraer_cocina.mjs)
function ubGrupo(regs) {
  const cm = regs.find((r) => r.fuente === 'CATALOGO_MAESTRO');
  return cm ? cm.ub : moda(regs.map((r) => r.ub).filter((u) => u !== 'und')) || 'und';
}

// decisiones ya escritas
const decisiones = new Map();
if (existsSync(RUTA_REVISION)) {
  const lineas = readFileSync(RUTA_REVISION, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const enc = lineas.shift().split(';');
  const iPar = enc.indexOf('par'), iDec = enc.indexOf('decision'), iNota = enc.indexOf('nota_revisor');
  for (const l of lineas) {
    const c = l.split(';');
    const d = String(c[iDec] || '').trim().toUpperCase();
    if (d || c[iNota]) decisiones.set(c[iPar], { d, nota: c[iNota] || '' });
  }
}

// pares: duplicados exactos dentro de una fuente y casi-duplicados entre genéricos distintos
const pares = [];
const llaveProducto = (r) => `${r.clave}|${norm(r.marca)}|${r.variable ? 'var' : r.contenido}|${r.ub}`;
const porLlave = new Map();
for (const r of registros) (porLlave.get(llaveProducto(r)) || porLlave.set(llaveProducto(r), []).get(llaveProducto(r))).push(r);
for (const grupo of porLlave.values()) {
  for (let i = 1; i < grupo.length; i++) {
    if (grupo[i].fuente !== grupo[0].fuente) continue;
    if (grupo[i].mapeo && grupo[i].mapeo === grupo[0].mapeo) continue;     // mapeo de bar: ya decidido que son uno
    pares.push({ a: grupo[0], b: grupo[i], tipo: 'DUPLICADO', parecido: 1,
                 motivo: 'Mismo genérico, marca y presentación en la misma fuente.' });
  }
}
// casi-duplicados: se comparan los nombres de genérico distintos de cada área
const genericosArea = new Map();
for (const r of registros) {
  const k = raizDe(r.id);
  const g = genericosArea.get(k) || { raiz: k, area: r.area, registros: [] };
  g.registros.push(r);
  genericosArea.set(k, g);
}
const listaGen = [...genericosArea.values()];
for (const g of listaGen) {
  g.rep = [...g.registros].sort((a, b) => PRIORIDAD[a.fuente] - PRIORIDAD[b.fuente] || b.valor - a.valor)[0];
  g.ub = ubGrupo(g.registros);
  g.marcas = new Set(g.registros.map((r) => norm(r.marca)).filter(Boolean));
  g.kGen = clave(g.rep.generico);
  g.kMarca = clave(`${g.rep.generico} ${g.rep.marca}`);
}
const yaPar = new Set();
for (const area of ['BAR', 'COCINA']) {
  const gs = listaGen.filter((g) => g.area === area);
  for (let i = 0; i < gs.length; i++) {
    const candidatos = [];
    for (let j = 0; j < gs.length; j++) {
      if (i === j) continue;
      const a = gs[i].rep, b = gs[j].rep;
      if (a.clave === b.clave || a.tipo !== b.tipo) continue;   // ya unidos, o materia prima frente a su preparación
      const mismaMarca = [...gs[i].marcas].some((m) => gs[j].marcas.has(m));
      const s = Math.max(parecidoClave(gs[i].kGen, gs[j].kGen, mismaMarca), parecidoClave(gs[i].kMarca, gs[j].kMarca));
      if (s >= UMBRAL_CASI) candidatos.push({ g: gs[j], s });
    }
    for (const { g, s } of candidatos.sort((x, y) => y.s - x.s).slice(0, 3)) {
      const [ga, gb] = [gs[i], g].sort((x, y) => PRIORIDAD[x.rep.fuente] - PRIORIDAD[y.rep.fuente] || y.rep.valor - x.rep.valor || x.rep.nombre.localeCompare(y.rep.nombre));
      const k = `${ga.rep.id}|${gb.rep.id}`;
      if (yaPar.has(k)) continue;
      yaPar.add(k);
      pares.push({ a: ga.rep, b: gb.rep, ubA: ga.ub, ubB: gb.ub, tipo: 'CASI-DUPLICADO', parecido: s,
                   motivo: ga.ub !== gb.ub ? `Unidad base distinta (${ga.ub} / ${gb.ub}).` : '' });
    }
  }
}
for (const p of pares) {
  p.id = `${p.a.id}|${p.b.id}`;
  p.ubA ||= p.a.ub; p.ubB ||= p.b.ub;
  // propuesta: fusionar si es igual o muy parecido con la misma unidad base; separar si las marcas chocan
  const marcasChocan = p.a.marca && p.b.marca && norm(p.a.marca) !== norm(p.b.marca);
  p.propuesta = p.ubA !== p.ubB || marcasChocan ? 'SEPARAR' : p.tipo === 'DUPLICADO' || p.parecido >= 0.85 ? 'FUSIONAR' : 'REVISAR';
  if (marcasChocan) p.motivo = [p.motivo, `Marcas distintas (${p.a.marca} / ${p.b.marca}): serían productos distintos del mismo genérico.`].filter(Boolean).join(' ');
  const dec = decisiones.get(p.id);
  p.decision = dec?.d || '';
  p.nota = dec?.nota || '';
  p.final = p.decision === 'OK' ? (p.propuesta === 'REVISAR' ? '' : p.propuesta) : ['FUSIONAR', 'SEPARAR'].includes(p.decision) ? p.decision : '';
  if (p.decision && !['OK', 'FUSIONAR', 'SEPARAR'].includes(p.decision)) avisos.push(`revision_catalogo.csv: «${p.decision}» no es OK, FUSIONAR ni SEPARAR (${p.a.nombre} / ${p.b.nombre}).`);
  if (p.final === 'FUSIONAR' && p.ubA !== p.ubB) { avisos.push(`No se fusiona ${p.a.nombre} con ${p.b.nombre}: la unidad base es distinta (${p.ubA} / ${p.ubB}).`); p.final = ''; }
}
pares.sort((x, y) => (x.a.area.localeCompare(y.a.area)) || (x.tipo === y.tipo ? 0 : x.tipo === 'DUPLICADO' ? -1 : 1) || y.parecido - x.parecido);
const pendientes = pares.filter((p) => !p.final);

// las fusiones decididas unen genéricos
for (const p of pares.filter((x) => x.final === 'FUSIONAR')) unir(p.a.id, p.b.id);

// =====================================================================================
// Catálogo unificado: un genérico por grupo, un producto por marca + presentación
// =====================================================================================
const grupos = new Map();
for (const r of registros) (grupos.get(raizDe(r.id)) || grupos.set(raizDe(r.id), []).get(raizDe(r.id))).push(r);
const unificados = [];
for (const regs of grupos.values()) {
  regs.sort((a, b) => PRIORIDAD[a.fuente] - PRIORIDAD[b.fuente] || b.valor - a.valor || a.nombre.localeCompare(b.nombre));
  const lider = regs[0];
  const ub = ubGrupo(regs);
  const g = { clave: lider.id, area: lider.area, generico: lider.generico, ub, tipo: lider.tipo,
              categoria: regs.map((r) => r.categoria).find(Boolean) || null, registros: regs,
              valor: regs.reduce((t, r) => t + r.valor, 0), compras: regs.reduce((t, r) => t + r.compras, 0),
              activo: regs.some((r) => r.activo), productos: [] };
  // productos: los del inventario y los de compra con marca o presentación propia; el catálogo maestro
  // solo define el genérico
  const prods = new Map();
  for (const r of regs.filter((x) => x.fuente !== 'CATALOGO_MAESTRO')) {
    // contado por unidad en un genérico de peso o volumen: el factor es el peso de cada unidad
    let { contenido, variable, origenFactor } = r;
    if (r.ub !== ub) {
      contenido = r.ub === 'und' && r.peso ? r.peso : null;
      variable = !contenido;
      origenFactor = contenido ? `${r.fuente}: ${r.peso} ${ub} por unidad (validar)` : `${r.fuente} va en ${r.ub}: contenido variable`;
    }
    const k = `${norm(r.marca)}|${variable ? 'var' : contenido}`;
    const p = prods.get(k);
    if (!p) prods.set(k, { marca: r.marca, presentacion: r.presentacion, ucompra: r.ucompra, contenido, variable, origenFactor, fuentes: [r] });
    else p.fuentes.push(r);
  }
  // una compra a granel del mismo genérico no es un producto aparte si el inventario ya lo tiene
  if ([...prods.values()].some((p) => p.fuentes.some((r) => r.fuente === 'INV-COC-001'))) {
    for (const [k, p] of prods) if (p.fuentes.every((r) => r.fuente === 'REC-COC') && !p.marca) {
      const destino = [...prods.values()].find((x) => x.fuentes.some((r) => r.fuente === 'INV-COC-001'));
      destino.fuentes.push(...p.fuentes); prods.delete(k);
    }
  }
  g.productos = [...prods.values()];
  // solo en el catálogo maestro: el mismo producto por defecto que crea extraer.mjs
  if (!g.productos.length && ['LICOR', 'VINO', 'MIXER', 'CERVEZA'].includes(g.categoria) && g.tipo === 'MPe') {
    g.productos.push({ marca: '', presentacion: 'Presentación por confirmar', ucompra: 'BOT', contenido: null, variable: true,
                       origenFactor: 'sin presentación en inventario ni compras', fuentes: [lider] });
  }
  if (!g.productos.length) g.productos.push({ marca: '', presentacion: g.tipo === 'MPI' ? 'Producción propia' : 'Granel',
    ucompra: { g: 'GR', ml: 'ML', und: 'UND' }[g.ub], contenido: 1, variable: false, origenFactor: 'unidad base', fuentes: [lider] });
  if (regs.some((r) => r.ub !== g.ub)) avisos.push(`${g.generico} (${g.area}): las fuentes traen unidades base distintas (${[...new Set(regs.map((r) => `${r.fuente} ${r.ub}`))].join(', ')}); quedó ${g.ub}.`);
  unificados.push(g);
}

// clase ABC por valor comprado, por área (los MPI no se compran: sin clase hasta tener kardex)
for (const area of ['BAR', 'COCINA']) {
  const lista = unificados.filter((g) => g.area === area && g.tipo !== 'MPI').sort((a, b) => b.valor - a.valor);
  const total = lista.reduce((t, g) => t + g.valor, 0);
  let acum = 0;
  for (const g of lista) {
    const previo = acum / (total || 1);
    acum += g.valor;
    g.abc = g.valor <= 0 ? 'C' : previo < ABC_A ? 'A' : previo < ABC_B ? 'B' : 'C';
    g.participacion = total ? g.valor / total : 0;
  }
}
const estadoDe = (g) => (g.registros.some((r) => r.fuente !== 'REC-COC' && r.fuente !== 'REC-BAR') || g.registros.some((r) => r.enlace)
  ? 'EXISTE' : 'NUEVO (PROVISIONAL)');

// =====================================================================================
// Salidas: revisión, catálogo unificado y reporte
// =====================================================================================
const BOM = '﻿';
const descR = (r) => [r.generico, r.marca, r.presentacion].filter(Boolean).join(' · ');
const rev = ['par;area;tipo;parecido;propuesta;decision;nota_revisor;a_fuente;a_nombre;a_generico;a_marca;a_presentacion;a_unidad_base;a_factor;a_valor_compras;b_fuente;b_nombre;b_generico;b_marca;b_presentacion;b_unidad_base;b_factor;b_valor_compras;motivo'];
for (const p of pares) {
  rev.push([p.id, p.a.area, p.tipo, fmtN(p.parecido), p.propuesta, p.decision, p.nota,
            ...[[p.a, p.ubA], [p.b, p.ubB]].flatMap(([r, ub]) => [r.fuente, r.nombre, r.generico, r.marca, r.presentacion, ub, r.variable ? 'variable' : fmtN(r.contenido), Math.round(r.valor)]),
            p.motivo].map(csvCelda).join(';'));
}
writeFileSync(RUTA_REVISION, BOM + rev.join('\r\n') + '\r\n');

const cat = ['area;codigo_fuente;generico;tipo;categoria;unidad_base;marca;presentacion;unidad_compra;factor_compra;origen_factor;clase_abc;valor_compras;participacion;compras;estado;fuentes'];
for (const g of [...unificados].sort((a, b) => a.area.localeCompare(b.area) || a.generico.localeCompare(b.generico))) {
  const cod = g.registros.find((r) => r.fuente === 'CATALOGO_MAESTRO')?.ref || '';
  for (const p of g.productos) {
    cat.push([g.area, cod, g.generico, g.tipo, g.categoria, g.ub, p.marca, p.presentacion, p.ucompra, p.variable ? 'variable' : fmtN(p.contenido),
              p.origenFactor, g.abc || '', Math.round(g.valor), g.participacion ? `${(g.participacion * 100).toFixed(2).replace('.', ',')} %` : '',
              g.compras, estadoDe(g), [...new Set(p.fuentes.map((r) => `${r.fuente}: ${r.nombre}`))].join(' | ')].map(csvCelda).join(';'));
  }
}
writeFileSync(join(aqui, 'catalogo_unificado.csv'), BOM + cat.join('\r\n') + '\r\n');

const cuenta = (f) => registros.filter((r) => r.fuente === f).length;
const nProd = unificados.reduce((t, g) => t + g.productos.length, 0);
const abc = (area, c) => unificados.filter((g) => g.area === area && g.abc === c).length;
const valorArea = (area, c) => unificados.filter((g) => g.area === area && (!c || g.abc === c)).reduce((t, g) => t + g.valor, 0);
const pct = (area, c) => `${Math.round((valorArea(area, c) / (valorArea(area) || 1)) * 100)} %`;
const R = [];
R.push(`# Catálogo unificado\n\nGenerado por \`scripts/migracion/unificar.mjs\` · ${CORTE} · fuentes: \`CATALOGO_MAESTRO\` (SGI-COSTOS), \`INV-COC-001\`, \`REG_REC_COC_003\` y \`FMT-REC-BAR-001\`.`);
R.push(`\n## Qué salió\n
| Qué | Cantidad |
|---|---|
| Registros leídos | ${registros.length} (catálogo maestro ${cuenta('CATALOGO_MAESTRO')}, INV-COC-001 ${cuenta('INV-COC-001')}, recepción cocina ${cuenta('REC-COC')}, recepción bar ${cuenta('REC-BAR')}) |
| Enlaces automáticos (ya decididos o mismo genérico) | ${enlaces.length} |
| Genéricos unificados | ${unificados.length} (bar ${unificados.filter((g) => g.area === 'BAR').length}, cocina ${unificados.filter((g) => g.area === 'COCINA').length}) |
| Productos (genérico + marca + presentación) | ${nProd} |
| Genéricos nuevos que entrarían PROVISIONALES | ${unificados.filter((g) => estadoDe(g) !== 'EXISTE').length} |
| Pares para revisar | ${pares.length} (duplicados ${pares.filter((p) => p.tipo === 'DUPLICADO').length}, casi-duplicados ${pares.filter((p) => p.tipo !== 'DUPLICADO').length}) · **${pendientes.length} sin decisión** |
| Productos con factor de compra variable o sin factor | ${unificados.reduce((t, g) => t + g.productos.filter((p) => p.variable).length, 0)} |

### Clase ABC por valor comprado

| Área | A | B | C | Valor comprado |
|---|---|---|---|---|
| Bar | ${abc('BAR', 'A')} (${pct('BAR', 'A')}) | ${abc('BAR', 'B')} (${pct('BAR', 'B')}) | ${abc('BAR', 'C')} (${pct('BAR', 'C')}) | $${Math.round(valorArea('BAR')).toLocaleString('es-CO')} |
| Cocina | ${abc('COCINA', 'A')} (${pct('COCINA', 'A')}) | ${abc('COCINA', 'B')} (${pct('COCINA', 'B')}) | ${abc('COCINA', 'C')} (${pct('COCINA', 'C')}) | $${Math.round(valorArea('COCINA')).toLocaleString('es-CO')} |

Valor = suma de las líneas activas de recepción (todo el histórico de los libros). Los MPI no tienen clase hasta que el kardex dé su consumo.`);
R.push(`\n## Cómo revisar\n
1. Abrir \`scripts/migracion/revision_catalogo.csv\` (Excel o Sheets, separador «;»).
2. En **decision** escribir \`OK\` (acepta la propuesta), \`FUSIONAR\` (B pasa a ser alias de A) o \`SEPARAR\` (son productos distintos). Las propuestas \`REVISAR\` necesitan FUSIONAR o SEPARAR.
3. Volver a correr \`npm run migracion:unificar\`: conserva lo decidido y recalcula. Con todo decidido, \`npm run migracion:unificar -- --cargar\` escribe \`supabase/datos/catalogo_unificado.sql\`.

Esta revisión reemplaza a \`cruces_cocina.csv\`: los nombres de recepción de cocina que no enlazaron solos están aquí como casi-duplicados o como genéricos nuevos.`);
const sec = (t, l) => { R.push(`\n## ${t}\n`); R.push(l.length ? l.map((x) => `- ${x}`).join('\n') : 'Nada.'); };
sec(`Duplicados exactos (${pares.filter((p) => p.tipo === 'DUPLICADO').length})`, pares.filter((p) => p.tipo === 'DUPLICADO').map((p) => `${p.a.fuente} «${p.a.nombre}» = «${p.b.nombre}»`));
sec(`Genéricos nuevos (no están en el catálogo maestro ni en INV-COC-001: entran PROVISIONALES)`,
  unificados.filter((g) => estadoDe(g) !== 'EXISTE').map((g) => `${g.area} · ${g.generico} (${g.registros.map((r) => `«${r.nombre}»`).join(', ')}) · ${g.compras} compra(s)`));
sec('Productos sin factor de compra', unificados.flatMap((g) => g.productos.filter((p) => p.variable && p.fuentes.some((r) => r.compras > 0)).map((p) => `${g.area} · ${g.generico} ${p.marca} · ${p.presentacion || '(sin presentación)'}`)));
sec('Avisos', avisos);
sec('No entran', excluidos);
writeFileSync(join(raiz, 'supabase', 'datos', 'REPORTE_CATALOGO_UNIFICADO.md'), R.join('\n') + '\n');

console.log(`✔ unificado: ${registros.length} registros → ${unificados.length} genéricos · ${nProd} productos · ${enlaces.length} enlaces automáticos`);
console.log(`  revisión: ${pares.length} pares (${pendientes.length} sin decisión) en scripts/migracion/revision_catalogo.csv`);

// =====================================================================================
// SQL de carga. Lo decidido en el CSV se aplica; los pares sin decisión no frenan la carga:
// sus dos lados entran separados (lo nuevo, PROVISIONAL) y el par queda en
// public.revision_catalogo para decidirlo desde la app.
// =====================================================================================
if (!CARGAR) process.exit(0);
const grupoDe = new Map();
for (const g of unificados) for (const r of g.registros) grupoDe.set(r.id, g.clave);
const filasPares = pendientes.map((p) => `(${[p.id, p.a.area, p.tipo, Math.round(p.parecido * 1000) / 1000, p.propuesta, p.motivo || null,
  p.a.fuente, p.a.nombre, grupoDe.get(p.a.id), p.b.fuente, p.b.nombre, grupoDe.get(p.b.id)].map(lit).join(', ')})`);
const filasMiembros = [], filasNuevos = [], filasAbc = [];
for (const g of unificados) {
  for (const r of g.registros) {
    filasMiembros.push(`(${lit(g.clave)}, ${lit(g.area)}, ${lit(r.fuente)}, ${lit(r.ref)}, ${PRIORIDAD[r.fuente]})`);
  }
  if (g.abc) filasAbc.push(`(${lit(g.clave)}, ${lit(g.abc)})`);
  if (estadoDe(g) !== 'EXISTE') {
    const p = g.productos[0];
    filasNuevos.push(`(${lit(g.clave)}, ${lit(g.area)}, ${lit(g.generico)}, ${lit(g.tipo === 'MPI' ? 'MPI' : 'MPe')}, ${lit(g.categoria)}, ${lit(g.ub)}, ${lit(p.marca || '')}, ${lit(p.presentacion || 'Granel')}, ${lit(p.ucompra || { g: 'GR', ml: 'ML', und: 'UND' }[g.ub])}, ${lit(p.variable ? null : p.contenido)}, ${p.variable}, ${g.activo})`);
  }
}
const bloque = (tabla, cols, filas) => (filas.length ? `insert into ${tabla} (${cols}) values\n  ${filas.join(',\n  ')};\n` : '');
const sql = `-- =====================================================================================
-- SGI Di Égida · Catálogo unificado (fusiones decididas, provisionales nuevos y clase ABC)
-- Generado por scripts/migracion/unificar.mjs --cargar (${CORTE}). NO editar a mano: corregir
-- scripts/migracion/revision_catalogo.csv y volver a generar. Los pares sin decisión van a
-- public.revision_catalogo y se deciden en la app.
-- Ejecutar después de historico_bar.sql e historico_cocina.sql (es idempotente):
--   psql "$DATABASE_URL" -1 -f supabase/datos/catalogo_unificado.sql
-- =====================================================================================
create temp table _miembros (grupo text, area public.area_app, fuente text, ref text, prioridad int,
                             generico_id uuid, producto_id uuid) on commit drop;
create temp table _nuevos (grupo text, area public.area_app, nombre text, tipo public.tipo_generico, categoria text,
                           unidad_base public.unidad_base, marca text, presentacion text, unidad_compra text,
                           contenido numeric, variable boolean, activo boolean) on commit drop;
create temp table _abc (grupo text, clase public.clase_abc) on commit drop;
create temp table _pares (id text, area public.area_app, tipo text, parecido numeric, propuesta text, motivo text,
                          a_fuente text, a_nombre text, a_grupo text, b_fuente text, b_nombre text, b_grupo text) on commit drop;

${bloque('_miembros', 'grupo, area, fuente, ref, prioridad', filasMiembros)}
${bloque('_pares', 'id, area, tipo, parecido, propuesta, motivo, a_fuente, a_nombre, a_grupo, b_fuente, b_nombre, b_grupo', filasPares)}
${bloque('_nuevos', 'grupo, area, nombre, tipo, categoria, unidad_base, marca, presentacion, unidad_compra, contenido, variable, activo', filasNuevos)}
${bloque('_abc', 'grupo, clase', filasAbc)}
-- ubicar cada fuente en lo que ya cargaron los históricos
update _miembros m set generico_id = g.id from public.genericos g
 where m.fuente = 'CATALOGO_MAESTRO' and g.codigo = m.ref;
update _miembros m set generico_id = a.generico_id, producto_id = a.producto_id from public.alias a
 where m.generico_id is null and a.area = m.area and a.alias_norm = privado.normalizar(m.ref)
   and a.fuente = case m.fuente when 'INV-COC-001' then 'INVENTARIO' else 'RECEPCION' end;
update _miembros m set generico_id = g.id from public.genericos g
 where m.generico_id is null and g.area = m.area and g.nombre_norm = privado.normalizar(m.ref);

do $$
declare
  n record; v_gen uuid; v_cod text; v_destino uuid; r record; v_fusiones int := 0; v_nuevos int := 0; v_alias int := 0;
begin
  -- 1. lo que no existe entra PROVISIONAL, con sus nombres de recepción como alias
  for n in select * from _nuevos x where not exists (select 1 from _miembros m where m.grupo = x.grupo and m.generico_id is not null) loop
    select g.id into v_gen from public.genericos g where g.area = n.area and g.nombre_norm = privado.normalizar(n.nombre);
    if v_gen is null then
      insert into public.genericos (codigo, nombre, tipo, categoria, area, unidad_base, estado, activo, nota)
      values (privado.codigo_generico(n.area, n.tipo), n.nombre, n.tipo,
              (select c.codigo from public.categorias c where c.codigo = n.categoria), n.area, n.unidad_base, 'PROVISIONAL', n.activo,
              'Alta por catálogo unificado (nombre de recepción sin genérico): falta validar.')
      returning id, codigo into v_gen, v_cod;
      insert into public.productos (codigo, generico_id, marca, presentacion, unidad_compra, contenido_base, contenido_variable, estado, activo)
      values (v_cod || '-P01', v_gen, n.marca, n.presentacion, n.unidad_compra, n.contenido, n.variable, 'PROVISIONAL', n.activo);
      v_nuevos := v_nuevos + 1;
    end if;
    update _miembros m set generico_id = v_gen where m.grupo = n.grupo;
    insert into public.alias (fuente, alias, generico_id)
    select case m.fuente when 'INV-COC-001' then 'INVENTARIO' else 'RECEPCION' end, m.ref, v_gen
      from _miembros m where m.grupo = n.grupo and m.fuente <> 'CATALOGO_MAESTRO'
    on conflict do nothing;
  end loop;

  -- 2. fusiones: el genérico de mayor prioridad del grupo se queda; los otros pasan a él
  for r in select distinct m.grupo, m.generico_id from _miembros m where m.generico_id is not null loop
    select m.generico_id into v_destino from _miembros m
     where m.grupo = r.grupo and m.generico_id is not null order by m.prioridad, m.ref limit 1;
    continue when r.generico_id = v_destino;
    -- ya fusionado en una carga anterior (el código del catálogo maestro sigue apuntando al genérico viejo)
    if exists (select 1 from public.genericos g where g.id = r.generico_id and not g.activo)
       and not exists (select 1 from public.productos p where p.generico_id = r.generico_id and p.activo) then
      update _miembros m set generico_id = v_destino where m.grupo = r.grupo and m.generico_id = r.generico_id;
      continue;
    end if;
    -- productos: se mueven si no chocan con uno igual del destino; si chocan, se desactivan
    update public.productos p set generico_id = v_destino,
           nota = concat_ws(' · ', p.nota, 'Fusionado por catálogo unificado ${CORTE}.')
     where p.generico_id = r.generico_id
       and not exists (select 1 from public.productos x where x.generico_id = v_destino and x.marca = p.marca and x.presentacion = p.presentacion);
    update public.productos p set activo = false, nota = concat_ws(' · ', p.nota, 'Duplicado: fusionado por catálogo unificado ${CORTE}.')
     where p.generico_id = r.generico_id;
    update public.alias a set generico_id = v_destino
     where a.generico_id = r.generico_id
       and not exists (select 1 from public.alias x where x.generico_id = v_destino and x.area = a.area and x.fuente = a.fuente and x.alias_norm = a.alias_norm);
    update public.ficha_lineas l set generico_id = v_destino where l.generico_id = r.generico_id;
    update public.genericos g set activo = false,
           nota = concat_ws(' · ', g.nota, 'Fusionado en ' || (select d.codigo from public.genericos d where d.id = v_destino) || ' (catálogo unificado ${CORTE}).')
     where g.id = r.generico_id;
    update _miembros m set generico_id = v_destino where m.grupo = r.grupo and m.generico_id = r.generico_id;
    v_fusiones := v_fusiones + 1;
  end loop;

  -- 3. los nombres que ninguna carga anterior conocía quedan como alias del genérico del grupo
  insert into public.alias (fuente, alias, generico_id)
  select case m.fuente when 'INV-COC-001' then 'INVENTARIO' else 'RECEPCION' end, m.ref, d.generico_id
    from _miembros m
    join lateral (select x.generico_id from _miembros x where x.grupo = m.grupo and x.generico_id is not null
                   order by x.prioridad, x.ref limit 1) d on true
   where m.generico_id is null and m.fuente <> 'CATALOGO_MAESTRO'
  on conflict do nothing;
  get diagnostics v_alias = row_count;

  -- 4. clase ABC del genérico a todos sus productos
  update public.productos p set clase_abc = a.clase, abc_calculado_en = ${lit(CORTE)}::date
    from _abc a join (select distinct grupo, generico_id from _miembros where generico_id is not null) m on m.grupo = a.grupo
   where p.generico_id = m.generico_id;

  perform privado.bitacora('CATÁLOGO UNIFICADO', 'productos', null,
    jsonb_build_object('corte', ${lit(CORTE)}, 'fusiones', v_fusiones, 'provisionales', v_nuevos, 'alias_nuevos', v_alias,
                       'sin_ubicar', (select count(*) from _miembros where generico_id is null)));
  raise notice 'catálogo unificado: % fusiones, % provisionales nuevos', v_fusiones, v_nuevos;
end $$;

-- 5. pares sin decisión: se deciden en la app (una carga posterior no pisa lo ya decidido)
insert into public.revision_catalogo (id, area, tipo, parecido, propuesta, motivo, a_fuente, a_nombre, a_generico_id,
                                      b_fuente, b_nombre, b_generico_id)
select p.id, p.area, p.tipo, p.parecido, p.propuesta, p.motivo, p.a_fuente, p.a_nombre,
       (select m.generico_id from _miembros m where m.grupo = p.a_grupo and m.generico_id is not null order by m.prioridad, m.ref limit 1),
       p.b_fuente, p.b_nombre,
       (select m.generico_id from _miembros m where m.grupo = p.b_grupo and m.generico_id is not null order by m.prioridad, m.ref limit 1)
  from _pares p
on conflict (id) do nothing;
`;
writeFileSync(join(raiz, 'supabase', 'datos', 'catalogo_unificado.sql'), sql);
console.log(`✔ supabase/datos/catalogo_unificado.sql (${pendientes.length} pares quedan por decidir en la app)`);
