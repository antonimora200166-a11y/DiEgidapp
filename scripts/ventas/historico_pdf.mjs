// =====================================================================================
// Ventas históricas de Odoo (PDF «Detalles de ventas», 01/01–06/11/2026) → supabase/datos/ventas_historicas_odoo.sql
//   node scripts/ventas/historico_pdf.mjs
// Lee el PDF con `pdftotext -table` (xpdf/poppler), suma las líneas y exige que cuadren con el total
// que trae Odoo. Además arma las equivalencias Odoo → carta con los nombres del TPV que ya usamos
// para los precios (precios_venta_bar.sql, bebidas_carta_bar.sql, platos_cocina.sql) y las
// decisiones de Anthony: propinas no son venta; «Producto gratuito» es promoción; menús Yuga =
// combos fijos (07/11); versiones «gs» y combos de alas/San Valentín no se tienen en cuenta.
// Lo que no se puede emparejar queda para decidirlo en la app (Consulta → Cargar ventas).
// =====================================================================================
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pdf = join(raiz, 'referencia', 'Detalles de ventas.pdf');
const datos = (f) => readFileSync(join(raiz, 'supabase', 'datos', f), 'utf8');

// ---------------------------------------------------------------- 1. leer el PDF
const txt = execFileSync('pdftotext', ['-table', '-enc', 'UTF-8', pdf, '-'], { encoding: 'utf8', maxBuffer: 64 << 20 }).replace(/​/g, '');
const L = txt.split(/\r?\n/);
const rango = /(\d{2})\/(\d{2})\/(\d{4})\s[\d:]+\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(txt);
if (!rango) throw new Error('No encontré el rango de fechas del reporte.');
const desde = `${rango[3]}-${rango[2]}-${rango[1]}`, hasta = `${rango[6]}-${rango[5]}-${rango[4]}`;
const ini = L.findIndex((l) => /^Ventas\s*$/.test(l.trim()));
const fin = L.findIndex((l, i) => i > ini && /^Total\s+[\d.]+\s+\$/.test(l.trim()));
const num = (s) => Number(s.replace(/\$/g, '').replace(/\./g, '').replace(',', '.'));
const [, totalQ, totalV] = /^Total\s+([\d.]+)\s+(\$[\d.,]+)/.exec(L[fin].trim());
const filas = [];
for (let i = ini + 1; i < fin; i++) {
  const t = L[i].trim(); if (!t) continue;
  const m = /^(.*?)\s{2,}(-?[\d.]+)\s+(\$-?[\d.,]+)$/.exec(t);
  if (m) { filas.push({ nombre: m[1].replace(/\s+/g, ' ').trim(), q: Number(m[2]), v: num(m[3]) }); continue; }
  const c = t.replace(/\s*Unidades\s*$/, '').trim();
  if (c && filas.length) filas[filas.length - 1].nombre += ' ' + c.replace(/\s+/g, ' ');
}
// categorías: la fila cuyo total y cantidad igualan la suma de las siguientes
const lineas = []; let i = 0;
while (i < filas.length) {
  const cat = filas[i]; let sq = 0, sv = 0, j = i + 1;
  while (j < filas.length && (Math.abs(sv - cat.v) > 0.05 || Math.abs(sq - cat.q) > 0.001)) { sq += filas[j].q; sv += filas[j].v; j++; }
  if (Math.abs(sv - cat.v) > 0.05) throw new Error(`La categoría ${cat.nombre} no cuadra.`);
  for (let k = i + 1; k < j; k++) {
    const m = /^\[([^\]]+)\]\s*(.*)$/.exec(filas[k].nombre);
    lineas.push({ categoria: cat.nombre, codigo: m ? m[1].trim() : '', nombre: (m ? m[2] : filas[k].nombre).trim(), q: filas[k].q, v: filas[k].v });
  }
  i = j;
}
const sq = lineas.reduce((t, l) => t + l.q, 0), sv = lineas.reduce((t, l) => t + l.v, 0);
if (Math.abs(sq - Number(totalQ)) > 0.001 || Math.abs(sv - num(totalV)) > 0.05) throw new Error(`No cuadra: ${sq} und / ${sv} contra ${totalQ} / ${totalV}`);

