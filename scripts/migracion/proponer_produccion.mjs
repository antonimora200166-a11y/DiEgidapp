// =====================================================================================
// Propuestas de almacenamiento de los MPI de cocina desde el registro de producción.
//   node scripts/migracion/proponer_produccion.mjs <mpi_cocina.json>
// Lee referencia/REG-COC-007-Plantilla-Produccion-v1.0.xlsx (hojas REGISTRO*: un lote por fila)
// y la exportación de los MPI de cocina, y escribe
//   supabase/datos/propuestas_produccion.sql   — propuestas para /catalogo/unidades (fuente
//       REGISTRO-PRODUCCION): presentación por porción, contenido, conservación y vida útil;
//   supabase/datos/REPORTE_PRODUCCION_COCINA.md — qué dijo el registro de cada MPI y qué
//       procesos no tienen MPI en el catálogo.
// El cruce proceso → MPI está en mapeo_produccion.mjs. No escribe datos de personas.
// =====================================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerXlsx } from './xlsx.mjs';
import { lit, norm, uuid } from './comun.mjs';
import { CRUCE, NUEVOS } from './mapeo_produccion.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ARCHIVO = 'REG-COC-007-Plantilla-Produccion-v1.0.xlsx';
const libro = leerXlsx(join(raiz, 'referencia', ARCHIVO));
const mpis = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const mediana = (a) => { const s = a.filter((x) => x !== null).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const moda = (a) => { const c = {}; for (const x of a) if (x) c[x] = (c[x] || 0) + 1; return Object.entries(c).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null; };
const redondo = (x) => (x >= 20 ? Math.round(x / 5) * 5 : Math.round(x * 10) / 10);
const fmt = (x) => (x === null ? '—' : Number(x).toLocaleString('es-CO', { maximumFractionDigits: 1 }));

// ---------------------------------------------------------------- lotes (sin repetir el mismo Lote ID entre hojas)
const lotes = [];
const vistos = new Set();
for (const h of Object.keys(libro).filter((x) => x.startsWith('REGISTRO'))) {
  for (const f of libro[h]) {
    if (!/^COC-/.test(String(f.A ?? '')) || vistos.has(f.A)) continue;
    vistos.add(f.A);
    const neto = num(f.M), und = num(f.O);
    lotes.push({ id: f.A, proceso: String(f.D ?? '').trim(), neto, und, porUnd: num(f.P) ?? (neto && und ? neto / und : null),
                 empaque: f.Q ? String(f.Q) : null, vida: num(f.R), temp: f.T ? String(f.T) : null,
                 ini: num(f.J), merma: num(f.K) });
  }
}

// ---------------------------------------------------------------- agrupado por MPI del catálogo
const porMpi = new Map();
const sinCruce = new Map();
for (const l of lotes) {
  const k = norm(l.proceso);
  const c = CRUCE[k];
  if (!c) { (sinCruce.get(k) || sinCruce.set(k, { nombre: l.proceso, lotes: [] }).get(k)).lotes.push(l); continue; }
  (porMpi.get(c.mpi) || porMpi.set(c.mpi, { c, procesos: new Set(), lotes: [] }).get(c.mpi)).lotes.push(l);
  porMpi.get(c.mpi).procesos.add(l.proceso);
}
const conservacionDe = (t) => (!t ? null : /congel/i.test(t) ? 'Congelado' : /refrig/i.test(t) ? 'Refrigerado' : /ambiente/i.test(t) ? 'Ambiente' : null);

const propuestas = [];
const reporte = [];
for (const [nombre, g] of porMpi) {
  const prods = mpis.filter((p) => p.nombre === nombre);
  const ls = g.lotes;
  const porciones = ls.map((l) => l.porUnd).filter((x) => x !== null && x > 0);
  const med = mediana(porciones);
  const min = porciones.length ? Math.min(...porciones) : null, max = porciones.length ? Math.max(...porciones) : null;
  const estable = med !== null && min / med >= 0.8 && max / med <= 1.25;
  const cons = conservacionDe(moda(ls.map((l) => l.temp)));
  const vida = mediana(ls.map((l) => l.vida));
  const empaque = moda(ls.map((l) => l.empaque));
  const resumen = `${ls.length} lote(s) en el registro${med !== null ? `; ${fmt(med)} g por porción (${fmt(min)}–${fmt(max)})` : ''}; neto típico ${fmt(mediana(ls.map((l) => l.neto)))} g${empaque ? `; ${empaque.toLowerCase()}` : ''}${cons ? `; ${cons.toLowerCase()}` : ''}${vida ? `, ${vida} días` : ''}`;
  reporte.push({ nombre, procesos: [...g.procesos], resumen, como: g.c.como, productos: prods.length });
  if (!prods.length) continue;
  // un solo producto: se le propone todo; varios (p. ej. Paquete 20 g y 40 g): solo almacenamiento
  for (const p of prods) {
    const cambios = {};
    const razones = [];
    let seg = ls.length >= 3 && (estable || g.c.como === 'queda' || g.c.como === 'granel') ? 'ALTA' : ls.length >= 2 ? 'MEDIA' : 'BAJA';
    if (p.kardex || p.ficha) continue;   // lo que ya tiene historia no cambia de unidad ni presentación
    const solo = prods.length === 1;
    const peso = g.c.porcion ?? (med !== null ? redondo(med) : null);
    if (solo && (g.c.como === 'porcion' || g.c.como === 'unidad') && peso) {
      const ub = p.ub === 'und' ? 'g' : p.ub;
      if (ub !== p.ub) cambios.unidad_base = ub;
      const pres = `${g.c.como === 'unidad' ? 'Unidad' : 'Porción'} ${peso} ${ub}`;
      if (pres !== p.presentacion) cambios.presentacion = pres;
      const uc = g.c.como === 'unidad' ? 'UND' : 'PORC';
      if (uc !== p.uc) cambios.unidad_compra = uc;
      if (p.var || Number(p.cont) !== peso || cambios.unidad_base) { cambios.contenido_base = peso; cambios.contenido_variable = false; }
      razones.push(`se empaca en ${g.c.como === 'unidad' ? 'unidades' : 'porciones'} de unos ${peso} ${ub}`);
      if (!estable && !g.c.porcion) seg = 'BAJA';
    } else if (solo && g.c.como === 'granel') {
      const ub = p.ub === 'und' ? 'g' : p.ub;
      if (ub !== p.ub) cambios.unidad_base = ub;
      const uc = ub === 'ml' ? 'ML' : 'GR';
      if (p.uc !== uc || p.var || Number(p.cont) !== 1) { cambios.unidad_compra = uc; cambios.contenido_base = 1; cambios.contenido_variable = false; }
      if (p.presentacion !== 'Granel') cambios.presentacion = 'Granel';
      razones.push(`se guarda a granel: se lleva en ${ub} sueltos`);
    }
    if (cons && cons !== p.cons) { cambios.conservacion = cons; razones.push(`se guarda ${cons.toLowerCase()}`); }
    if (vida && vida !== p.vida) { cambios.vida_util_dias = Math.round(vida); razones.push(`vida útil ${Math.round(vida)} días`); }
    if (!Object.keys(cambios).length) continue;
    propuestas.push({ p, cambios, seg, razon: `${razones.join('; ')} (${resumen})`, actual: {
      unidad_base: p.ub, unidad_compra: p.uc, contenido_base: p.var ? null : Number(p.cont), contenido_variable: p.var,
      categoria: p.cat, presentacion: p.presentacion, conservacion: p.cons, vida_util_dias: p.vida } });
  }
}

// ---------------------------------------------------------------- SQL
const filas = propuestas.map(({ p, cambios, seg, razon, actual }) =>
  `(${lit(uuid('propuesta_produccion', p.id))}, ${lit(p.id)}, ${lit(JSON.stringify(cambios))}::jsonb, ${lit(JSON.stringify(actual))}::jsonb, ${lit(seg)}, ${lit(razon)}, 'REGISTRO-PRODUCCION')`);
const ids = propuestas.map(({ p }) => lit(p.id)).join(', ');
const sql = [`-- =====================================================================================
-- SGI Di Égida · Propuestas de almacenamiento de MPI desde el registro de producción de cocina
-- Generado por scripts/migracion/proponer_produccion.mjs desde referencia/${ARCHIVO}
-- (${lotes.length} lotes). NO editar a mano. Solo propuestas: se aceptan en /catalogo/unidades.
-- Idempotente: al volver a cargarlo actualiza solo las pendientes.
-- =====================================================================================`];
for (let i = 0; i < filas.length; i += 200) {
  sql.push(`\ninsert into public.propuestas_unidad (id, producto_id, cambios, actual, seguridad, razon, fuente) values\n  ${filas.slice(i, i + 200).join(',\n  ')}\non conflict (id) do update set cambios = excluded.cambios, actual = excluded.actual, seguridad = excluded.seguridad, razon = excluded.razon\n  where public.propuestas_unidad.estado = 'PENDIENTE' and public.propuestas_unidad.cambios is distinct from excluded.cambios;`);
}
if (propuestas.length) {
  sql.push(`\n-- la propuesta de unidad que aún esté pendiente para estos productos queda reemplazada por esta
update public.propuestas_unidad set estado = 'REEMPLAZADA', mensaje = 'Reemplazada por la propuesta del registro de producción.'
 where fuente = 'CLAUDE' and estado = 'PENDIENTE' and producto_id in (${ids});`);
}
writeFileSync(join(raiz, 'supabase', 'datos', 'propuestas_produccion.sql'), sql.join('\n') + '\n');

// ---------------------------------------------------------------- reporte
const r = [`# Registro de producción de cocina → almacenamiento de los MPI`, '',
  `Generado por \`scripts/migracion/proponer_produccion.mjs\` desde \`referencia/${ARCHIVO}\`: **${lotes.length} lotes**, ` +
  `${porMpi.size} MPI del catálogo con registro, **${propuestas.length} propuestas** para *Revisar unidades*.`, '',
  '## Lo que dice el registro de cada MPI', '', '| MPI | Cómo se guarda | Lo que dice el registro | Nombres en el registro |', '|---|---|---|---|',
  ...reporte.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map((x) =>
    `| ${x.nombre} | ${{ porcion: 'por porción', unidad: 'por unidad (con peso)', granel: 'a granel', queda: 'como está' }[x.como]}${x.productos > 1 ? ` (${x.productos} presentaciones)` : ''} | ${x.resumen} | ${x.procesos.join(', ')} |`),
  '', '## Procesos del registro sin MPI en el catálogo', '',
  'Se producen pero no existen como MPI: para llevarlos en el kardex hay que crearlos (Crear producto, tipo MPI).', '',
  ...[...sinCruce.values()].sort((a, b) => b.lotes.length - a.lotes.length).map((x) => {
    const med = mediana(x.lotes.map((l) => l.porUnd));
    return `- **${x.nombre}** — ${x.lotes.length} lote(s)${med ? `, ${fmt(med)} g por porción` : ''}${NUEVOS.includes(norm(x.nombre)) ? '' : ' *(sin revisar)*'}`;
  })];
writeFileSync(join(raiz, 'supabase', 'datos', 'REPORTE_PRODUCCION_COCINA.md'), r.join('\n') + '\n');
const cuenta = (f) => propuestas.filter(f).length;
console.log(`✔ ${lotes.length} lotes · ${porMpi.size} MPI con registro · ${propuestas.length} propuestas (ALTA ${cuenta((x) => x.seg === 'ALTA')} · MEDIA ${cuenta((x) => x.seg === 'MEDIA')} · BAJA ${cuenta((x) => x.seg === 'BAJA')}) · ${sinCruce.size} procesos sin MPI`);
if (process.argv.includes('--ver')) for (const x of propuestas) console.log(`${x.seg}|${x.p.nombre}|${x.p.presentacion}|${JSON.stringify(x.cambios)}`);
