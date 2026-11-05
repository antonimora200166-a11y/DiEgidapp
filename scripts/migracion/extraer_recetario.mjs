// =====================================================================================
// Recetario de cocina (referencia/egida-datos-recetas*.json) → supabase/datos/recetario_cocina.sql
//   node scripts/migracion/extraer_recetario.mjs
// Carga cada receta y cada ingrediente TAL CUAL vienen, más una PROPUESTA de ficha armada solo con
// lo que ya está escrito en el recetario:
//   · pasos: el procedimiento partido en renglones, sin la numeración «1.1»;
//   · puntos críticos sugeridos: los «PUNTO CRÍTICO:» escritos y los pasos que hablan de higiene,
//     temperatura, frío, tiempos o punto de textura (el texto es el del paso, no se inventa nada);
//   · alérgenos: los declarados en la receta y los que sugieren los nombres de sus ingredientes;
//   · método: la técnica que nombran los pasos (reducir, confitar, hornear…).
// Nada de esto es una ficha: el chef revisa cada propuesta en la app y la aprueba.
// Idempotente: volver a correrlo actualiza lo crudo y la propuesta, nunca las decisiones.
// =====================================================================================
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FUENTE = 'RECETARIO COCINA';
const archivo = readdirSync(join(raiz, 'referencia')).filter((f) => /^egida-datos-recetas.*\.json$/i.test(f)).sort().pop();
if (!archivo) { console.error('No está referencia/egida-datos-recetas*.json'); process.exit(1); }
const d = JSON.parse(readFileSync(join(raiz, 'referencia', archivo), 'utf8'));

const sinTildes = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const limpio = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const sql = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? 'null' : String(Number(v)));
const arr = (xs) => (xs.length ? `array[${xs.map(sql).join(', ')}]::text[]` : `'{}'::text[]`);
const json = (o) => `${sql(JSON.stringify(o))}::jsonb`;

const ingPorCodigo = new Map(d.ingredientes.map((i) => [i.codigo, i]));
const recPorCodigo = new Map(d.recetas.map((r) => [r.codigo, r]));

// ---------------------------------------------------------------- alérgenos por nombre de ingrediente
const REGLAS_ALERGENO = [
  [/\b(queso|leche|crema|mantequilla|yogur|kumis|suero|parmesano|mozzarella|ricotta|mascarpone|burrata|arequipe|lacteo)/, 'Lácteos'],
  [/\b(harina|pan\b|panko|trigo|pasta\b|apanad|galleta|cebada|centeno|seitan|ciabatta|lavash|masa filo)/, 'Gluten'],
  [/\b(huevo|yema|clara)/, 'Huevo'],
  [/\b(camaron|langostin|langosta|cangrejo|jaiba)/, 'Crustáceos'],
  [/\b(mejillon|pulpo|calamar|almeja|ostion|ostra|caracol|vieira|pianguas?)/, 'Moluscos'],
  [/\b(pescado|atun|salmon|anchoa|trucha|tilapia|corvina|robalo|bacalao|pargo|dorado|surimi)/, 'Pescado'],
  [/\b(soya|soja|tofu|miso|tamari|edamame)/, 'Soya'],
  [/\b(mani|cacahuate|cacahuete)/, 'Maní'],
  [/\b(nuez|nueces|almendra|avellana|pistacho|maranon|macadamia|pecana)/, 'Frutos secos'],
  [/\b(ajonjoli|sesamo|tahini)/, 'Sésamo'],
  [/\b(vino|vinagre|balsamic|aceto)/, 'Sulfitos'],
  [/\bmostaza/, 'Mostaza'],
  [/\bapio\b/, 'Apio'],
];
function alergenosDe(r, vistos = new Set()) {
  if (vistos.has(r.codigo)) return new Set();
  vistos.add(r.codigo);
  const s = new Set();
  for (const c of r.componentes ?? []) {
    if (c.tipo === 'sub') { const sub = recPorCodigo.get(c.codigo); if (sub) for (const a of [...(sub.alergenos ?? []), ...alergenosDe(sub, vistos)]) s.add(a); continue; }
    const n = sinTildes(ingPorCodigo.get(c.codigo)?.nombre);
    for (const [re, a] of REGLAS_ALERGENO) if (re.test(n)) s.add(a);
  }
  return s;
}

