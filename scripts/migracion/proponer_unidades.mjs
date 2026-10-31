// =====================================================================================
// Propuestas de unidad para el catálogo (revisión del 31/10/2026, hecha con Claude).
//   node scripts/migracion/proponer_unidades.mjs <catalogo.json>
// Lee la exportación de los insumos activos (MPe y MPI) y escribe
//   supabase/datos/propuestas_unidad.sql — solo propuestas: nada cambia hasta que una persona
//   las acepta en /catalogo/unidades (CLAUDE.md: la IA propone y una persona confirma).
// Cada propuesta lleva qué cambiar (unidad base, unidad de compra, contenido, categoría), una
// razón corta y su seguridad: ALTA (contradicción clara o dato explícito en la presentación),
// MEDIA (por el tipo de insumo), BAJA (criterio de cocina, revisar).
// No propone cambiar la unidad de lo que ya tiene kardex o está en una ficha técnica.
// =====================================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lit, uuid } from './comun.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const productos = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const n = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const tiene = (texto, palabras) => palabras.some((w) => new RegExp(`(^|[^a-z])${w}`).test(texto));

// ---------------------------------------------------------------- qué se cuenta por unidad
const POR_UNIDAD = ['bolsa', 'bolsas', 'cofia', 'tapaboca', 'esponja', 'escoba', 'waypall', 'pelicula', 'papel', 'huevo', 'panal',
  'codorniz', 'bala de', 'tabaco', 'habano', 'vainilla \\(vaina', 'diente', 'cabeza de cochinillo', 'arancini', 'croqueta', 'albondig',
  'entrada ', 'principal ', 'postre ', 'flan', 'pan ciabatta', 'brocheta', 'pernil', 'tomahawk', 'costilla sousvide', 'cubos arroz',
  'masa de lumpia', 'menta francesa', 'cerveza [a-z]+ ', 'carbon'];
// qué se mide en ml
const LIQUIDO = ['aceite', 'vinagre', 'aceto', 'leche entera', 'leche (?!en polvo)', 'crema de leche', 'vino', 'brandy', 'ron ', 'licor',
  'sirope', 'syrop', 'miel de agave', 'salsa soya', 'salsa inglesa', 'mirin', 'zumo', 'jugo', 'esencia', 'extracto', 'agua ',
  'tonica', 'gaseosa', 'soda', 'ginger', 'sparkling', 'red bull', 'gatorade', 'coctel fizzy', 'jp chenet', 'cerveza rubia', 'suero'];
// qué se pesa aunque hoy esté en ml
const SOLIDO_EN_ML = ['cafe molido', 'leche en polvo', 'queso crema', 'yogurt griego', 'miel de abeja'];

