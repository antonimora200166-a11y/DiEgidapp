// =====================================================================================
// Migración del histórico de cocina: INV-COC-001 + REG_REC_COC_003 → SQL para Supabase.
//   node scripts/migracion/extraer_cocina.mjs [--corte AAAA-MM-DD]
// Escribe:
//   supabase/datos/historico_cocina.sql          — catálogo, productos, zonas, proveedores,
//                                                  alias y costos de referencia (idempotente)
//   supabase/datos/REPORTE_MIGRACION_COCINA.md    — lo que no entró y lo que hay que confirmar
//   scripts/migracion/cruces_cocina.csv           — cruces recepción → inventario para decidir
//
// Decisiones de Anthony (22/10/2026):
//   · El catálogo maestro es INV-COC-001: PRODUCTO BASE = genérico, PRODUCTO (clave) = producto.
//     Los productos de la recepción se enlazan como alias y aportan categoría, conservación y
//     temperatura máxima.
//   · Las altas «— sin clasificar —» creadas desde el conteo no entran hasta que se validen.
//   · Los «Mpe Bar» / «Mpi Bar» guardados en cocina son genéricos de cocina.
//   · Las fichas de los MPi de cocina esperan su archivo.
// Solo se enlazan en automático los nombres idénticos; el resto se decide en cruces_cocina.csv.
// =====================================================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerXlsx, fechaExcel } from './xlsx.mjs';
import { norm, uuid, lit, ent, redondear, parecido } from './comun.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '..', '..');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const CORTE = arg('--corte', new Date().toISOString().slice(0, 10));
const VENTANA_DIAS = 90;
const RUTA_CRUCES = join(aqui, 'cruces_cocina.csv');