// ---------------------------------------------------------------- pasos, puntos y método
const METODOS = [
  [/reduc/, 'Reducción'], [/confit/, 'Confitado'], [/horne|al horno/, 'Horneado'], [/fre[ií]r|fritur|fritar/, 'Fritura'],
  [/\basar|a la parrilla|grill/, 'Asado'], [/fermen/, 'Fermentación'], [/marin|macer/, 'Marinado'],
  [/licu|procesa|emulsion|tritur/, 'Procesado'], [/sous vide|al vac[ií]o.*cocc/, 'Sous vide'], [/ahum/, 'Ahumado'],
  [/deshidrat/, 'Deshidratado'], [/hervir|cocinar|cocci[oó]n|ebullici|blanquea|escalfa/, 'Cocción'], [/saltea|sofr[ie]/, 'Salteado'],
];
function propuesta(r) {
  const renglones = String(r.procedimiento ?? '').split(/\r?\n/).map((x) => limpio(x)).filter(Boolean);
  const pasos = [], puntos = [], obs = [];
  for (const x of renglones) {
    const pc = x.match(/^PUNTO\s+CR[IÍ]TICO\s*:\s*(.+)$/i);
    const ob = x.match(/^OBSERVACI[OÓ]N\s*:\s*(.+)$/i);
    if (pc) { puntos.push({ tipo: /[°º]\s*c|temperat|refriger|congel/i.test(pc[1]) ? 'TEMPERATURA' : 'OTRO', texto: pc[1].slice(0, 400), de: 'escrito' }); continue; }
    if (ob) { obs.push(ob[1]); continue; }
    pasos.push(x.replace(/^\d+(\.\d+)*[.)]?\s+/, '').replace(/^\d+\)\s*/, ''));
  }
  // pasos que ya son puntos de control: el texto es el del paso
  for (const p of pasos) {
    if (puntos.length >= 5) break;
    const n = sinTildes(p);
    let tipo = null;
    if (/\d+\s*[°º]\s*c\b/.test(n)) tipo = 'TEMPERATURA';
    else if (/desinfect|saniti|lavar y desinf|higien/.test(n)) tipo = 'HIGIENE';
    else if (/\b\d+\s*(min|minutos|h|hr|hrs|horas)\b/.test(n)) tipo = 'TIEMPO';
    else if (/congel|refriger|enfri|cadena de frio|al vacio/.test(n)) tipo = 'TEMPERATURA';
    else if (/(verificar|textura|homogene|punto de (la )?(coccion|textura|salsa))/.test(n)) tipo = 'CALIDAD';
    if (tipo && !puntos.some((x) => x.texto === p)) puntos.push({ tipo, texto: p.slice(0, 400), de: 'paso' });
  }
  const todo = sinTildes(renglones.join(' '));
  const metodo = [...new Set(METODOS.filter(([re]) => re.test(todo)).map(([, m]) => m))].slice(0, 2).join(' y ') || null;
  const declarados = (r.alergenos ?? []).map(limpio).filter(Boolean);
  const sugeridos = [...alergenosDe(r)].filter((a) => !declarados.includes(a));
  // suma de lo que entra (g y ml como gramos) para orientar el neto; no es el neto
  let suma = 0, sumaCompleta = true;
  for (const c of r.componentes ?? []) {
    if (c.tipo === 'ing') { const i = ingPorCodigo.get(c.codigo); if (i && ['g', 'ml'].includes(i.unidad)) suma += Number(c.cantidad) || 0; else sumaCompleta = false; }
    else { const s = recPorCodigo.get(c.codigo); if (s && ['g', 'ml'].includes(s.unidad)) suma += Number(c.cantidad) || 0; else sumaCompleta = false; }
  }
  return { pasos, puntos, observaciones: obs, metodo, alergenos_declarados: declarados, alergenos_sugeridos: sugeridos,
           suma_entrada_g: suma > 0 ? Math.round(suma) : null, suma_completa: sumaCompleta };
}

