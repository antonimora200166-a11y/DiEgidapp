// =====================================================================================
// Carta de coctelería (referencia/Coctelería diEgida*.xlsx) → supabase/datos/recetario_cocteles.sql
//   node scripts/migracion/extraer_cocteles.mjs [--ver]
// Una hoja por cóctel con el formato COCT-L 1. Se carga TAL CUAL en las tablas del recetario
// (fuente CARTA COCTELERÍA) con una propuesta armada solo con lo escrito: ingredientes con su
// cantidad, decoración, método, descripción, presentación y procedimiento en pasos, más los
// alérgenos que sugieren los ingredientes. El jefe de barra la aprueba en la app.
// De las sangrías se toma la primera presentación de la hoja (jarra); la de copa queda anotada.
// Las fotos de la hoja no se cargan (se harán con las fotos oficiales).
// =====================================================================================
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerXlsx, posicion } from './leer_xlsx.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FUENTE = 'CARTA COCTELERÍA';
const archivo = readdirSync(join(raiz, 'referencia')).filter((f) => /^cocteler[ií]a.*\.xlsx$/i.test(f.normalize('NFC'))).sort().pop();
if (!archivo) { console.error('No está referencia/Coctelería*.xlsx'); process.exit(1); }
const hojas = leerXlsx(join(raiz, 'referencia', archivo));

const sinTildes = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const empieza = (v, re) => re.test(sinTildes(v));
const sql = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? 'null' : String(Number(v)));
const json = (o) => `${sql(JSON.stringify(o))}::jsonb`;
const slug = (s) => sinTildes(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const UNIDAD = { ml: 'ml', mlts: 'ml', gr: 'g', grs: 'g', g: 'g', bot: 'bot', und: 'und', unidad: 'und', oz: 'oz', cda: 'cda', cucharadas: 'cda', cucharada: 'cda', gotas: 'gota', dash: 'dash' };

// Una hoja trae una presentación (cóctel) o dos lado a lado (sangrías: jarra y copa)
function presentaciones(h) {
  const celdas = [...h.celdas.entries()].map(([ref, v]) => ({ ...posicion(ref), v })).sort((a, b) => a.fila - b.fila || a.col - b.col);
  const resp = celdas.filter((x) => empieza(x.v, /^responsable/));
  if (resp.length < 2) return [{ ...cóctel(h, celdas), variante: null }];
  return [{ ...cóctel(h, celdas.filter((x) => x.col < resp[1].col)), variante: 'J' },
          { ...cóctel(h, celdas.filter((x) => x.col >= resp[1].col)), variante: 'C' }];
}
// «Tradicional con Ginebra tanqueray/premium con Hendricks (se solicita…)» → «Ginebra tanqueray»; la nota completa se guarda aparte
const limpiar = (s) => s.replace(/\([^)]*\)?/g, '').replace(/^\s*tradicional\s*con\s*/i, '').split('/')[0].replace(/\s+/g, ' ').trim() || s;

