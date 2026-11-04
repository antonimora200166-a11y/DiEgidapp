// =====================================================================================
// Rescate de precios de cocina (Anthony, 04/11/2026).
//   node scripts/migracion/rescatar_precios.mjs
// La primera migración (extraer_cocina.mjs, 22/10) solo cargó 54 de las 265 compras con precio
// de REG_REC_COC_003: el resto tenía el nombre sin enlazar al catálogo o una «revisión
// pendiente» del Sheet. Con el catálogo ya unificado y los pares decididos, este script:
//   1. lee BD_RECEPCIONES (líneas ACTIVAS con cantidad, valor y fecha);
//   2. enlaza cada nombre con el catálogo ACTUAL de la base (solo lectura): alias de recepción,
//      nombre del genérico o cualquier alias que apunte a un solo genérico de cocina;
//   3. pasa la cantidad a la unidad base del genérico (conversión registrada, o el contenido de
//      su única presentación si la factura viene por unidad);
//   4. marca no computable lo que no se puede creer: costo por g/ml/und fuera de rango, o más
//      de 3 veces lejos de la mediana del genérico; las demás «revisiones» del Sheet se
//      revisan con estas reglas en vez de descartarse;
// y escribe supabase/datos/compras_rescatadas_cocina.sql (idempotente: las líneas ya cargadas
// no cambian) y supabase/datos/REPORTE_RESCATE_PRECIOS.md con lo que no entró.
// El costo de referencia se recalcula en la base al cargar (bloque final del SQL).
// =====================================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { leerXlsx, fechaExcel } from './xlsx.mjs';
import { ent, lit, redondear, uuid } from './comun.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const normaliza = (s) => String(s ?? '').toLowerCase()
  .replace(/[áéíóúüñàèìòù]/g, (c) => 'aeiouunaeiou'['áéíóúüñàèìòù'.indexOf(c)]).replace(/\s+/g, ' ').trim();  // = privado.normalizar
const ub = (u) => { const x = normaliza(u); return x === 'un' || x === 'und' ? 'und' : x === 'ml' ? 'ml' : x === 'g' ? 'g' : null; };
const RANGO = { g: [0.5, 400], ml: [0.5, 600], und: [20, 1000000] };
const SHEET_DESCARTA = /sin precio|ambigua|incoherente/;   // «fuera de banda» y «atípico» se revisan aquí

// ---------------------------------------------------------------- catálogo actual (solo lectura)
const envLocal = join(raiz, 'web', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envLocal)) {
  const m = /^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m.exec(readFileSync(envLocal, 'utf8'));
  if (m) process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, '');
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await db.query('begin read only');
const { rows: gens } = await db.query(`select id, codigo, nombre, nombre_norm, unidad_base::text ub from public.genericos
                                        where area = 'COCINA' and activo and tipo = 'MPe'`);
const { rows: alias } = await db.query(`select al.alias_norm, al.fuente, al.generico_id from public.alias al
                                          join public.genericos g on g.id = al.generico_id
                                         where g.area = 'COCINA' and g.activo and g.tipo = 'MPe'`);
const { rows: prods } = await db.query(`select p.id, p.generico_id, p.contenido_base::float c, p.contenido_variable v from public.productos p
                                          join public.genericos g on g.id = p.generico_id where g.area = 'COCINA' and p.activo`);
const { rows: convs } = await db.query(`select generico_id, unidad, factor_a_base::float f from public.conversiones`);
const { rows: ya } = await db.query(`select id_origen from public.compras_historicas where origen = 'REC-COC'`);
const gPorId = new Map(gens.map((g) => [g.id, g]));
const gPorNombre = new Map(gens.map((g) => [g.nombre_norm, g]));
const aliasRec = new Map(), aliasOtros = new Map();
for (const a of alias) {
  const m = a.fuente === 'RECEPCION' ? aliasRec : aliasOtros;
  (m.get(a.alias_norm) || m.set(a.alias_norm, new Set()).get(a.alias_norm)).add(a.generico_id);
}
const unico = (s) => (s && s.size === 1 ? gPorId.get([...s][0]) : null);
function resolver(nombre) {
  const n = normaliza(nombre);
  return unico(aliasRec.get(n)) || gPorNombre.get(n) || unico(aliasOtros.get(n)) || null;
}
const yaCargadas = new Set(ya.map((r) => r.id_origen));