// ---------------------------------------------------------------- 2. equivalencias
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const porNombre = new Map();   // nombre del TPV → código de la carta
for (const m of datos('precios_venta_bar.sql').matchAll(/\('(BAR_BEB_[A-Z0-9]+)',\s*\d+,\s*'TPV · ((?:[^']|'')+)'\)/g)) porNombre.set(norm(m[2].replace(/''/g, "'")), m[1]);
for (const m of datos('bebidas_carta_bar.sql').matchAll(/\('(BAR_BEB_[A-Z0-9]+)',\s*'(?:[^']|'')+',\s*'[^']+',\s*'[A-Z]+',\s*'((?:[^']|'')+)'/g)) porNombre.set(norm(m[2].replace(/''/g, "'")), m[1]);
for (const m of datos('platos_cocina.sql').matchAll(/\('(COC_PLA_[A-Z0-9_]+)',\s*'(?:[^']|'')+',\s*'[A-Z]+',\s*'((?:[^']|'')+)'/g)) porNombre.set(norm(m[2].replace(/''/g, "'")), m[1]);
// nombres que el TPV escribe distinto
const ALIAS = { 'cocteleria de autor skarlet kiss': 'BAR_BEB_C35', 'cocteleria de autor scarlet kiss': 'BAR_BEB_C35' };
for (const [k, v] of Object.entries(ALIAS)) porNombre.set(k, v);
const YUGA = {
  'dwapara yuga': ['COC_PLA_1_009', 'COC_PLA_2_017', 'BAR_BEB_C16'],
  'kali yuga': ['BAR_BEB_C18', 'COC_PLA_2_001'],
  'satya yuga': ['COC_PLA_1_004', 'BAR_BEB_C17', 'COC_PLA_2_017', 'COC_PLA_3_005', 'BAR_BEB_C35'],
  'tetra yuga': ['BAR_BEB_C16', 'COC_PLA_2_012', 'COC_PLA_3_005', 'BAR_BEB_C23C'],
};
const equiv = new Map();   // clave lógica (codigo|nombre) → {codigo, nombre, tipo, partes, nota}
for (const l of lineas) {
  const k = l.codigo || 'N:' + l.nombre;
  if (equiv.has(k)) continue;
  const n = norm(l.nombre);
  const yuga = Object.keys(YUGA).find((y) => n.startsWith(y));
  let e = null;
  if (l.codigo === 'TIPS') e = { tipo: 'PROPINA', partes: [], nota: 'Propina: no es venta.' };
  else if (n.startsWith('producto gratuito')) e = { tipo: 'PROMOCION', partes: [], nota: 'Promoción (2x1): resta venta y no suma consumo.' };
  else if (yuga) e = { tipo: 'COMBO', partes: YUGA[yuga], nota: 'Menú Yuga: combo fijo (decisión de Anthony, 07/11/2026).' };
  else if (/ gs$/.test(n)) e = { tipo: 'IGNORAR', partes: [], nota: 'Versión «gs»: no se tiene en cuenta (decisión de Anthony, 07/11/2026).' };
  else if (/alas de pollo|san valentin/.test(n)) e = { tipo: 'IGNORAR', partes: [], nota: 'Combo que no se tiene en cuenta (decisión de Anthony, 07/11/2026).' };
  else if (porNombre.has(n)) e = { tipo: 'PRODUCTO', partes: [porNombre.get(n)], nota: 'Por el nombre del TPV.' };
  if (e) equiv.set(k, { codigo: l.codigo, nombre: l.nombre, ...e });
}

// ---------------------------------------------------------------- 3. SQL
const q = (s) => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const huella = createHash('sha256').update(readFileSync(pdf)).digest('hex');
const sinEq = [...new Set(lineas.filter((l) => !equiv.has(l.codigo || 'N:' + l.nombre)).map((l) => (l.codigo ? `[${l.codigo}] ` : '') + l.nombre))];
const out = [];
out.push(`-- =====================================================================================
-- SGI Di Égida · Ventas históricas de Odoo y equivalencias Odoo → carta
-- Generado con scripts/ventas/historico_pdf.mjs desde referencia/Detalles de ventas.pdf
-- (entregado por Anthony el 06/11/2026). Rango ${desde} → ${hasta}, sin día por línea.
-- ${lineas.length} líneas · ${sq} unidades · $${sv.toFixed(2)} sin impuesto: cuadra con el total del reporte.
-- Los reembolsos del reporte no se cargan (sección aparte del PDF).
-- ${equiv.size} equivalencias; ${sinEq.length} productos de Odoo quedan para decidir en la app.
-- Idempotente: la carga no se repite (huella del archivo) y no pisa equivalencias ya decididas.
-- =====================================================================================

insert into public.ventas_cargas (formato, archivo, huella, desde, hasta, por_dia, lineas, unidades, total_odoo, neto_estimado, cargado_por, nota)
select 'DETALLE_PDF', 'Detalles de ventas.pdf', ${q(huella)}, '${desde}', '${hasta}', false, ${lineas.length}, ${sq}, ${sv.toFixed(2)}, false, null,
       'Histórico: reporte de Odoo del ${desde} al ${hasta}, sin día por línea.'
 where not exists (select 1 from public.ventas_cargas where huella = ${q(huella)});

insert into public.ventas_lineas (carga_id, fecha, categoria, codigo_odoo, nombre_odoo, clave, cantidad, valor_neto)
select c.id, null, x.categoria, nullif(x.codigo, ''), x.nombre, privado.clave_odoo(x.codigo, x.nombre), x.cantidad, x.valor
  from public.ventas_cargas c
  cross join (values`);
out.push(lineas.map((l) => `    (${q(l.categoria)}, ${q(l.codigo)}, ${q(l.nombre)}, ${l.q}, ${l.v.toFixed(2)})`).join(',\n'));
out.push(`  ) as x (categoria, codigo, nombre, cantidad, valor)
 where c.huella = ${q(huella)}
   and not exists (select 1 from public.ventas_lineas vl where vl.carga_id = c.id);

insert into public.equivalencias_odoo (clave, nombre_odoo, tipo, nota, decidido_por)
select privado.clave_odoo(x.codigo, x.nombre), x.nombre, x.tipo, x.nota, null
  from (values`);
const eqs = [...equiv.values()];
out.push(eqs.map((e) => `    (${q(e.codigo)}, ${q(e.nombre)}, ${q(e.tipo)}, ${q(e.nota)})`).join(',\n'));
out.push(`  ) as x (codigo, nombre, tipo, nota)
on conflict (clave) do nothing;

insert into public.equivalencia_partes (clave, generico_id, cantidad)
select privado.clave_odoo(x.codigo, x.nombre), g.id, 1
  from (values`);
out.push(eqs.flatMap((e) => e.partes.map((p) => `    (${q(e.codigo)}, ${q(e.nombre)}, ${q(p)})`)).join(',\n'));
out.push(`  ) as x (codigo, nombre, generico)
  join public.genericos g on g.codigo = x.generico
 where not exists (select 1 from public.equivalencia_partes ep where ep.clave = privado.clave_odoo(x.codigo, x.nombre))
on conflict do nothing;
`);
writeFileSync(join(raiz, 'supabase', 'datos', 'ventas_historicas_odoo.sql'), out.join('\n'));
console.log(`${lineas.length} líneas, ${sq} und, $${sv.toFixed(2)}; ${equiv.size} equivalencias; sin equivalencia (${sinEq.length}):`);
for (const s of sinEq) console.log('  · ' + s);