function cóctel(h, bloque) {
  const en = (fila, col) => bloque.find((x) => x.fila === fila && x.col === col)?.v ?? null;
  const bajo = (et) => { const e = bloque.find((x) => empieza(x.v, et)); if (!e) return null;
    return bloque.find((x) => x.col === e.col && x.fila > e.fila && x.fila <= e.fila + 3)?.v ?? null; };
  const derechaOBajo = (et) => { const e = bloque.find((x) => empieza(x.v, et)); if (!e) return null;
    const der = bloque.filter((x) => x.fila === e.fila && x.col > e.col).sort((a, b) => a.col - b.col)[0];
    if (der && !/:$/.test(der.v)) return der.v;
    return bloque.find((x) => x.fila > e.fila && x.fila <= e.fila + 2 && x.col >= e.col - 1 && x.col <= e.col + 1)?.v ?? null; };
  const textoBajo = (et) => { const e = bloque.find((x) => empieza(x.v, et)); if (!e) return null;
    return bloque.find((x) => x.fila > e.fila && x.fila <= e.fila + 12 && x.v.length > 25 && !/:$/.test(x.v))?.v ?? null; };

  const cab = bloque.find((x) => empieza(x.v, /^ingredientes/));
  const cCant = bloque.find((x) => cab && x.fila === cab.fila && empieza(x.v, /^cantidad/))?.col;
  const cUnd = bloque.find((x) => cab && x.fila === cab.fila && empieza(x.v, /^unidad/))?.col;
  const corte = bloque.find((x) => cab && x.fila > cab.fila && empieza(x.v, /^(decoracion|presentacion|descripcion|procedimiento)/));
  const ingredientes = [], decoracion = [];
  if (cab) {
    for (let f = cab.fila + 1; f < (corte?.fila ?? cab.fila + 25); f++) {
      const nombre = en(f, cab.col);
      if (!nombre || empieza(nombre, /^(decoracion|metodo)/)) continue;
      const crudo = cCant ? en(f, cCant) : null, u = cUnd ? en(f, cUnd) : null;
      ingredientes.push({ nombre: limpiar(nombre), original: nombre, cantidad: crudo !== null && Number.isFinite(Number(String(crudo).replace(',', '.'))) ? Number(String(crudo).replace(',', '.')) : null,
                          cantidad_texto: crudo, unidad: u ? UNIDAD[sinTildes(u)] ?? sinTildes(u) : null });
    }
    const deco = bloque.find((x) => empieza(x.v, /^decoracion/));
    if (deco) {
      const tope = bloque.find((x) => x.fila > deco.fila && empieza(x.v, /^(descripcion|presentacion|procedimiento)/))?.fila ?? deco.fila + 8;
      for (let f = deco.fila + 1; f < tope; f++) { const v = en(f, cab.col); if (v) decoracion.push(v); }
    }
  }
  const proc = textoBajo(/^procedimiento/);
  const pasos = proc ? proc.split(/\s*(?=\b\d{1,2}\s*[\])](?:\.)?\s)/).map((p) => p.replace(/^\d{1,2}\s*[\])]\.?\s*/, '').trim()).filter(Boolean) : [];
  return {
    hoja: h.nombre.trim(),
    numero: bajo(/^numero de coctel/),
    nombre: bajo(/^nombre de la receta/) ?? h.nombre.replace(/#.*$/, '').trim(),
    concepto: bajo(/^concepto/),
    responsable: bajo(/^responsable/),
    metodo: derechaOBajo(/^metodo/),
    descripcion: textoBajo(/^descripcion/),
    presentacion: derechaOBajo(/^presentacion/),
    procedimiento: proc, pasos, ingredientes, decoracion,
  };
}

const REGLAS_ALERGENO = [
  [/\b(leche|crema|baileys|helado|yogur|queso|mantequilla|arequipe|condensada)/, 'Lácteos'],
  [/\b(clara|huevo|yema)/, 'Huevo'],
  [/\b(amaretto|amareto|almendra|frangelico|avellana|nuez|pistacho|horchata)/, 'Frutos secos'],
  [/\b(mani|cacahu)/, 'Maní'],
  [/\b(vino|espumante|champa|prosecco|cava|vermouth|vermut|aperol|campari|sangria)/, 'Sulfitos'],
  [/\b(cerveza|birra|malta|galleta|cebada)/, 'Gluten'],
  [/\b(ajonjoli|sesamo)/, 'Sésamo'],
  [/\b(soya|soja)/, 'Soya'],
];
const PUNTOS = [
  [/(congel|refriger|enfri|hielo)/, 'TEMPERATURA'],
  [/(recien extraida|muy importante|sumamente importante|importante)/, 'CALIDAD'],
];

const lista = hojas.filter((h) => !/^(introduccion|plantilla)$/i.test(sinTildes(h.nombre).trim())).flatMap(presentaciones);
if (process.argv.includes('--ing')) {
  for (const x of lista) console.log(x.hoja, '→', x.ingredientes.map((i) => `${i.nombre} [${i.cantidad ?? i.cantidad_texto ?? '?'} ${i.unidad ?? ''}]`).join(' | '), '‖ deco:', x.decoracion.join(' | '));
  process.exit(0);
}
if (process.argv.includes('--ver')) {
  for (const x of lista) console.log(JSON.stringify(x).slice(0, 900), '\n');
  console.log(lista.length, 'cócteles ·', lista.filter((x) => !x.ingredientes.length).length, 'sin ingredientes ·', lista.filter((x) => !x.pasos.length).length, 'sin pasos');
  process.exit(0);
}