// ---------------------------------------------------------------- categorías de cocina por palabra
const CATEGORIA_COCINA = [
  ['COC_ASEO', ['bolsa', 'cofia', 'tapaboca', 'esponja', 'escoba', 'waypall', 'pelicula', 'papel', 'desengras', 'carbon', 'alcohol']],
  ['COC_AVES_HUEVOS', ['pollo', 'pavo', 'pato', 'codorniz', 'huevo', 'clara de huevo']],
  ['COC_PESCA', ['salmon', 'atun', 'calamar', 'camaron', 'langostin', 'pulpo', 'pargo', 'corvina', 'tilapia', 'mejillon', 'mejollon', 'jaiba',
                 'anchoa', 'vieras', 'unagi', 'anguila', 'katsubushi', 'alga']],
  ['COC_CARNICOS', ['res ', 'cerdo', 'cordero', 'venado', 'conejo', 'cochinillo', 'tocineta', 'panceta', 'jamon', 'chicharron', 'bofe',
                    'higado', 'molleja', 'riñon', 'rinon', 'rellena', 'contrafiletto', 'new york', 'tomahawk', 'costilla', 'patas de', 'grasa de']],
  ['COC_LACTEOS', ['queso', 'leche', 'crema de leche', 'mantequilla', 'yogurt', 'suero', 'whip', 'vitina']],
  ['COC_FRUVER', ['lechuga', 'tomate', 'cebolla', 'cebollino', 'ajo', 'aji', 'chile', 'jalapeño', 'jalapeno', 'pimenton', 'papa', 'platano', 'yuca',
                  'zanahoria', 'berenjena', 'calabacin', 'repollo', 'coles', 'apio', 'albahaca', 'cilantro', 'perejil', 'romero', 'tomillo', 'laurel',
                  'menta', 'hierbabuena', 'limon', 'limoncillo', 'naranja', 'mandarina', 'manzana', 'pera', 'uva', 'fresa', 'frambuesa', 'mora',
                  'arandano', 'mango', 'guayaba', 'coco', 'banano', 'durazno', 'champi', 'hongo', 'porcini', 'maiz', 'mazorca', 'germinado',
                  'brotes', 'espinaca', 'jengibre', 'petalos', 'flor', 'hoja de', 'rabano', 'remolacha', 'pepino', 'tamarindo', 'yuzu', 'combo tropical']],
  ['COC_ABARROTES', ['arroz', 'harina', 'azucar', 'sal ', 'pimienta', 'canela', 'comino', 'oregano', 'paprika', 'curry', 'curcuma', 'clavo',
                     'nuez', 'anis', 'cardamomo', 'especia', 'polvo', 'aceite', 'vinagre', 'aceto', 'salsa', 'pasta', 'fideo', 'noodle', 'udon',
                     'galleta', 'chocolate', 'cocoa', 'cafe', 'te ', 'matcha', 'frijol', 'lenteja', 'arveja', 'garbanzo', 'couscous', 'panko',
                     'maicena', 'fecula', 'almidon', 'goma', 'alginato', 'acido', 'bicarbonato', 'levadura', 'gelatina', 'mostaza', 'mayonesa',
                     'mayoneza', 'miel', 'agave', 'panela', 'almendra', 'pistacho', 'mara', 'nuez', 'ajonjoli', 'sesamo', 'chia', 'dátil', 'datil',
                     'higo', 'oliva', 'aceituna', 'alcaparr', 'kimchi', 'miso', 'tofu', 'mirin', 'vino', 'brandy', 'ron ', 'cerveza', 'mezcla',
                     'mejora masa', 'sponge', 'ice tea', 'polvo para hornear', 'espirulina', 'atun en', 'tomates secos', 'tomate pasta', 'tomate peleti']],
];
function categoria(nombre) {
  const t = n(nombre);
  // lo procesado o de despensa es abarrote aunque venga de una fruta o verdura
  if (tiene(t, ['polvo', 'seco', 'seca', 'deshidratad', 'lata', 'encurtid', 'pira', 'fecula', 'maicena', 'harina', 'aceite', 'vinagre',
                'aceto', 'salsa', 'almibar', 'ajinomoto', 'peleti', 'pasta', 'azucar', 'mermelada', 'conserva', 'hojuela', 'ajonjoli',
                'cocoa', 'te de', 'flor de jamaica', 'morita', 'semilla', 'flakes', 'extracto', 'esencia', 'vainilla', 'green pepper',
                'agua '])) return 'COC_ABARROTES';
  for (const [codigo, palabras] of CATEGORIA_COCINA) if (tiene(t, palabras)) return codigo;
  return null;
}