// ---------------------------------------------------------------- líneas del libro mayor
const libro = leerXlsx(join(raiz, 'referencia', 'REG_REC_COC_003.xlsx'));
const lineas = libro.BD_RECEPCIONES.filter((f) => f._fila >= 6 && f.A && f.H && normaliza(f.AG) === 'activa');
const rep = { leidas: lineas.length, sinPrecio: 0, yaEstaban: 0, sinEnlace: new Map(), unidad: new Map(), convertidas: [], nuevas: [] };
const filas = [];
for (const f of lineas) {
  const cant = ent(f.O) ?? ent(f.M), valor = ent(f.Q), fecha = fechaExcel(f.C);
  if (!(cant > 0) || !(valor > 0) || !fecha) { rep.sinPrecio++; continue; }
  if (yaCargadas.has(String(f.A))) { rep.yaEstaban++; continue; }
  const g = resolver(f.H);
  if (!g) { const k = String(f.H).trim(); rep.sinEnlace.set(k, (rep.sinEnlace.get(k) || 0) + valor); continue; }
  let base = cant;
  const u = ub(f.I);
  if (u !== g.ub) {
    const conv = convs.find((c) => c.generico_id === g.id && c.unidad === u);
    const unicos = prods.filter((p) => p.generico_id === g.id && !p.v && p.c > 0);
    // «und» en la factura: o son unidades de su única presentación, o la cantidad ya venía en g/ml
    // (error común del Sheet: «Pulpo 2000 und»). Se queda la lectura que da un costo creíble.
    const [min, max] = RANGO[g.ub];
    const lecturas = u !== 'und' ? [] : [...new Set([cant, ...(unicos.length === 1 ? [cant * unicos[0].c] : [])])]
      .filter((b) => valor / b >= min && valor / b <= max);
    if (conv) base = cant * conv.f;
    else if (lecturas.length === 1) {
      base = lecturas[0];
      rep.convertidas.push(`${f.H} (${fecha}): ${cant} und → ${base} ${g.ub} ($${redondear(valor / base, 2)} por ${g.ub}) → ${g.nombre}`);
    } else {
      const k = `${String(f.H).trim()} → ${g.nombre}: la factura viene en ${u ?? f.I} y el genérico va en ${g.ub}`;
      rep.unidad.set(k, (rep.unidad.get(k) || 0) + 1); continue;
    }
  }
  const lista = prods.filter((p) => p.generico_id === g.id);
  const revision = String(f.AB || '').trim();
  filas.push({ id: String(f.A), fecha, prov: f.D, doc: f.F, nombre: f.H, g, producto: lista.length === 1 ? lista[0].id : null,
               base, valor, cu: valor / base, motivo: SHEET_DESCARTA.test(normaliza(revision)) ? `Revisión del Sheet: ${revision}` : null,
               revision });
}

// ---------------------------------------------------------------- qué precios se creen
// contra todas las compras del genérico (también las ya cargadas que cuentan)
const { rows: previas } = await db.query(`select generico_id, costo_unitario_base::float cu from public.compras_historicas
                                            where origen = 'REC-COC' and computable`);