const inv = leerXlsx(join(raiz, 'referencia', 'INV-COC-001-Inventario-Cocina-v6.5.1 (1).xlsx'));
const rec = leerXlsx(join(raiz, 'referencia', 'REG_REC_COC_003.xlsx'));
const hoja = (libro, nombre, desde) => {
  if (!libro[nombre]) throw new Error(`Falta la hoja ${nombre}`);
  return libro[nombre].filter((f) => f._fila >= desde);
};
const cap = (s) => { const t = String(s || '').trim(); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
const ub = (u) => { const x = norm(u); return x === 'un' || x === 'und' ? 'und' : x === 'ml' ? 'ml' : x === 'g' ? 'g' : null; };

const reporte = { sinClasificar: [], tipoDudoso: [], unidadMezclada: [], baseDistinta: [], sinUbicar: 0,
                  ubicacionSinProducto: [], comprasExcluidas: {}, duplicadas: [], categoriaChoque: [] };

// ---------------------------------------------------------------- catálogo de inventario
const filas = hoja(inv, 'CATALOGO', 5).filter((f) => f.D);
const PARECE_MPE = /\b(pollo|muslos?|codorniz|camaron|langostino|salmon|mero|res|cerdo|conejo|pargo|pulpo|calamar|menudencia|hueso|huesos|tuetano|cangrejo)\b/;
function tipoDe(f) {
  const t = norm(f.F), e = norm(f.E);
  if (t.startsWith('mpe')) return 'MPe';
  if (t.startsWith('mpi') || t.startsWith('plato')) return 'MPI';
  if (!t && e.startsWith('mpi')) return 'MPI';
  if (!t && e.startsWith('mpe')) return 'MPe';
  if (!t && e.startsWith('pla')) return 'MPI';
  return null;
}

const gens = new Map();   // nombre normalizado → genérico
for (const f of filas) {
  if (/sin clasificar/i.test(f.F || '')) { reporte.sinClasificar.push(`${f.D}${f.G ? ` [${f.G}]` : ''}`); continue; }
  const tipo = tipoDe(f);
  if (!tipo) { reporte.sinClasificar.push(`${f.D} (sin tipo ni categoría)`); continue; }
  const k = norm(f.B || f.D);
  const g = gens.get(k) || { nombre: String(f.B || f.D).trim(), filas: [], tipos: {}, ums: {}, notas: new Set() };
  g.filas.push(f);
  g.tipos[tipo] = (g.tipos[tipo] || 0) + 1;
  const u = ub(f.G);
  if (u) g.ums[u] = (g.ums[u] || 0) + 1;
  if (/plato/i.test(f.F || '') || /^pla/i.test(f.E || '')) g.notas.add('Plato terminado que se guarda y se cuenta: se trata como MPI.');
  if (/bar/i.test(f.E || '')) g.notas.add(`Insumo de bar guardado en cocina (categoría «${f.E}» en INV-COC-001).`);
  if (!f.F && PARECE_MPE.test(norm(f.D))) reporte.tipoDudoso.push(`${f.D}: la alta dice «${f.E}», pero parece materia prima comprada.`);
  gens.set(k, g);
}
for (const g of gens.values()) {
  g.tipo = Object.entries(g.tipos).sort((a, b) => b[1] - a[1])[0][0];
  if (Object.keys(g.tipos).length > 1) g.notas.add(`Filas con tipos distintos en INV-COC-001 (${Object.keys(g.tipos).join(', ')}); quedó ${g.tipo}.`);
  // la unidad base es la de peso o volumen si alguna fila la tiene; «un» solo si todas cuentan por unidad
  const pesoVol = Object.entries(g.ums).filter(([u]) => u !== 'und').sort((a, b) => b[1] - a[1]);
  g.unidad_base = pesoVol.length ? pesoVol[0][0] : 'und';
  if (Object.keys(g.ums).length > 1) reporte.unidadMezclada.push(`${g.nombre}: ${Object.keys(g.ums).join(' / ')} → ${g.unidad_base}`);
}
// códigos en orden alfabético: regenerar da los mismos códigos mientras el catálogo no cambie
const contador = { MPe: 0, MPI: 0 };
const codigoNuevo = (tipo) => `COC_${tipo === 'MPI' ? 'MPi' : 'MPe'}_${String(++contador[tipo]).padStart(4, '0')}`;
for (const g of [...gens.values()].sort((a, b) => norm(a.nombre).localeCompare(norm(b.nombre)))) g.codigo = codigoNuevo(g.tipo);

// ---------------------------------------------------------------- productos
const productos = [];
const codigosUsados = new Set();
const presentacionesUsadas = new Set();
const prodPorClave = new Map();     // nombre clave normalizado → producto
for (const g of gens.values()) {
  let n = 0;
  for (const f of g.filas) {
    n++;
    const uFila = ub(f.G) || g.unidad_base;
    const unidadConteo = cap(f.H) || (g.unidad_base === 'und' ? 'Unidad' : 'Granel');
    const peso = ent(f.I);
    let contenido = null, variable = false, nota = null;
    if (unidadConteo === 'Granel') contenido = 1;
    else if (uFila === g.unidad_base) {
      if (g.unidad_base === 'und') contenido = 1;
      else if (norm(f.J) === 'variable' || !peso) variable = true;
      else contenido = peso;
    } else if (uFila === 'und' && peso) {
      contenido = peso;
      nota = `Contado por unidad en INV-COC-001: ${peso} ${g.unidad_base} por ${unidadConteo.toLowerCase()} según el catálogo (validar).`;
    } else {
      variable = true;
      nota = `INV-COC-001 lo cuenta en ${uFila} y el genérico va en ${g.unidad_base}: el contenido se registra en cada recepción y conteo.`;
    }
    if (norm(f.J) === 'variable' && contenido !== 1) { variable = true; contenido = null; }
    let presentacion = `${unidadConteo}${contenido && contenido !== 1 && g.unidad_base !== 'und' ? ` ${contenido} ${g.unidad_base}` : ''}`;
    const marca = String(f.C || '').trim();
    if (presentacionesUsadas.has(`${g.codigo}|${marca}|${presentacion}`)) presentacion = `${presentacion} · ${f.D}`;
    presentacionesUsadas.add(`${g.codigo}|${marca}|${presentacion}`);
    let codigo = f.A && !codigosUsados.has(f.A) ? f.A : `${g.codigo}-${String(n).padStart(2, '0')}`;
    if (f.A && codigosUsados.has(f.A)) nota = [nota, `El código POS ${f.A} está repetido en INV-COC-001.`].filter(Boolean).join(' ');
    codigosUsados.add(codigo);
    const p = { id: uuid('producto', codigo), codigo, generico: g.codigo, marca, presentacion,
                unidad_compra: unidadConteo === 'Granel' ? { g: 'GR', ml: 'ML', und: 'UND' }[g.unidad_base] : norm(unidadConteo).toUpperCase(),
                contenido: variable ? null : contenido, variable, minimo: ent(f.K),
                activo: norm(f.Q) !== 'no' && !/· baja/i.test(f.T || ''), nota, clave: f.D };
    productos.push(p);
    prodPorClave.set(norm(f.D), p);
  }
}
const productosDe = (codigoGen) => productos.filter((p) => p.generico === codigoGen);
const genPorCodigo = new Map([...gens.values()].map((g) => [g.codigo, g]));
const genPorNombre = new Map([...gens.values()].map((g) => [norm(g.nombre), g]));

// ---------------------------------------------------------------- zonas y ubicaciones
const zonas = hoja(inv, 'CAT_ZONAS', 5).filter((f) => f.A && /^[A-Z0-9]+$/.test(f.A))
  .map((f) => ({ codigo: `COC_${f.A}`, nombre: cap(String(f.B).toLowerCase()), activo: norm(f.E) !== 'no', clave: norm(f.B) }));
const zonaPorNombre = new Map(zonas.map((z) => [z.clave, z.codigo]));
const ubicaciones = [];
const vistasUbic = new Set();
for (const f of hoja(inv, 'CAT_UBICACION', 5).filter((x) => x.A)) {
  const p = prodPorClave.get(norm(f.A));
  const z = zonaPorNombre.get(norm(f.B));
  if (!p || !z) { if (!p) reporte.sinUbicar++; else reporte.ubicacionSinProducto.push(`${f.A} → zona «${f.B}»`); continue; }
  if (vistasUbic.has(`${z}|${p.id}`)) continue;
  vistasUbic.add(`${z}|${p.id}`);
  ubicaciones.push({ ubicacion: z, producto: p.id, orden: ent(f.C), minimo: ent(f.D), activo: norm(f.E) !== 'no' });
}

// ---------------------------------------------------------------- catálogo de recepción → cruces
const CATEGORIA = {
  'abarrotes y secos': ['COC_ABARROTES', 'Abarrotes y secos', false], 'aves y huevos': ['COC_AVES_HUEVOS', 'Aves y huevos', true],
  'carnicos': ['COC_CARNICOS', 'Cárnicos', true], 'fruver': ['COC_FRUVER', 'Frutas y verduras', true],
  'lacteos': ['COC_LACTEOS', 'Lácteos', true], 'pesca y mariscos': ['COC_PESCA', 'Pesca y mariscos', true],
  'aseo y desechables': ['COC_ASEO', 'Aseo y desechables', false],
};
const recCat = hoja(rec, 'CATALOGO', 6).filter((f) => f.B).map((f) => ({
  nombre: String(f.B).trim(), base: ub(f.C), categoria: (CATEGORIA[norm(f.D)] || [])[0] || null,
  conservacion: ['Ambiente', 'Refrigerado', 'Congelado'].includes(f.E) ? f.E : null, tmax: ent(f.F),
  compras: ent(f.G) || 0, activo: norm(f.I) !== 'inactivo' }));

// decisiones ya escritas por una persona
const decisiones = new Map();
if (existsSync(RUTA_CRUCES)) {
  const lineas = readFileSync(RUTA_CRUCES, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const enc = lineas.shift().split(';');
  const iRec = enc.indexOf('recepcion'), iDec = enc.indexOf('decision'), iS = [1, 2, 3].map((k) => enc.indexOf(`sugerencia_${k}`));
  for (const l of lineas) {
    const c = l.split(';');
    const d = String(c[iDec] || '').trim();
    if (d) decisiones.set(norm(c[iRec]), { d, sugerencias: iS.map((i) => c[i]) });
  }
}
const nombresGen = [...gens.values()].map((g) => g.nombre);
const cruces = [];        // { r, destino: codigo | 'NUEVO' | 'EXCLUIR' | null, via, sugerencias }
for (const r of recCat) {
  const exacto = genPorNombre.get(norm(r.nombre)) || (prodPorClave.get(norm(r.nombre)) && genPorCodigo.get(prodPorClave.get(norm(r.nombre)).generico));
  const sugerencias = nombresGen.map((n) => ({ n, s: parecido(r.nombre, n) })).sort((a, b) => b.s - a.s).slice(0, 3);
  let destino = null, via = 'pendiente';
  if (exacto) { destino = exacto.codigo; via = 'nombre idéntico'; }
  else if (decisiones.has(norm(r.nombre))) {
    const { d } = decisiones.get(norm(r.nombre));
    const D = d.toUpperCase();
    if (D === 'NUEVO' || D === 'EXCLUIR') { destino = D; via = 'decisión'; }
    else if (['1', '2', '3'].includes(d)) { destino = genPorNombre.get(norm(sugerencias[+d - 1].n)).codigo; via = `decisión: sugerencia ${d}`; }
    else if (genPorNombre.has(norm(d))) { destino = genPorNombre.get(norm(d)).codigo; via = 'decisión: nombre escrito'; }
    else reporte.categoriaChoque.push(`cruces_cocina.csv: «${r.nombre}» → «${d}» no es 1, 2, 3, NUEVO, EXCLUIR ni un genérico del inventario.`);
  }
  cruces.push({ r, destino, via, sugerencias });
}

// los NUEVO de la recepción son genéricos MPe con su producto a granel o por unidad
for (const c of cruces.filter((x) => x.destino === 'NUEVO')) {
  const codigo = codigoNuevo('MPe');
  const g = { codigo, nombre: c.r.nombre, tipo: 'MPe', unidad_base: c.r.base || 'und', filas: [], notas: new Set(['Alta desde REG_REC_COC_003 (no está en INV-COC-001).']), activo: c.r.activo };
  gens.set(norm(c.r.nombre), g); genPorCodigo.set(codigo, g); genPorNombre.set(norm(c.r.nombre), g);
  const unidad = { g: 'GR', ml: 'ML', und: 'UND' }[g.unidad_base];
  productos.push({ id: uuid('producto', `${codigo}-01`), codigo: `${codigo}-01`, generico: codigo, marca: '',
                   presentacion: g.unidad_base === 'und' ? 'Unidad' : 'Granel', unidad_compra: unidad, contenido: 1,
                   variable: false, minimo: null, activo: c.r.activo, nota: null, clave: c.r.nombre });
  c.destino = codigo;
}

// la recepción aporta categoría y cadena de frío al genérico enlazado
for (const c of cruces.filter((x) => genPorCodigo.has(x.destino))) {
  const g = genPorCodigo.get(c.destino);
  for (const campo of ['categoria', 'conservacion', 'tmax']) {
    if (c.r[campo] === null || c.r[campo] === undefined) continue;
    if (g[campo] === undefined || g[campo] === null) g[campo] = c.r[campo];
    else if (g[campo] !== c.r[campo]) reporte.categoriaChoque.push(`${g.nombre}: ${campo} «${g[campo]}» (se dejó) vs «${c.r[campo]}» de «${c.r.nombre}».`);
  }
  if (c.r.base && c.r.base !== g.unidad_base) reporte.baseDistinta.push(`«${c.r.nombre}» se recibe en ${c.r.base} y el genérico ${g.nombre} va en ${g.unidad_base}: sus compras no dan costo de referencia.`);
}
for (const g of gens.values()) if (!g.categoria && g.tipo === 'MPI') g.categoria = 'COC_MPI';

// ---------------------------------------------------------------- alias
const alias = new Map();
const agregarAlias = (fuente, texto, generico, producto) => {
  const t = String(texto || '').trim();
  if (!t || !generico) return;
  const k = `${fuente}|${norm(t)}`;
  const previo = alias.get(k);
  if (!previo) alias.set(k, { fuente, alias: t, generico, producto: producto || null });
  else if (previo.generico === generico && previo.producto !== (producto || null)) previo.producto = null;
};
for (const p of productos) {
  agregarAlias('INVENTARIO', p.clave, p.generico, p.id);
  agregarAlias('INVENTARIO', genPorCodigo.get(p.generico).nombre, p.generico, null);
}
for (const c of cruces.filter((x) => genPorCodigo.has(x.destino))) {
  const lista = productosDe(c.destino);
  agregarAlias('RECEPCION', c.r.nombre, c.destino, lista.length === 1 ? lista[0].id : null);
}

// ---------------------------------------------------------------- compras → costos de referencia
const destinoCompra = new Map(cruces.map((c) => [norm(c.r.nombre), c.destino]));
const REVISION_INVALIDA = /fuera de banda|atipico|sin precio|ambigua|incoherente/;
const excluir = (motivo, f) => { (reporte.comprasExcluidas[motivo] ||= []).push(`${f.A} ${f.H}`); };
const compras = new Map();
const vistas = new Map();
for (const f of hoja(rec, 'BD_RECEPCIONES', 6).filter((x) => x.A && x.H)) {
  if (norm(f.AG) !== 'activa') { excluir('Línea REVERSADA', f); continue; }
  if (REVISION_INVALIDA.test(norm(f.AB))) { excluir('Revisión pendiente sobre el precio o la unidad', f); continue; }
  const destino = destinoCompra.get(norm(f.H));
  if (!destino || destino === 'EXCLUIR') { excluir(destino === 'EXCLUIR' ? 'Producto excluido en los cruces' : 'Producto sin cruce decidido', f); continue; }
  const g = genPorCodigo.get(destino);
  const cant = ent(f.O), valor = ent(f.Q), fecha = fechaExcel(f.C);
  if (!(cant > 0) || !(valor > 0) || !fecha) { excluir('Sin cantidad, valor o fecha', f); continue; }
  if (ub(f.I) !== g.unidad_base) { excluir('Unidad base de la compra distinta a la del genérico', f); continue; }
  const llave = `${fecha}|${destino}|${cant}|${valor}`;
  if (vistas.has(llave)) { reporte.duplicadas.push(`${f.A} repite ${vistas.get(llave)} (${f.H}, ${fecha}, ${cant} ${g.unidad_base}, $${valor})`); continue; }
  vistas.set(llave, f.A);
  (compras.get(destino) || compras.set(destino, []).get(destino)).push({ fecha, base: cant, valor });
}
const costosRef = [];
const fmtF = (s) => s.split('-').reverse().join('/');
for (const [codigoGen, cs] of compras) {
  const pus = cs.map((c) => c.valor / c.base);
  const orden = [...pus].sort((a, b) => a - b);
  const med = orden.length % 2 ? orden[(orden.length - 1) / 2] : (orden[orden.length / 2 - 1] + orden[orden.length / 2]) / 2;
  const quedan = cs.filter((c, i) => !((cs.length >= 3 && (pus[i] > med * 5 || pus[i] < med / 5)) || (cs.length === 2 && orden[1] / orden[0] > 5)));
  if (!quedan.length) continue;
  quedan.sort((a, b) => a.fecha.localeCompare(b.fecha));
  const desde = new Date(Date.parse(CORTE) - VENTANA_DIAS * 86400000).toISOString().slice(0, 10);
  const enVentana = quedan.filter((c) => c.fecha >= desde && c.fecha <= CORTE);
  const ult = quedan[quedan.length - 1];
  const cu = enVentana.length ? enVentana.reduce((s, c) => s + c.valor, 0) / enVentana.reduce((s, c) => s + c.base, 0) : ult.valor / ult.base;
  const fuente = enVentana.length ? `REC-COC: promedio ponderado del genérico, ${enVentana.length} compra(s) en ${VENTANA_DIAS} días`
                                  : `REC-COC: última compra del genérico (${fmtF(ult.fecha)}), fuera de la ventana de ${VENTANA_DIAS} días`;
  // la compra es del genérico: el costo por unidad base aplica a cada una de sus presentaciones
  for (const p of productosDe(codigoGen)) costosRef.push({ producto: p.id, cu: redondear(cu), n: enVentana.length || 1, ultima: ult.fecha, fuente });
}

const proveedores = hoja(rec, 'PROVEEDORES', 6).filter((f) => f.B && typeof f.A === 'number').map((f) => String(f.B).trim());

// =====================================================================================
// cruces_cocina.csv (se reescribe conservando las decisiones)
// =====================================================================================
const csv = ['recepcion;unidad_base;categoria;compras;estado;sugerencia_1;parecido_1;sugerencia_2;parecido_2;sugerencia_3;parecido_3;decision'];
for (const c of cruces.filter((x) => x.via !== 'nombre idéntico')) {
  const d = decisiones.get(norm(c.r.nombre))?.d || '';
  const estado = c.destino ? `migrado (${c.via})` : 'PENDIENTE';
  csv.push([c.r.nombre, c.r.base || '', c.r.categoria || '', c.r.compras, estado,
            ...c.sugerencias.flatMap((s) => [s.n, s.s.toFixed(2).replace('.', ',')]), d].map((v) => String(v).replace(/;/g, ',')).join(';'));
}
writeFileSync(RUTA_CRUCES, '﻿' + csv.join('\r\n') + '\r\n');

// =====================================================================================
// SQL
// =====================================================================================
const out = [];
const w = (s) => out.push(s);
const bloque = (titulo, filasSql, encabezado) => {
  if (!filasSql.length) return;
  w(`\n-- ${titulo} (${filasSql.length})`);
  for (let i = 0; i < filasSql.length; i += 200) w(`${encabezado} values\n  ${filasSql.slice(i, i + 200).join(',\n  ')}\non conflict do nothing;`);
};
w(`-- =====================================================================================
-- SGI Di Égida · Histórico de cocina migrado de INV-COC-001 y REG_REC_COC_003
-- Generado por scripts/migracion/extraer_cocina.mjs (corte de costos: ${CORTE}). NO editar a mano:
-- corregir scripts/migracion/cruces_cocina.csv o el extractor y volver a generar.
-- Idempotente. Ejecutar después de las migraciones y de historico_bar.sql:
--   psql "$DATABASE_URL" -1 -f supabase/datos/historico_cocina.sql
-- =====================================================================================`);
const cats = [...Object.values(CATEGORIA), ['COC_MPI', 'Producción propia de cocina', true]];
bloque('categorías', cats.map(([c, n, p]) => `(${lit(c)}, ${lit(n)}, 'COCINA', false, ${p})`),
  'insert into public.categorias (codigo, nombre, area, exige_sello, es_perecedero)');
bloque('ubicaciones (CAT_ZONAS)', zonas.map((z) => `(${lit(z.codigo)}, ${lit(z.nombre)}, 'COCINA', ${z.activo})`),
  'insert into public.ubicaciones (codigo, nombre, area, activo)');
bloque('proveedores', proveedores.map((p) => `(${lit(uuid('proveedor', norm(p)))}, ${lit(p)})`), 'insert into public.proveedores (id, nombre)');
const listaGen = [...gens.values()];
bloque('genéricos', listaGen.map((g) => `(${lit(uuid('generico', g.codigo))}, ${lit(g.codigo)}, ${lit(g.nombre)}, ${lit(g.tipo)}, ${lit(g.categoria ?? null)}, 'COCINA', ${lit(g.unidad_base)}, ${lit(g.conservacion ?? null)}, ${lit(g.tmax ?? null)}, ${g.activo === false ? 'false' : 'true'}, ${lit([...g.notas].join(' ') || null)})`),
  'insert into public.genericos (id, codigo, nombre, tipo, categoria, area, unidad_base, conservacion, temp_max_llegada, activo, nota)');
bloque('productos', productos.map((p) => `(${lit(p.id)}, ${lit(p.codigo)}, ${lit(uuid('generico', p.generico))}, ${lit(p.marca)}, ${lit(p.presentacion)}, ${lit(p.unidad_compra)}, ${lit(p.contenido)}, ${p.variable}, ${lit(p.minimo)}, ${p.activo}, ${lit(p.nota)})`),
  'insert into public.productos (id, codigo, generico_id, marca, presentacion, unidad_compra, contenido_base, contenido_variable, stock_minimo, activo, nota)');
bloque('ubicación de cada producto (CAT_UBICACION)', ubicaciones.map((u) => `(${lit(u.ubicacion)}, ${lit(u.producto)}, ${lit(u.orden)}, ${lit(u.minimo)}, ${u.activo})`),
  'insert into public.ubicacion_productos (ubicacion, producto_id, orden, minimo, activo)');
bloque('alias', [...alias.values()].map((a) => `(${lit(uuid('alias', `COCINA|${a.fuente}|${norm(a.alias)}`))}, ${lit(a.fuente)}, ${lit(a.alias)}, ${lit(uuid('generico', a.generico))}, ${lit(a.producto)})`),
  'insert into public.alias (id, fuente, alias, generico_id, producto_id)');
bloque(`costos de referencia (corte ${CORTE})`, costosRef.map((c) => `(${lit(c.producto)}, ${c.cu}, ${lit(c.fuente)}, ${lit(c.n)}, ${lit(c.ultima)}, ${lit(CORTE)})`),
  'insert into public.costos_referencia (producto_id, costo_unitario_base, fuente, n_compras, ultima_compra, calculado_en)');
w(`\nselect privado.bitacora('MIGRACIÓN HISTÓRICO COCINA', 'genericos', null, jsonb_build_object(
  'corte', ${lit(CORTE)}, 'genericos', ${listaGen.length}, 'productos', ${productos.length}, 'ubicaciones', ${zonas.length},
  'ubicacion_productos', ${ubicaciones.length}, 'costos_referencia', ${costosRef.length}, 'proveedores', ${proveedores.length}));`);
mkdirSync(join(raiz, 'supabase', 'datos'), { recursive: true });
writeFileSync(join(raiz, 'supabase', 'datos', 'historico_cocina.sql'), out.join('\n') + '\n');

// =====================================================================================
// REPORTE
// =====================================================================================
const r = [];
const sec = (t, lista, vacio = 'Nada.') => { r.push(`\n## ${t}\n`); r.push(lista.length ? lista.map((x) => `- ${x}`).join('\n') : vacio); };
const pend = cruces.filter((c) => !c.destino);
const porVia = (v) => cruces.filter((c) => c.via.startsWith(v)).length;
r.push(`# Migración del histórico de cocina\n\nGenerado por \`scripts/migracion/extraer_cocina.mjs\` · corte de costos **${CORTE}** · fuente: \`INV-COC-001\` y \`REG_REC_COC_003\`.`);
r.push(`\n## Qué entra\n
| Qué | Cantidad |
|---|---|
| Genéricos | ${listaGen.length} (MPe ${listaGen.filter((g) => g.tipo === 'MPe').length}, MPI ${listaGen.filter((g) => g.tipo === 'MPI').length}) |
| Productos | ${productos.length} (${productos.filter((p) => p.variable).length} con contenido variable, ${productos.filter((p) => !p.activo).length} inactivos) |
| Zonas (ubicaciones COC_*) | ${zonas.length} |
| Producto ↔ zona | ${ubicaciones.length} |
| Alias | ${alias.size} |
| Proveedores | ${proveedores.length} |
| Costos de referencia | ${costosRef.length} productos de ${compras.size} genéricos |
| Productos de recepción enlazados | ${porVia('nombre idéntico')} por nombre idéntico · ${porVia('decisión')} por decisión · **${pend.length} pendientes** |

**Fichas de MPi de cocina:** no se migraron. El archivo no está en \`referencia/\`.
**No entra al kardex:** ni las compras ni los conteos de agosto a octubre. El saldo nace con el conteo inicial.`);
sec(`Cruces pendientes (${pend.length}): decidir en scripts/migracion/cruces_cocina.csv`,
  pend.slice(0, 400).map((c) => `«${c.r.nombre}» (${c.r.compras} compra(s)) → ¿${c.sugerencias[0].n}? (${c.sugerencias[0].s.toFixed(2)})`));
sec(`Altas sin clasificar que no entraron (${reporte.sinClasificar.length})`, reporte.sinClasificar);
sec('Tipo por revisar (altas de cocina como MPi que parecen materia prima)', reporte.tipoDudoso);
sec('Genéricos con unidades mezcladas en INV-COC-001', reporte.unidadMezclada);
sec('Recepción con otra unidad base que el genérico', reporte.baseDistinta);
sec('Choques de categoría o cadena de frío, y decisiones no válidas', reporte.categoriaChoque);
sec('Compras repetidas', reporte.duplicadas);
r.push('\n## Compras excluidas del costo de referencia\n');
r.push(Object.entries(reporte.comprasExcluidas).map(([m, l]) => `- **${m}**: ${l.length}`).join('\n') || 'Ninguna.');
sec('Ubicaciones a zonas que no existen', reporte.ubicacionSinProducto);
r.push(`\nUbicaciones de productos que no entraron (sin clasificar): ${reporte.sinUbicar}.`);
writeFileSync(join(raiz, 'supabase', 'datos', 'REPORTE_MIGRACION_COCINA.md'), r.join('\n') + '\n');

console.log(`✔ cocina: ${listaGen.length} genéricos · ${productos.length} productos · ${zonas.length} zonas · ${ubicaciones.length} producto↔zona · ${costosRef.length} costos de referencia · ${alias.size} alias`);
console.log(`  recepción: ${porVia('nombre idéntico')} idénticos · ${porVia('decisión')} decididos · ${pend.length} pendientes · sin clasificar fuera: ${reporte.sinClasificar.length}`);