const out = [];
out.push(`-- =====================================================================================
-- SGI Di Égida · Carta de coctelería (${archivo}) — propuestas para completar las fichas de bebida
-- Generado por scripts/migracion/extraer_cocteles.mjs. NO editar a mano. Idempotente.
-- ${lista.length} presentaciones. Los ingredientes de la carta se muestran para comparar: la ficha
-- conserva los ya emparejados y costeados. El jefe de barra aprueba cada una.
-- =====================================================================================
`);
out.push(`insert into public.recetario_recetas as t (fuente, codigo, clase, nombre, descripcion, rendimiento, unidad, alergenos, procedimiento, componentes, propuesta) values`);
out.push(lista.map((x, n) => {
  // el número del cóctel es el de la hoja («Morfeo pee#23»); la celda a veces trae «# 1» o nada
  const nro = Number(/#\s*(\d+)\s*$/.exec(x.hoja)?.[1] ?? n + 1);
  const codigo = 'C' + String(nro).padStart(2, '0') + (x.variante ?? '');
  const texto = sinTildes([...x.ingredientes.map((i) => i.nombre), ...x.decoracion].join(' | '));
  const alerg = [...new Set(REGLAS_ALERGENO.filter(([re]) => re.test(texto)).map(([, a]) => a))];
  const puntos = [];
  for (const p of x.pasos) { const n2 = sinTildes(p); const t = PUNTOS.find(([re]) => re.test(n2)); if (t && puntos.length < 3 && /importante|congel|recien/.test(n2)) puntos.push({ tipo: t[1], texto: p.slice(0, 400), de: 'paso' }); }
  const comps = x.ingredientes.map((i) => ({ tipo: 'ing', codigo: 'BAR-' + slug(i.nombre), nombre: i.nombre, cantidad: i.cantidad, unidad: i.unidad,
                                            nota: [i.cantidad === null && i.cantidad_texto ? i.cantidad_texto : null, i.original !== i.nombre ? i.original : null].filter(Boolean).join(' · ') || null }));
  const notas = x.ingredientes.filter((i) => /se solicita|se sugiere|solicito/i.test(i.original)).map((i) => i.original);
  const propuesta = { pasos: x.pasos, puntos, observaciones: notas,
                      metodo: x.metodo, concepto: x.concepto, decoracion: x.decoracion, presentacion: x.presentacion,
                      alergenos_declarados: [], alergenos_sugeridos: alerg, numero: x.numero, responsable: x.responsable };
  return `  (${sql(FUENTE)}, ${sql(codigo)}, 'bebida', ${sql(x.nombre)}, ${sql(x.descripcion)}, 1, 'und', '{}'::text[], ${sql(x.procedimiento)}, ${json(comps)}, ${json(propuesta)})`;
}).join(',\n'));
out.push(`on conflict (fuente, codigo) do update set nombre = excluded.nombre, descripcion = excluded.descripcion, procedimiento = excluded.procedimiento,
  componentes = excluded.componentes, propuesta = excluded.propuesta;\n`);
out.push(`select privado.recetario_proponer(${sql(FUENTE)});`);
out.push(`select privado.bitacora('RECETARIO CARGADO', 'recetario_recetas', ${sql(FUENTE)}, jsonb_build_object('archivo', ${sql(archivo)}, 'recetas', ${lista.length}));`);
writeFileSync(join(raiz, 'supabase', 'datos', 'recetario_cocteles.sql'), out.join('\n') + '\n');
console.log(`✔ supabase/datos/recetario_cocteles.sql · ${lista.length} presentaciones de ${new Set(lista.map((x) => x.hoja)).size} hojas`);