await db.query('rollback');
await db.end();
const porGen = new Map();
for (const p of previas) (porGen.get(p.generico_id) || porGen.set(p.generico_id, []).get(p.generico_id)).push(p.cu);
for (const h of filas) {
  if (h.motivo) continue;
  const [min, max] = RANGO[h.g.ub];
  if (h.cu < min || h.cu > max) h.motivo = `Costo por ${h.g.ub} fuera de rango ($${redondear(h.cu, 2)}): revisar unidad o contenido`;
  else (porGen.get(h.g.id) || porGen.set(h.g.id, []).get(h.g.id)).push(h.cu);
}
const mediana = (xs) => { const o = [...xs].sort((a, b) => a - b); const m = o.length >> 1; return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2; };
for (const h of filas) {
  if (h.motivo) continue;
  const xs = porGen.get(h.g.id);
  if (xs.length >= 3) {
    const med = mediana(xs);
    if (h.cu > med * 3 || h.cu < med / 3) h.motivo = `Precio contradictorio con las demás compras del genérico (mediana $${redondear(med, 2)} por ${h.g.ub})`;
  } else if (xs.length === 2 && Math.max(...xs) / Math.min(...xs) > 3) {
    h.motivo = 'Dos compras con precios que no cuadran entre sí (más de 3 veces): revisar cuál es la buena';
  }
}

// ---------------------------------------------------------------- SQL
const valores = filas.map((h) => `(${lit(uuid('compra_historica', `REC-COC|${h.id}`))}, 'REC-COC', ${lit(h.id)}, ${lit(h.fecha)}, `
  + `${lit(h.prov ? String(h.prov).trim() : null)}, ${lit(h.doc ? String(h.doc).trim() : null)}, ${lit(String(h.nombre).trim())}, `
  + `${lit(h.g.id)}, ${lit(h.producto)}, ${redondear(h.base, 4)}, ${h.valor}, ${!h.motivo}, ${lit(h.motivo)})`);
const out = [`-- =====================================================================================
-- SGI Di Égida · Rescate de precios de cocina (REG_REC_COC_003 → compras_historicas)
-- Generado por scripts/migracion/rescatar_precios.mjs el ${new Date().toISOString().slice(0, 10)}. NO editar a mano.
-- Las líneas que ya estaban cargadas no cambian (on conflict do nothing). Idempotente.
-- Al final recalcula costos_referencia de los productos sin kardex con las compras que cuentan.
-- =====================================================================================`];
for (let i = 0; i < valores.length; i += 200) {
  out.push(`\ninsert into public.compras_historicas (id, origen, id_origen, fecha, proveedor, documento, nombre_factura, generico_id, producto_id, cantidad_base, valor_total, computable, motivo_exclusion) values\n  ${valores.slice(i, i + 200).join(',\n  ')}\non conflict do nothing;`);
}
out.push(`
-- ---------------------------------------------------------------- costo de referencia
-- Por producto activo (bar y cocina) sin movimientos en el kardex: promedio ponderado de las
-- compras que cuentan en los 120 días antes de la última, del producto si las tiene propias y
-- si no de su genérico. No toca los costos medidos a mano (fuente que no empieza por «REC-»)
-- ni fija un costo fuera de rango (los mismos rangos de la hoja de verificación).
with compras as (
  select p.id as producto_id, ch.fecha, ch.valor_total, ch.cantidad_base, ch.origen, g.unidad_base::text as ub
    from public.productos p
    join public.genericos g on g.id = p.generico_id
    join public.compras_historicas ch on ch.computable and ch.generico_id = p.generico_id
         and (ch.producto_id = p.id
              or (ch.producto_id is null and not exists (select 1 from public.compras_historicas x
                                                          where x.computable and x.producto_id = p.id)))
   where p.activo and not exists (select 1 from public.movimientos m where m.producto_id = p.id)
),
ventana as (
  select c.*, max(c.fecha) over (partition by c.producto_id) as ultima from compras c
),
calculo as (
  select producto_id, ub, sum(valor_total) / sum(cantidad_base) as cu, count(*)::int as n, max(fecha) as ultima,
         min(origen) as origen
    from ventana where fecha >= ultima - 120 group by producto_id, ub
)
insert into public.costos_referencia (producto_id, costo_unitario_base, fuente, n_compras, ultima_compra, calculado_en)
select producto_id, round(cu, 6), origen || ': promedio ponderado, ' || n || ' compra(s) en los 120 días hasta ' || to_char(ultima, 'DD/MM/YYYY'),
       n, ultima, current_date
  from calculo
 -- un costo absurdo (unidad mal puesta) no se fija: queda la alerta en la hoja de verificación
 where case ub when 'g' then cu between 0.5 and 400 when 'ml' then cu between 0.5 and 600 else cu between 20 and 1000000 end
on conflict (producto_id) do update
   set costo_unitario_base = excluded.costo_unitario_base, fuente = excluded.fuente, n_compras = excluded.n_compras,
       ultima_compra = excluded.ultima_compra, calculado_en = excluded.calculado_en
 where public.costos_referencia.fuente like 'REC-%';

select privado.bitacora('RESCATE DE PRECIOS DE COCINA', 'compras_historicas', 'REC-COC', jsonb_build_object(
  'lineas', ${filas.length}, 'computables', ${filas.filter((h) => !h.motivo).length}));
`);
writeFileSync(join(raiz, 'supabase', 'datos', 'compras_rescatadas_cocina.sql'), out.join('\n'));