// ---------------------------------------------------------------- contenido explícito en la presentación
function contenidoExplicito(presentacion, base) {
  const m = /([\d.,]+)\s*(kg|kilo|g|gr|grs|ml|cc|l|lt|litro)s?\b/i.exec(presentacion ?? '');
  if (!m) return null;
  const v = Number(m[1].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  const u = m[2].toLowerCase();
  const dim = ['kg', 'kilo', 'g', 'gr', 'grs'].includes(u) ? 'g' : 'ml';
  if (dim !== base || !(v > 0)) return null;
  return ['kg', 'kilo', 'l', 'lt', 'litro'].includes(u) ? v * 1000 : v;
}
const UC_GRAMO = ['GR', 'G'], UC_KILO = ['KG'], UC_ML = ['ML', 'CC'], UC_LITRO = ['L', 'LT'], UC_GALON = ['GAL'];

// ---------------------------------------------------------------- unidad base que corresponde al genérico
// Criterio de la revisión: nunca se propone pasar de g o ml a und (el peso es más preciso); los MPI
// que ya van en g o ml se quedan (así los costea SGI-COSTOS); la unidad de compra manda sobre el nombre.
const MIXER_EN_COCTEL = ['tonica', 'soda', 'ginger', 'sparkling'];
function unidadPropia(p) {
  const t = n(p.nombre);
  const queda = { ub: p.ub, seg: 'ALTA', por: '' };
  if (p.ub !== 'und') {
    if (p.tipo === 'MPI') return queda;
    if (UC_GRAMO.includes(p.uc) || UC_KILO.includes(p.uc) || UC_ML.includes(p.uc) || UC_LITRO.includes(p.uc)) return queda;
    if (p.ub === 'ml' && tiene(t, SOLIDO_EN_ML)) return { ub: 'g', seg: 'MEDIA', por: 'es un sólido o pasta: se pesa' };
    if (p.ub === 'g' && tiene(t, ['aceite', 'vinagre', 'vino', 'licor', 'zumo', 'jugo']) && !tiene(t, ['en polvo'])) {
      return { ub: 'ml', seg: 'MEDIA', por: 'es líquido: se mide en ml' };
    }
    return queda;
  }
  // está en und
  if (p.area === 'BAR' && p.cat === 'Cervezas') return queda;
  if (tiene(t, POR_UNIDAD)) return queda;
  if (UC_GRAMO.includes(p.uc) || UC_KILO.includes(p.uc)) return { ub: 'g', seg: 'ALTA', por: `se compra por ${p.uc}` };
  if (UC_ML.includes(p.uc) || UC_LITRO.includes(p.uc)) return { ub: 'ml', seg: 'ALTA', por: `se compra por ${p.uc}` };
  if (p.area === 'BAR') {
    return tiene(t, MIXER_EN_COCTEL) ? { ub: 'ml', seg: 'MEDIA', por: 'en los cócteles se sirve por ml' } : queda;
  }
  if (tiene(t, SOLIDO_EN_ML)) return { ub: 'g', seg: 'MEDIA', por: 'es un sólido o pasta: se pesa' };
  if (tiene(t, LIQUIDO)) return { ub: 'ml', seg: 'MEDIA', por: 'es líquido: se mide en ml' };
  if (p.tipo === 'MPI') return { ub: 'g', seg: 'MEDIA', por: 'es una preparación: se pesa al producirla y al usarla' };
  return { ub: 'g', seg: 'BAJA', por: 'en cocina se pesa' };
}

const propuestas = [];
const porGenerico = new Map();
for (const p of productos) (porGenerico.get(p.gid) || porGenerico.set(p.gid, []).get(p.gid)).push(p);

for (const [, lista] of porGenerico) {
  // la unidad es del genérico: se decide una vez con todas sus presentaciones
  const votos = lista.map(unidadPropia);
  const destino = votos.find((v) => v.seg === 'ALTA' && v.ub !== lista[0].ub) ?? votos[0];
  const bloqueado = lista.some((p) => p.kardex || p.ficha);
  const cambiaUnidad = destino.ub !== lista[0].ub && !bloqueado;

  for (const p of lista) {
    const cambios = {};
    const razones = [];
    let seg = 'ALTA';
    const baja = (s) => { if (s === 'BAJA' || (s === 'MEDIA' && seg === 'ALTA')) seg = s; };
    const ub = cambiaUnidad ? destino.ub : p.ub;

    if (cambiaUnidad) {
      cambios.unidad_base = ub;
      razones.push(`${p.ub} → ${ub}: ${destino.por}`);
      baja(destino.seg);
    }
    // contenido de la presentación en la unidad que queda
    const explicito = ub === 'und' ? null : contenidoExplicito(p.presentacion, ub);
    const actual = p.var ? null : Number(p.cont);
    if (ub !== 'und') {
      // un MPI no se compra: se produce y se lleva en g o ml sueltos
      if (p.tipo === 'MPI' && (cambiaUnidad || (!UC_GRAMO.includes(p.uc) && !UC_ML.includes(p.uc) && (p.var || actual === 1)))) {
        cambios.unidad_compra = ub === 'g' ? 'GR' : 'ML';
        cambios.contenido_base = 1;
        razones.push(`se lleva en ${ub} sueltos`);
      } else if (explicito && explicito !== actual) {
        cambios.contenido_base = explicito;
        razones.push(`la presentación dice ${p.presentacion}`);
      } else if ((UC_GRAMO.includes(p.uc) || UC_ML.includes(p.uc)) && actual !== 1) {
        cambios.contenido_base = 1;
        razones.push(`1 ${p.uc} = 1 ${ub}`);
      } else if ((UC_KILO.includes(p.uc) || UC_LITRO.includes(p.uc)) && actual !== 1000) {
        cambios.contenido_base = 1000;
        razones.push(`1 ${p.uc} = 1.000 ${ub}`);
      } else if (UC_GALON.includes(p.uc) && ub === 'ml' && actual !== 3785) {
        cambios.contenido_base = 3785;
        razones.push('1 galón = 3.785 ml');
        baja('MEDIA');
      } else if (!explicito && !p.var && actual !== null && actual <= 1 && !UC_GRAMO.includes(p.uc) && !UC_ML.includes(p.uc)) {
        // «Unidad · 1 g»: una unidad de compra no pesa 1 g; se pesa al recibir
        cambios.contenido_variable = true;
        razones.push(`1 ${p.uc.toLowerCase()} no son ${actual} ${ub}: que se pese al recibir`);
        baja('MEDIA');
      } else if (cambiaUnidad && !explicito && actual && actual > 1 && p.ub === 'und') {
        razones.push(`se deja el contenido ${actual}: revisa que sea en ${ub}`);
        baja('BAJA');
      }
    } else if (cambiaUnidad && !p.var && actual !== 1) {
      cambios.contenido_base = 1;
      razones.push('1 unidad de compra = 1 und');
    }
    if (p.area === 'COCINA' && !p.cat) {
      const c = categoria(p.nombre);
      if (c) { cambios.categoria = c; razones.push('categoría por el nombre'); baja('MEDIA'); }
    }
    if (!Object.keys(cambios).length) continue;
    propuestas.push({ p, cambios, razon: razones.join('; '), seg, actual: {
      unidad_base: p.ub, unidad_compra: p.uc, contenido_base: p.var ? null : Number(p.cont), contenido_variable: p.var, categoria: p.cat } });
  }
}

const filas = propuestas.map(({ p, cambios, razon, seg, actual }) =>
  `(${lit(uuid('propuesta_unidad', p.id))}, ${lit(p.id)}, ${lit(JSON.stringify(cambios))}::jsonb, ${lit(JSON.stringify(actual))}::jsonb, ${lit(seg)}, ${lit(razon)})`);
const out = [`-- =====================================================================================
-- SGI Di Égida · Propuestas de unidad del catálogo (revisión del 31/10/2026 con Claude)
-- Generado por scripts/migracion/proponer_unidades.mjs. NO editar a mano. Solo propuestas:
-- se aceptan o corrigen en /catalogo/unidades. Idempotente: al volver a cargarlo actualiza solo las pendientes.
-- =====================================================================================`];
for (let i = 0; i < filas.length; i += 200) {
  out.push(`\ninsert into public.propuestas_unidad (id, producto_id, cambios, actual, seguridad, razon) values\n  ${filas.slice(i, i + 200).join(',\n  ')}\non conflict (id) do update set cambios = excluded.cambios, actual = excluded.actual, seguridad = excluded.seguridad, razon = excluded.razon\n  where public.propuestas_unidad.estado = 'PENDIENTE' and public.propuestas_unidad.cambios is distinct from excluded.cambios;`);
}
writeFileSync(join(raiz, 'supabase', 'datos', 'propuestas_unidad.sql'), out.join('\n') + '\n');
const cuenta = (f) => propuestas.filter(f).length;
console.log(`✔ ${propuestas.length} propuestas · ALTA ${cuenta((x) => x.seg === 'ALTA')} · MEDIA ${cuenta((x) => x.seg === 'MEDIA')} · BAJA ${cuenta((x) => x.seg === 'BAJA')}`);
console.log(`  unidad base ${cuenta((x) => x.cambios.unidad_base)} · contenido ${cuenta((x) => 'contenido_base' in x.cambios)} · variable ${cuenta((x) => x.cambios.contenido_variable)} · categoría ${cuenta((x) => x.cambios.categoria)}`);
if (process.argv.includes('--ver')) for (const x of propuestas) console.log(`${x.seg}|${x.p.area[0]}|${x.p.nombre}|${x.p.presentacion}|${x.p.uc}|${x.p.ub}→${JSON.stringify(x.cambios)}|${x.razon}`);
