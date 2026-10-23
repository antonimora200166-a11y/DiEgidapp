// =====================================================================================
// Migración del histórico de bar: Sheets → SQL para Supabase.
//   node scripts/migracion/extraer.mjs [--corte AAAA-MM-DD]
// Lee referencia/*.xlsx y escribe:
//   supabase/datos/historico_bar.sql   — catálogo, productos, proveedores, fichas, taras,
//                                        conversiones y costos de referencia (idempotente)
//   supabase/datos/REPORTE_MIGRACION.md — lo que no se migró y lo que hay que confirmar
// No migra compras ni lotes al kardex: el kardex nace con el conteo inicial (SALDO_INICIAL),
// valorizado con los costos de referencia que salen de esas compras.
// =====================================================================================
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerXlsx, fechaExcel } from './xlsx.mjs';
import * as M from './mapeo.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const CORTE = arg('--corte', new Date().toISOString().slice(0, 10));
const VENTANA_DIAS = 90;

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim();
const uuid = (tipo, clave) => {
  const h = createHash('sha1').update(`sgi-diegida:${tipo}:${clave}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const lit = (v) => (v === null || v === undefined ? 'null'
  : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const ent = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const redondear = (n, d = 6) => Math.round(n * 10 ** d) / 10 ** d;

const libroCostos = leerXlsx(join(raiz, 'referencia', 'SGI-COSTOS · Producción y costo de MPI (LLENAR AQUÍ).xlsx'));
const libroRecep = leerXlsx(join(raiz, 'referencia', 'REG FMT-REC-BAR-001 · Recepción de bar (LLENAR AQUÍ).xlsx'));
const libroInv = leerXlsx(join(raiz, 'referencia', 'INV-BAR-001-Inventario-General-v2.0.xlsx'));
const hoja = (libro, nombre, desde) => {
  if (!libro[nombre]) throw new Error(`Falta la hoja ${nombre}`);
  return libro[nombre].filter((f) => f._fila >= desde);
};

const reporte = { pendientes: [], avisos: [], conflictosAlias: [], sinProducto: [], comprasExcluidas: {},
                  duplicadas: [], sinFactor: {}, tarasSinProducto: [], tarasSinPeso: [], netoSinDensidad: [],
                  medidasPendientes: [], lineasSinCantidad: [] };

// ---------------------------------------------------------------- genéricos
const genericos = new Map();            // código → genérico
const genPorNombre = new Map();         // nombre normalizado → código
let ultimoMPe = 0;
let ultimoMPi = 0;
const RAMA = (cat) => (String(cat).startsWith('MPI') ? String(cat).replace(/^MPI\s*/, '') : null);

for (const f of hoja(libroCostos, 'CATALOGO_MAESTRO', 4)) {
  if (!f.A || !/^BAR_/.test(f.A)) continue;
  const rama = RAMA(f.D);
  const g = { codigo: f.A, nombre: f.B, tipo: f.C, categoria: rama !== null ? 'MPI' : f.D, area: 'BAR',
              unidad_base: String(f.F || 'g').toLowerCase(), vida_util: null,
              nota: [rama ? `Rama: ${rama}` : null, f.J].filter(Boolean).join(' · ') || null,
              aliasRecepcion: String(f.G || '').split('|').map((s) => s.trim()).filter(Boolean),
              aliasFicha: String(f.H || '').split('|').map((s) => s.trim()).filter(Boolean), ficha: f.I };
  genericos.set(g.codigo, g);
  genPorNombre.set(norm(g.nombre), g.codigo);
  const n = /^BAR_MPe_(\d+)$/.exec(g.codigo);
  if (n) ultimoMPe = Math.max(ultimoMPe, +n[1]);
  const i = /^BAR_MPi_(\d+)$/.exec(g.codigo);
  if (i) ultimoMPi = Math.max(ultimoMPi, +i[1]);
}

function genericoNuevo(nombre, categoria, unidad_base, nota, tipo = 'MPe') {
  const k = norm(nombre);
  if (genPorNombre.has(k)) return genPorNombre.get(k);
  const codigo = tipo === 'MPI' ? `BAR_MPi_${String(++ultimoMPi).padStart(4, '0')}`
                                : `BAR_MPe_${String(++ultimoMPe).padStart(4, '0')}`;
  if (genericos.has(codigo)) throw new Error(`El código ${codigo} ya existe (${genericos.get(codigo).nombre}): no se pisa un genérico.`);
  genericos.set(codigo, { codigo, nombre, tipo, categoria, area: 'BAR', unidad_base, vida_util: null,
                          nota: nota || 'Alta por migración de INV-BAR-001 / REG FMT-REC-BAR-001.', aliasRecepcion: [], aliasFicha: [] });
  genPorNombre.set(k, codigo);
  return codigo;
}
const resolverGenerico = (g) => (typeof g === 'string' ? g
  : genericoNuevo(g.nuevo, g.categoria, g.unidad_base,
                  g.tipo === 'MPI' ? 'MPI sin ficha · alta por migración de INV-BAR-001 (decisión 22/10/2026).' : undefined, g.tipo));

// ---------------------------------------------------------------- productos
const productos = new Map();             // clave interna → producto
const codigosProducto = new Set();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '').toUpperCase().slice(0, 12);

function crearProducto(clave, p) {
  if (productos.has(clave)) return productos.get(clave);
  const g = genericos.get(p.generico);
  let sufijo = p.sufijo;
  let codigo = `${p.generico}-${sufijo}`;
  if (codigosProducto.has(codigo)) codigo = `${p.generico}-${sufijo}-${slug(p.marca) || 'B'}`;
  for (let i = 2; codigosProducto.has(codigo); i++) codigo = `${p.generico}-${sufijo}-${i}`;
  codigosProducto.add(codigo);
  const prod = { clave, codigo, id: uuid('producto', codigo), generico: p.generico, marca: p.marca || '',
                 presentacion: p.presentacion || '', unidad_compra: p.unidad_compra,
                 contenido: p.contenido_variable ? null : p.contenido, variable: !!p.contenido_variable,
                 minimo: ent(p.minimo), maximo: ent(p.maximo), nota: p.nota || null, ub: g.unidad_base };
  productos.set(clave, prod);
  return prod;
}
const productosDe = (codigoGen) => [...productos.values()].filter((p) => p.generico === codigoGen);

// ---------------------------------------------------------------- alias
const alias = new Map();                 // fuente|alias_norm → { fuente, alias, generico, producto }
function agregarAlias(fuente, texto, generico, producto) {
  const t = String(texto || '').trim();
  if (!t || !generico) return;
  const k = `${fuente}|${norm(t)}`;
  const forzado = (M.ALIAS_FORZADO || {})[k];
  if (forzado && forzado !== generico) return;
  const previo = alias.get(k);
  if (!previo) { alias.set(k, { fuente, alias: t, generico, producto: producto || null }); return; }
  if (previo.generico !== generico) {
    reporte.conflictosAlias.push(`${fuente} «${t}»: ${previo.generico} (${genericos.get(previo.generico).nombre}) y ${generico} (${genericos.get(generico).nombre}). Se dejó el primero.`);
  } else if (previo.producto !== (producto || null)) {
    previo.producto = null;            // mismo genérico, varias presentaciones: el alias apunta solo al genérico
  }
}

// ---------------------------------------------------------------- INV-BAR-001: botellas
const ENVASE = { vidrio: ['BOT', 'Botella'], lata: ['LATA', 'Lata'], plastica: ['BOT', 'Botella plástica'] };
for (const nombreHoja of ['Destilados y Licores', 'Vinos y Espumantes', 'Embotellados y Enlatados']) {
  for (const f of hoja(libroInv, nombreHoja, 10)) {
    if (typeof f.A !== 'number' || !f.C) continue;
    const ml = ent(f.D);
    const nProd = norm(f.C);
    let codigoGen = M.INVENTARIO_A_GENERICO[nProd];
    if (!codigoGen) {
      const [cat, ub] = M.TIPO_INVENTARIO[norm(f.B)] || ['OTROS', 'und'];
      const nombre = nProd.includes(norm(f.B)) ? f.C : `${f.B} ${f.C}`;
      codigoGen = genericoNuevo(nombre, cat, M.UNIDAD_BASE_NUEVO[nProd] || ub);
    }
    const g = genericos.get(codigoGen);
    const [unidad, etiqueta] = ENVASE[norm(f.E)] || ['BOT', 'Botella'];
    const prod = crearProducto(`inv:${nProd}|${ml}`, {
      generico: codigoGen, marca: f.C, presentacion: `${etiqueta} ${ml} ml`, unidad_compra: unidad,
      contenido: g.unidad_base === 'ml' ? ml : 1, sufijo: `${unidad === 'LATA' ? 'L' : ''}${ml}`,
      minimo: f.F, maximo: f.G });
    agregarAlias('INVENTARIO', f.C, codigoGen, prod.id);
  }
}

// ---------------------------------------------------------------- INV-BAR-001: fruver y subprocesos
for (const f of hoja(libroInv, 'Fruver', 10)) {
  if (typeof f.A !== 'number' || !f.B) continue;
  const d = M.FRUVER_INVENTARIO[norm(f.B)];
  if (!d) { reporte.pendientes.push(`Fruver «${f.B}»: no está en el mapeo.`); continue; }
  if (d.pendiente) { reporte.pendientes.push(`Fruver «${f.B}»: ${d.pendiente}`); continue; }
  agregarAlias('INVENTARIO', f.B, resolverGenerico(d), null);
}
for (const f of hoja(libroInv, 'Subprocesos Elaborados', 10)) {
  if (typeof f.A !== 'number' || !f.B) continue;
  const d = M.SUBPROCESOS_INVENTARIO[norm(f.B)];
  if (!d) { reporte.pendientes.push(`Subproceso «${f.B}»: no está en el mapeo.`); continue; }
  if (d.pendiente) { reporte.pendientes.push(`Subproceso «${f.B}»: ${d.pendiente}`); continue; }
  const codigoMpi = resolverGenerico(d);
  genericos.get(codigoMpi).vida_util = ent(f.E);
  agregarAlias('INVENTARIO', f.B, codigoMpi, null);
}

// ---------------------------------------------------------------- productos extra (solo compras)
for (const [k, p] of Object.entries(M.PRODUCTOS_EXTRA)) {
  const codigoGen = resolverGenerico(p.generico);
  const g = genericos.get(codigoGen);
  crearProducto(`x:${k}`, { ...p, generico: codigoGen,
    sufijo: p.contenido_variable ? p.unidad_compra : (g.unidad_base === 'und' ? slug(p.presentacion) : `${p.unidad_compra}${p.contenido}`) });
}

// ---------------------------------------------------------------- un producto por genérico que no tenga
const POR_BOTELLA = new Set(['LICOR', 'VINO', 'MIXER', 'CERVEZA']);
for (const g of genericos.values()) {
  if (['BEBIDA', 'PLATO'].includes(g.tipo) || productosDe(g.codigo).length) continue;
  const unidad = { g: 'GR', ml: 'ML', und: 'UND' }[g.unidad_base];
  if (g.tipo === 'MPe' && POR_BOTELLA.has(g.categoria)) {
    crearProducto(`g:${g.codigo}`, { generico: g.codigo, presentacion: 'Presentación por confirmar', unidad_compra: 'BOT',
      contenido_variable: true, sufijo: 'PC', nota: 'Sin presentación en inventario ni compras: confirmar marca y tamaño.' });
  } else {
    crearProducto(`g:${g.codigo}`, { generico: g.codigo,
      presentacion: g.tipo === 'MPI' ? 'Producción propia' : g.tipo === 'SIN_COSTO' ? 'Subproducto sin costo' : 'Granel',
      unidad_compra: unidad, contenido: 1, sufijo: unidad });
  }
}

// ---------------------------------------------------------------- taras
const taras = [];
for (const f of hoja(libroCostos, 'TARAS', 4)) {
  if (!f.A || typeof f.C !== 'number') continue;
  const n = M.TARAS_ALIAS[norm(f.A)] || norm(f.A);
  const prod = productos.get(`inv:${n}|${f.C}`);
  if (!prod) { reporte.tarasSinProducto.push(`${f.A} ${f.C} ml`); continue; }
  const fecha = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(f.F || ''));
  taras.push({ producto: prod.id, tara: ent(f.D), densidad: ent(f.E), fecha: fecha ? `${fecha[3]}-${fecha[2]}-${fecha[1]}` : null });
  if (!ent(f.D)) reporte.tarasSinPeso.push(`${f.A} ${f.C} ml`);
}

// ---------------------------------------------------------------- alias de catálogo, producción y recetas
for (const g of genericos.values()) {
  const unico = productosDe(g.codigo);
  for (const a of g.aliasRecepcion) agregarAlias('RECEPCION', a, g.codigo, unico.length === 1 ? unico[0].id : null);
  for (const a of g.aliasFicha) agregarAlias('FICHA', a, g.codigo, null);
}
for (const f of hoja(libroCostos, 'MAPA_PRODUCCION', 4)) {
  if (f.A && genericos.has(f.C)) agregarAlias('PRODUCCION', f.A, f.C, null);
}

// ---------------------------------------------------------------- compras → costos de referencia
const factoresCompra = {};
for (const f of hoja(libroCostos, 'FACTORES_COMPRA', 2)) {
  if (f.A && f.B && typeof f.C === 'number') factoresCompra[`${norm(f.A)}|${String(f.B).toUpperCase()}`] = f.C;
  else if (f.A && f.B) reporte.medidasPendientes.push(`Cuánto trae 1 ${f.B} de ${f.A} (${f.D || ''})`);
}
const aliasRecepcionGen = new Map();
for (const g of genericos.values()) for (const a of g.aliasRecepcion) if (!aliasRecepcionGen.has(norm(a))) aliasRecepcionGen.set(norm(a), g.codigo);

function productoDeCompra(nombre) {
  const n = norm(nombre);
  const d = M.RECEPCION[n];
  if (d) {
    if (d.excluir) return { excluir: d.excluir };
    if (d.pendiente) return { pendiente: d.pendiente };
    const prod = d.inv ? productos.get(`inv:${d.inv}`) : d.extra ? productos.get(`x:${d.extra}`) : productos.get(`g:${d.granel}`);
    if (!prod) throw new Error(`El mapeo de recepción «${nombre}» apunta a un producto que no existe (${JSON.stringify(d)}).`);
    return { prod, aviso: d.aviso };
  }
  const codigoGen = aliasRecepcionGen.get(n);
  if (!codigoGen) return { pendiente: 'No está en el catálogo de costos ni en el mapeo de recepción.' };
  const lista = productosDe(codigoGen);
  const granel = lista.find((p) => p.clave === `g:${codigoGen}`);
  if (lista.length === 1 || granel) return { prod: granel || lista[0] };
  return { pendiente: `El genérico ${codigoGen} tiene ${lista.length} presentaciones: indicar cuál en el mapeo.` };
}

function factorBase(prod, unidad) {
  const u = String(unidad || '').toUpperCase();
  if (prod.ub === 'g' && (u === 'GR' || u === 'G')) return 1;
  if (prod.ub === 'g' && u === 'KG') return 1000;
  if (prod.ub === 'ml' && u === 'ML') return 1;
  if (prod.ub === 'ml' && (u === 'L' || u === 'LT')) return 1000;
  const extra = (M.FACTORES_EXTRA[prod.clave] || {})[u];
  if (extra) return extra;
  if (u === prod.unidad_compra && prod.contenido) return prod.contenido;
  // en las facturas «UND» de un producto que se compra por botella o lata es una botella o lata
  if (u === 'UND' && ['BOT', 'LATA'].includes(prod.unidad_compra) && prod.contenido) return prod.contenido;
  if (prod.ub === 'und' && ['UND', 'BOT', 'LATA'].includes(u)) return 1;
  const g = genericos.get(prod.generico);
  return factoresCompra[`${norm(g.nombre)}|${u}`] || null;
}

const INVALIDAN = ['H02', 'H03', 'H04', 'H09', 'H12'];
const compras = new Map();      // producto.id → [{fecha, base, valor}]
const vistas = new Map();
const nombresVistos = new Set();
const excluir = (motivo, f) => { (reporte.comprasExcluidas[motivo] = reporte.comprasExcluidas[motivo] || []).push(`${f.A} ${f.G}`); };
for (const f of hoja(libroRecep, 'BD_RECEPCION_BAR', 2)) {
  if (!f.A || !f.G) continue;
  const r = productoDeCompra(f.G);
  if (!nombresVistos.has(norm(f.G))) {
    nombresVistos.add(norm(f.G));
    if (r.prod) agregarAlias('RECEPCION', f.G, r.prod.generico, r.prod.id);
    if (r.pendiente) reporte.sinProducto.push(`«${f.G}»: ${r.pendiente}`);
    if (r.aviso) reporte.avisos.push(`«${f.G}»: ${r.aviso}`);
  }
  if (r.excluir) { excluir(r.excluir, f); continue; }
  if (!r.prod) { excluir('Producto sin mapear', f); continue; }
  if (String(f.AA) === 'REVERSADA') { excluir('Línea REVERSADA', f); continue; }
  const hall = INVALIDAN.filter((h) => String(f.AD || '').includes(h));
  if (hall.length) { excluir(`Hallazgo que invalida el precio (${hall.join(', ')})`, f); continue; }
  const cant = ent(f.M), valor = ent(f.P), fecha = fechaExcel(f.C);
  if (!(cant > 0) || !(valor > 0) || !fecha) { excluir('Sin cantidad, valor o fecha', f); continue; }
  const factor = factorBase(r.prod, f.K);
  if (!factor) {
    (reporte.sinFactor[r.prod.codigo] = reporte.sinFactor[r.prod.codigo] || new Set()).add(String(f.K || '(vacía)'));
    excluir('Unidad de compra sin factor a unidad base', f); continue;
  }
  const llave = `${fecha}|${r.prod.id}|${cant}|${valor}`;
  if (vistas.has(llave)) { reporte.duplicadas.push(`${f.A} repite ${vistas.get(llave)} (${f.G}, ${fecha}, ${cant} ${f.K || ''}, $${valor})`); continue; }
  vistas.set(llave, f.A);
  (compras.get(r.prod.id) || compras.set(r.prod.id, []).get(r.prod.id)).push({ fecha, base: cant * factor, valor, id: f.A });
}

const costosRef = [];
const prodPorId = new Map([...productos.values()].map((p) => [p.id, p]));
const fmtF = (s) => s.split('-').reverse().join('/');
for (const [pid, cs] of compras) {
  // compras contradictorias (error de unidad): fuera del promedio, como en SGI-COSTOS v1.1
  const pus = cs.map((c) => c.valor / c.base);
  const orden = [...pus].sort((a, b) => a - b);
  const med = orden.length % 2 ? orden[(orden.length - 1) / 2] : (orden[orden.length / 2 - 1] + orden[orden.length / 2]) / 2;
  const quedan = cs.filter((c, i) => !((cs.length >= 3 && (pus[i] > med * 5 || pus[i] < med / 5))
                                       || (cs.length === 2 && orden[1] / orden[0] > 5)));
  if (quedan.length < cs.length) reporte.avisos.push(`${prodPorId.get(pid).codigo}: ${cs.length - quedan.length} compra(s) descartada(s) por precio contradictorio.`);
  if (!quedan.length) continue;
  quedan.sort((a, b) => a.fecha.localeCompare(b.fecha));
  const desde = new Date(Date.parse(CORTE) - VENTANA_DIAS * 86400000).toISOString().slice(0, 10);
  const enVentana = quedan.filter((c) => c.fecha >= desde && c.fecha <= CORTE);
  const ult = quedan[quedan.length - 1];
  const cu = enVentana.length
    ? enVentana.reduce((s, c) => s + c.valor, 0) / enVentana.reduce((s, c) => s + c.base, 0)
    : ult.valor / ult.base;
  costosRef.push({ producto: pid, cu: redondear(cu), n: enVentana.length || 1, ultima: ult.fecha,
    fuente: enVentana.length ? `REC-BAR: promedio ponderado de ${enVentana.length} compra(s) en ${VENTANA_DIAS} días`
                             : `REC-BAR: última compra (${fmtF(ult.fecha)}), fuera de la ventana de ${VENTANA_DIAS} días` });
}
// MPI: costo promedio de sus lotes costeados en SGI-COSTOS
for (const f of hoja(libroCostos, 'COSTO_MPI', 4)) {
  const prod = productos.get(`g:${f.A}`);
  if (!prod || typeof f.H !== 'number') continue;
  costosRef.push({ producto: prod.id, cu: redondear(f.H), n: ent(f.D), ultima: fechaExcel(f.F),
    fuente: `SGI-COSTOS: $/g promedio de los lotes con costo (${f.D} lote(s) registrados)` });
}

// ---------------------------------------------------------------- conversiones medidas
const conversiones = [];
for (const f of hoja(libroCostos, 'PARAMETROS', 4)) {
  if (!f.A || !f.C) continue;
  const codigoGen = genPorNombre.get(norm(f.B));
  const [de, a] = String(f.C).split('→');
  if (typeof f.D !== 'number') {
    reporte.medidasPendientes.push(`${f.B}: ${f.C} (desbloquea ${ent(f.E) ?? '?'} línea(s) de ficha)`);
    continue;
  }
  if (!codigoGen) { reporte.avisos.push(`Parámetro «${f.A}»: no encuentro el genérico «${f.B}».`); continue; }
  if (genericos.get(codigoGen).unidad_base !== a) { reporte.avisos.push(`Parámetro «${f.A}»: la unidad base de ${f.B} no es ${a}.`); continue; }
  const supuesto = de === 'ml' && a === 'g' && /^(te|infusion)/.test(norm(f.B));
  conversiones.push({ generico: codigoGen, unidad: de, factor: f.D, estado: supuesto ? 'SUPUESTO' : 'DECLARADO',
                      nota: supuesto ? 'Supuesto declarado en SGI-COSTOS v0.4: infusiones a base de agua = 1 g/ml.' : 'Valor de PARAMETROS (SGI-COSTOS).' });
}
const conversionDe = (gen, unidad) => conversiones.find((c) => c.generico === gen && c.unidad === unidad);

// ---------------------------------------------------------------- fichas de MPI
const fichas = [];
const lineasFicha = [];
const detalle = hoja(libroCostos, 'FICHAS_DETALLE', 4);
for (const f of hoja(libroCostos, 'FICHAS', 4)) {
  if (!f.A || f.A === 'SIN FICHA' || !genericos.has(f.B)) continue;
  const g = genericos.get(f.B);
  const um = String(f.G || '').toLowerCase();
  let neto = ent(f.F), nota = null;
  if (neto !== null && um && um !== g.unidad_base) {
    const c = conversionDe(g.codigo, um);
    if (c) { nota = `Neto de la ficha: ${neto} ${um} × ${c.factor} g/ml.`; neto = redondear(neto * c.factor, 3); }
    else { nota = `Neto de la ficha: ${neto} ${um}. Falta la densidad ${um}→${g.unidad_base} para fijarlo.`;
           reporte.netoSinDensidad.push(`${f.A} ${g.nombre}: ${neto} ${um}`); neto = null; }
  }
  const id = uuid('ficha', f.A);
  fichas.push({ id, codigo: f.A, generico: g.codigo, neto, nota });
  for (const l of detalle.filter((x) => x.A === f.A)) {
    const recod = (M.RECODIFICAR_FICHAS || {})[`${f.A}|${l.D}`];
    if (recod) { reporte.avisos.push(`Ficha ${f.A} línea ${l.D} («${l.E}»): ${l.F} → ${recod} por decisión de mapeo.`); l.F = recod; }
    if (!genericos.has(l.F)) { reporte.avisos.push(`Ficha ${f.A} línea ${l.D}: el código ${l.F} no está en el catálogo.`); continue; }
    const cantidad = ent(l.K);
    if (cantidad === null) reporte.lineasSinCantidad.push(`Ficha ${f.A} (${g.nombre}): ${l.E}`);
    lineasFicha.push({ ficha: id, linea: ent(l.D), generico: l.F, cantidad, unidad: String(l.L || l.J || genericos.get(l.F).unidad_base).toLowerCase(),
                       nota: l.E && norm(l.E) !== norm(genericos.get(l.F).nombre) ? `En la ficha: ${l.E}` : null });
  }
}

// ---------------------------------------------------------------- cócteles (genérico BEBIDA + ficha)
const recetas = hoja(libroCostos, 'RECETAS_COCTEL', 4);
for (const f of hoja(libroCostos, 'COCTELES', 4)) {
  if (!f.A || !f.B) continue;
  const codigo = `BAR_BEB_${f.A}`;
  if (genPorNombre.has(norm(f.B))) reporte.avisos.push(`El cóctel «${f.B}» se llama igual que ${genPorNombre.get(norm(f.B))}.`);
  genericos.set(codigo, { codigo, nombre: f.B, tipo: 'BEBIDA', categoria: 'COCTEL', area: 'BAR', unidad_base: 'und',
                          activo: f.E !== 'NO', vida_util: null, aliasRecepcion: [], aliasFicha: [],
                          nota: [`Carta: ${f.C}`, f.F ? `Ficha origen: ${f.F}` : null, f.G].filter(Boolean).join(' · ') });
  const id = uuid('ficha', f.A);
  fichas.push({ id, codigo: f.A, generico: codigo, neto: null, nota: null });
  for (const l of recetas.filter((x) => x.A === f.A)) {
    if (!genericos.has(l.E)) { reporte.avisos.push(`Receta ${f.A} línea ${l.C}: el código ${l.E} no está en el catálogo.`); continue; }
    const cantidad = ent(l.G);
    if (cantidad === null) reporte.lineasSinCantidad.push(`Cóctel ${f.A} ${f.B}: ${l.D}${l.I ? ` (${l.I})` : ''}`);
    lineasFicha.push({ ficha: id, linea: ent(l.C), generico: l.E, cantidad, unidad: String(l.H || 'ml').toLowerCase(),
                       nota: [l.D ? `En la receta: ${l.D}` : null, l.I].filter(Boolean).join(' · ') || null });
    agregarAlias('RECETA', l.D, l.E, null);
  }
}

// ---------------------------------------------------------------- proveedores
const proveedores = hoja(libroRecep, 'CAT_PROVEEDORES', 4).filter((f) => f.B).map((f) => f.B);

// =====================================================================================
// SQL
// =====================================================================================
const out = [];
const w = (s) => out.push(s);
const bloque = (titulo, filas, encabezado, cola = 'on conflict do nothing;') => {
  if (!filas.length) return;
  w(`\n-- ${titulo} (${filas.length})`);
  for (let i = 0; i < filas.length; i += 200) {
    w(`${encabezado} values\n  ${filas.slice(i, i + 200).join(',\n  ')}\n${cola}`);
  }
};

w(`-- =====================================================================================
-- SGI Di Égida · Histórico de bar migrado de los Sheets
-- Generado por scripts/migracion/extraer.mjs (corte de costos: ${CORTE}). NO editar a mano:
-- corregir scripts/migracion/mapeo.mjs y volver a generar.
-- Idempotente (on conflict do nothing). Ejecutar en una sola transacción, después de las
-- migraciones:  psql "$DATABASE_URL" -1 -f supabase/datos/historico_bar.sql
-- =====================================================================================`);

const CATS = [['LICOR', 'Licores', true, false], ['VINO', 'Vinos y espumantes', true, false], ['CERVEZA', 'Cervezas', false, true],
  ['MIXER', 'Mixers y gaseosas', false, true], ['FRUVER', 'Frutas y verduras', false, true], ['HIELO', 'Hielo', false, false],
  ['INSUMO_SECO', 'Insumos secos', false, false], ['LACTEO', 'Lácteos', false, true], ['MPI', 'Producción propia', false, true],
  ['AGUA', 'Agua', false, false], ['SUBPRODUCTO', 'Subproductos sin costo', false, false], ['COCTEL', 'Coctelería de carta', false, false],
  ['DESECHABLE', 'Desechables', false, false], ['OTROS', 'Otros', false, false]];
bloque('categorías', CATS.map(([c, n, s, p]) => `(${lit(c)}, ${lit(n)}, 'BAR', ${s}, ${p})`),
  'insert into public.categorias (codigo, nombre, area, exige_sello, es_perecedero)');
bloque('ubicaciones', [`('BAR_BODEGA', 'Bodega de bar', 'BAR')`, `('BAR_BARRA', 'Barra', 'BAR')`],
  'insert into public.ubicaciones (codigo, nombre, area)');
bloque('proveedores', proveedores.map((p) => `(${lit(uuid('proveedor', norm(p)))}, ${lit(p)})`),
  'insert into public.proveedores (id, nombre)');

const listaGen = [...genericos.values()];
bloque('genéricos', listaGen.map((g) => `(${lit(uuid('generico', g.codigo))}, ${lit(g.codigo)}, ${lit(g.nombre)}, ${lit(g.tipo)}, ${lit(g.categoria)}, 'BAR', ${lit(g.unidad_base)}, ${lit(g.vida_util)}, ${g.activo === false ? 'false' : 'true'}, ${lit(g.nota)})`),
  'insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base, vida_util_dias, activo, nota)');
bloque('productos', [...productos.values()].map((p) => `(${lit(p.id)}, ${lit(p.codigo)}, ${lit(uuid('generico', p.generico))}, ${lit(p.marca)}, ${lit(p.presentacion)}, ${lit(p.unidad_compra)}, ${lit(p.contenido)}, ${p.variable}, ${lit(p.minimo)}, ${lit(p.maximo)}, ${lit(p.nota)})`),
  'insert into public.productos (id, codigo, generico_id, marca, presentacion, unidad_compra, contenido_base, contenido_variable, stock_minimo, stock_maximo, nota)');
bloque('taras (INV-BAR-003 / inventario semanal 27/09/2026)', taras.map((t) => `(${lit(t.producto)}, ${lit(t.tara)}, ${lit(t.densidad)}, ${lit(t.fecha)})`),
  'insert into public.taras (producto_id, tara_g, densidad_g_ml, medido_en)');
bloque('alias', [...alias.values()].map((a) => `(${lit(uuid('alias', `${a.fuente}|${norm(a.alias)}`))}, ${lit(a.fuente)}, ${lit(a.alias)}, ${lit(uuid('generico', a.generico))}, ${lit(a.producto)})`),
  'insert into public.alias (id, fuente, alias, generico_id, producto_id)');
bloque('conversiones', conversiones.map((c) => `(${lit(uuid('conversion', `${c.generico}|${c.unidad}`))}, ${lit(uuid('generico', c.generico))}, ${lit(c.unidad)}, ${c.factor}, ${lit(c.estado)}, ${lit(c.nota)})`),
  'insert into public.conversiones (id, generico_id, unidad, factor_a_base, estado, nota)');
bloque('fichas', fichas.map((f) => `(${lit(f.id)}, ${lit(f.codigo)}, ${lit(uuid('generico', f.generico))}, ${lit(f.neto)}, date '2026-10-05', ${lit(f.nota)})`),
  'insert into public.fichas (id, codigo, generico_id, neto_esperado, vigente_desde, nota)');
bloque('líneas de ficha', lineasFicha.map((l) => `(${lit(uuid('ficha_linea', `${l.ficha}|${l.linea}`))}, ${lit(l.ficha)}, ${l.linea}, ${lit(uuid('generico', l.generico))}, ${lit(l.cantidad)}, ${lit(l.unidad)}, ${lit(l.nota)})`),
  'insert into public.ficha_lineas (id, ficha_id, linea, generico_id, cantidad, unidad, nota)');
bloque(`costos de referencia (corte ${CORTE})`, costosRef.map((c) => `(${lit(c.producto)}, ${c.cu}, ${lit(c.fuente)}, ${lit(c.n)}, ${lit(c.ultima)}, ${lit(CORTE)})`),
  'insert into public.costos_referencia (producto_id, costo_unitario_base, fuente, n_compras, ultima_compra, calculado_en)');
w(`\nselect privado.bitacora('MIGRACIÓN HISTÓRICO BAR', 'genericos', null, jsonb_build_object(
  'corte', ${lit(CORTE)}, 'genericos', ${listaGen.length}, 'productos', ${productos.size}, 'fichas', ${fichas.length},
  'lineas_ficha', ${lineasFicha.length}, 'costos_referencia', ${costosRef.length}, 'proveedores', ${proveedores.length}));`);

mkdirSync(join(raiz, 'supabase', 'datos'), { recursive: true });
writeFileSync(join(raiz, 'supabase', 'datos', 'historico_bar.sql'), out.join('\n') + '\n');

// =====================================================================================
// REPORTE
// =====================================================================================
const r = [];
const sec = (t, lista, vacio = 'Nada.') => { r.push(`\n## ${t}\n`); r.push(lista.length ? lista.map((x) => `- ${x}`).join('\n') : vacio); };
const cuenta = (pred) => listaGen.filter(pred).length;
const prods = [...productos.values()];
r.push(`# Migración del histórico de bar\n\nGenerado por \`scripts/migracion/extraer.mjs\` · corte de costos **${CORTE}** · fuente: los tres libros de \`referencia/\`.`);
r.push(`\n## Qué entra\n
| Qué | Cantidad |
|---|---|
| Genéricos | ${listaGen.length} (MPe ${cuenta((g) => g.tipo === 'MPe')}, MPI ${cuenta((g) => g.tipo === 'MPI')}, sin costo ${cuenta((g) => g.tipo === 'SIN_COSTO')}, cócteles ${cuenta((g) => g.tipo === 'BEBIDA')}) |
| Genéricos nuevos (estaban en inventario o compras, no en el catálogo de costos) | ${listaGen.filter((g) => /alta por migración de INV/i.test(g.nota || '')).length} |
| Productos (genérico + marca + presentación) | ${prods.length} |
| — con presentación por confirmar | ${prods.filter((p) => p.presentacion === 'Presentación por confirmar').length} |
| Taras | ${taras.length} (${reporte.tarasSinPeso.length} sin peso de botella vacía) |
| Alias de nombres | ${alias.size} |
| Conversiones con valor | ${conversiones.length} |
| Fichas | ${fichas.filter((f) => !/^C\d/.test(f.codigo)).length} de MPI + ${fichas.filter((f) => /^C\d/.test(f.codigo)).length} de cócteles, ${lineasFicha.length} líneas |
| Proveedores | ${proveedores.length} |
| Costos de referencia | ${costosRef.length} productos |

**Qué no entra:** las compras y los lotes históricos no entran al kardex. Solo dejan su costo de referencia, que valoriza el saldo inicial del primer conteo. Herramientas, utensilios y cristalería tampoco entran, porque son activos y no consumibles.`);
sec('Por confirmar antes de migrar (no se migró)', reporte.pendientes);
sec('Nombres de compra sin producto', reporte.sinProducto);
sec('Alias en conflicto (dos genéricos con el mismo nombre)', reporte.conflictosAlias);
sec('Avisos', reporte.avisos);
sec('Compras repetidas (no entran al costo de referencia)', reporte.duplicadas);
sec('Unidades de compra sin factor', Object.entries(reporte.sinFactor).map(([c, u]) => `${c}: ${[...u].join(', ')}`));
r.push('\n## Compras excluidas del costo de referencia\n');
r.push(Object.entries(reporte.comprasExcluidas).map(([m, l]) => `- **${m}**: ${l.length}`).join('\n') || 'Ninguna.');
sec('Fichas con neto en ml sin densidad (neto_esperado queda vacío)', reporte.netoSinDensidad);
sec('Líneas de ficha o receta sin cantidad', reporte.lineasSinCantidad);
sec('Medidas pendientes (PESAJE)', reporte.medidasPendientes);
sec('Taras sin producto en el inventario', reporte.tarasSinProducto);
sec('Taras sin peso de botella vacía', reporte.tarasSinPeso);
sec('Productos con presentación por confirmar', prods.filter((p) => p.presentacion === 'Presentación por confirmar').map((p) => `${p.codigo} · ${genericos.get(p.generico).nombre}`));
writeFileSync(join(raiz, 'supabase', 'datos', 'REPORTE_MIGRACION.md'), r.join('\n') + '\n');

console.log(`✔ ${listaGen.length} genéricos · ${productos.size} productos · ${fichas.length} fichas · ${lineasFicha.length} líneas · ${costosRef.length} costos de referencia · ${alias.size} alias`);
console.log(`  pendientes: ${reporte.pendientes.length} · sin producto: ${reporte.sinProducto.length} · conflictos de alias: ${reporte.conflictosAlias.length} · duplicadas: ${reporte.duplicadas.length}`);