// ---------------------------------------------------------------- reporte
const pesos = (n) => `$${Math.round(n).toLocaleString('es-CO')}`;
const cuentan = filas.filter((h) => !h.motivo);
const r = [`# Rescate de precios de cocina

Generado por \`scripts/migracion/rescatar_precios.mjs\` · ${new Date().toISOString().slice(0, 10)} · fuente: \`REG_REC_COC_003\` (BD_RECEPCIONES) enlazado con el catálogo actual de la base.

| Qué | Líneas |
|---|---|
| Líneas activas leídas | ${rep.leidas} |
| Sin cantidad, valor o fecha (no se puede recuperar) | ${rep.sinPrecio} |
| Ya estaban cargadas | ${rep.yaEstaban} |
| **Rescatadas** | **${filas.length}** (${cuentan.length} cuentan para el costo, ${filas.length - cuentan.length} quedan como no computables) |
| Nombre sin enlace al catálogo | ${[...rep.sinEnlace.values()].length} nombre(s) |
| Unidad que no se pudo pasar a la del genérico | ${[...rep.unidad.values()].reduce((s, n) => s + n, 0)} |

Genéricos de cocina que ganan precio: **${new Set(cuentan.map((h) => h.g.id)).size}**.
`];
const sec = (t, xs) => { r.push(`\n## ${t}\n`); r.push(xs.length ? xs.map((x) => `- ${x}`).join('\n') : 'Nada.'); };
sec('Nombres de factura sin enlace (de mayor a menor valor comprado) — crear o enlazar en el catálogo',
    [...rep.sinEnlace].sort((a, b) => b[1] - a[1]).map(([n, v]) => `«${n}» · ${pesos(v)}`));
sec('Unidad distinta — falta una conversión del genérico', [...rep.unidad].map(([k, n]) => `${k} (${n} línea(s))`));
sec('Pasadas a la unidad base con el contenido de su única presentación — revisar', rep.convertidas);
sec('Rescatadas pero no computables — revisar en la hoja de verificación',
    filas.filter((h) => h.motivo).map((h) => `${h.fecha} · «${h.nombre}» → ${h.g.nombre}: ${pesos(h.valor)} por ${redondear(h.base, 2)} ${h.g.ub} · ${h.motivo}`));
writeFileSync(join(raiz, 'supabase', 'datos', 'REPORTE_RESCATE_PRECIOS.md'), r.join('\n') + '\n');
console.log(`Rescatadas ${filas.length} (${cuentan.length} computables) · ${new Set(cuentan.map((h) => h.g.id)).size} genéricos con precio · `
  + `${rep.sinEnlace.size} nombres sin enlace · ${[...rep.unidad.values()].reduce((s, n) => s + n, 0)} por unidad · ya estaban ${rep.yaEstaban} · sin precio ${rep.sinPrecio}`);
