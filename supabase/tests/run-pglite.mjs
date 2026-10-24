// Corre las migraciones y las pruebas pgTAP de supabase/tests en PGlite (Postgres en WASM),
// sin Docker ni Supabase CLI. En un proyecto Supabase real, usar: supabase test db
//
//   npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '..');
const leer = (p) => readFileSync(p, 'utf8');

// \ir archivo — incluye otro archivo relativo al actual (como psql)
function expandir(ruta) {
  return leer(ruta).replace(/^\\ir\s+(\S+)\s*$/gm, (_, inc) => expandir(join(dirname(ruta), inc)));
}

const db = new PGlite({ extensions: { pg_trgm } });
await db.exec(leer(join(raiz, 'local', 'supabase_stub.sql')));

const migraciones = readdirSync(join(raiz, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
for (const m of migraciones) {
  try {
    await db.exec(leer(join(raiz, 'migrations', m)));
    console.log(`# migración aplicada: ${m}`);
  } catch (e) {
    console.error(`✘ migración ${m}: ${e.message}`);
    process.exit(1);
  }
}
await db.exec(leer(join(raiz, 'local', 'pgtap_lite.sql')));
await db.exec(`alter role postgres set search_path = public, tap, extensions; set search_path = public, tap, extensions;`);

const pruebas = readdirSync(aqui).filter((f) => f.endsWith('.test.sql')).sort();
let fallos = 0;
let total = 0;
for (const archivo of pruebas) {
  console.log(`\n# ${archivo}`);
  const sql = expandir(join(aqui, archivo)).replace(/^create extension if not exists pgtap.*$/gim, '');
  await db.exec(`alter sequence tap.n restart with 1`);
  let lineas = [];
  try {
    const res = await db.exec(sql);
    for (const r of res) {
      for (const fila of r.rows) {
        const v = Object.values(fila)[0];
        if (typeof v === 'string' && /^(ok |not ok |1\.\.)/.test(v)) lineas.push(v);
      }
    }
  } catch (e) {
    await db.exec('rollback').catch(() => {});
    console.log(`not ok - el archivo se detuvo: ${e.message}`);
    fallos++;
    continue;
  }
  const plan = Number((lineas.find((l) => l.startsWith('1..')) || '1..0').slice(3));
  const corridas = lineas.filter((l) => !l.startsWith('1..'));
  for (const l of lineas) console.log(l);
  const malas = corridas.filter((l) => l.startsWith('not ok')).length;
  total += corridas.length;
  fallos += malas;
  if (corridas.length !== plan) {
    console.log(`# plan de ${plan} pruebas, se corrieron ${corridas.length}`);
    fallos++;
  }
}

console.log(`\n# ${total} pruebas, ${fallos} fallo(s)`);
process.exit(fallos ? 1 : 0);