// ---------------------------------------------------------------- SQL
const out = [];
out.push(`-- =====================================================================================
-- SGI Di Égida · Recetario de cocina (${archivo}) — propuestas para validar las MPI
-- Generado por scripts/migracion/extraer_recetario.mjs. NO editar a mano. Idempotente.
-- ${d.ingredientes.length} ingredientes · ${d.recetas.length} recetas (${d.recetas.filter((r) => r.clase === 'subreceta').length} subrecetas).
-- Solo propuestas: ninguna ficha nace de aquí sin que el chef la apruebe en la app.
-- =====================================================================================
`);
out.push(`insert into public.recetario_ingredientes as t (fuente, codigo, nombre, categoria, presentacion, unidad, contenido, precio, area) values`);
out.push(d.ingredientes.map((i) => `  (${sql(FUENTE)}, ${sql(i.codigo)}, ${sql(limpio(i.nombre))}, ${sql(i.categoria)}, ${sql(limpio(i.presentacion))}, ${sql(i.unidad)}, ${num(i.contenido)}, ${num(i.precio)}, ${sql(i.area)})`).join(',\n'));
out.push(`on conflict (fuente, codigo) do update set nombre = excluded.nombre, categoria = excluded.categoria, presentacion = excluded.presentacion,
  unidad = excluded.unidad, contenido = excluded.contenido, precio = excluded.precio, area = excluded.area;\n`);

out.push(`insert into public.recetario_recetas as t (fuente, codigo, clase, nombre, descripcion, rendimiento, unidad, alergenos, procedimiento, componentes, propuesta) values`);
out.push(d.recetas.map((r) => {
  const comps = (r.componentes ?? []).map((c) => ({ tipo: c.tipo, codigo: c.codigo, cantidad: Number(c.cantidad) || null,
    unidad: c.tipo === 'ing' ? ingPorCodigo.get(c.codigo)?.unidad ?? null : recPorCodigo.get(c.codigo)?.unidad ?? null }));
  return `  (${sql(FUENTE)}, ${sql(r.codigo)}, ${sql(r.clase)}, ${sql(limpio(r.nombre))}, ${sql(limpio(r.desc))}, ${num(r.rendimiento)}, ${sql(r.unidad)}, ${arr((r.alergenos ?? []).map(limpio))}, ${sql(r.procedimiento)}, ${json(comps)}, ${json(propuesta(r))})`;
}).join(',\n'));
out.push(`on conflict (fuente, codigo) do update set clase = excluded.clase, nombre = excluded.nombre, descripcion = excluded.descripcion,
  rendimiento = excluded.rendimiento, unidad = excluded.unidad, alergenos = excluded.alergenos, procedimiento = excluded.procedimiento,
  componentes = excluded.componentes, propuesta = excluded.propuesta;\n`);
out.push(`select privado.recetario_proponer(${sql(FUENTE)});`);
out.push(`select privado.bitacora('RECETARIO CARGADO', 'recetario_recetas', ${sql(FUENTE)}, jsonb_build_object('archivo', ${sql(archivo)},
  'recetas', ${d.recetas.length}, 'ingredientes', ${d.ingredientes.length}));`);

writeFileSync(join(raiz, 'supabase', 'datos', 'recetario_cocina.sql'), out.join('\n') + '\n');
const subs = d.recetas.filter((r) => r.clase === 'subreceta').map(propuesta);
console.log(`✔ supabase/datos/recetario_cocina.sql · ${d.recetas.length} recetas · ${d.ingredientes.length} ingredientes`);
console.log(`  subrecetas: ${subs.filter((p) => p.puntos.length).length} con puntos sugeridos, ${subs.filter((p) => p.alergenos_sugeridos.length).length} con alérgenos sugeridos, ${subs.filter((p) => p.metodo).length} con método`);
