// =====================================================================================
// Instala o actualiza la base de Supabase en un solo paso:
//   npm run bd:instalar              — aplica lo que falte
//   npm run bd:instalar -- --ver     — solo muestra qué falta, no toca nada
// 1. supabase/migrations/*.sql en orden, cada una una sola vez.
// 2. supabase/datos: historico_bar.sql, historico_cocina.sql y catalogo_unificado.sql. Son
//    idempotentes; se vuelven a correr solo si el archivo cambió desde la última vez.
// Cada archivo va en su propia transacción: si falla, no queda nada a medias y se detiene.
// Lo aplicado queda en privado.versiones_bd.
// Conexión: DATABASE_URL (Supabase → Connect → «Session pooler» o «Direct»), del entorno o de web/.env.local.
// =====================================================================================
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOLO_VER = process.argv.includes('--ver');
const DATOS = ['historico_bar.sql', 'historico_cocina.sql', 'catalogo_unificado.sql'];

const envLocal = join(raiz, 'web', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envLocal)) {
  const m = /^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m.exec(readFileSync(envLocal, 'utf8'));
  if (m) process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, '');
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL (en web/.env.local o en el entorno). Supabase → botón «Connect» → cadena de conexión.');
  process.exit(1);
}
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const db = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
await db.connect();

const sha = (texto) => createHash('sha256').update(texto).digest('hex').slice(0, 16);
await db.query(`create schema if not exists privado;
  create table if not exists privado.versiones_bd (
    archivo     text primary key,
    tipo        text not null check (tipo in ('MIGRACION', 'DATOS')),
    huella      text not null,
    aplicado_en timestamptz not null default now()
  );`);
const hechas = new Map((await db.query('select archivo, huella from privado.versiones_bd')).rows.map((r) => [r.archivo, r.huella]));

// una base que ya tiene el esquema pero no la tabla de versiones no se toca: se aplicó a mano
if (!hechas.size && (await db.query(`select to_regclass('public.perfiles') as t`)).rows[0].t) {
  console.error('✘ La base ya tiene tablas del SGI pero no registro de versiones. Revisa a mano qué migraciones tiene antes de seguir.');
  await db.end();
  process.exit(1);
}

const pendientes = [];
for (const f of readdirSync(join(raiz, 'supabase', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
  const texto = readFileSync(join(raiz, 'supabase', 'migrations', f), 'utf8');
  if (!hechas.has(f)) pendientes.push({ archivo: f, tipo: 'MIGRACION', texto });
  else if (hechas.get(f) !== sha(texto)) console.warn(`⚠ ${f} cambió después de aplicarla: una migración aplicada no se edita, se crea otra.`);
}
for (const f of DATOS) {
  const ruta = join(raiz, 'supabase', 'datos', f);
  if (!existsSync(ruta)) { console.warn(`⚠ Falta supabase/datos/${f}: genéralo antes (npm run migracion:…).`); continue; }
  const texto = readFileSync(ruta, 'utf8');
  if (hechas.get(f) !== sha(texto)) pendientes.push({ archivo: f, tipo: 'DATOS', texto });
}

if (!pendientes.length) {
  console.log('✔ La base está al día.');
} else if (SOLO_VER) {
  console.log('Falta aplicar:');
  for (const p of pendientes) console.log(`  · ${p.tipo === 'MIGRACION' ? 'migración' : 'datos    '} ${p.archivo}`);
} else {
  for (const p of pendientes) {
    process.stdout.write(`→ ${p.archivo} … `);
    try {
      await db.query('begin');
      await db.query(p.texto);
      await db.query(`insert into privado.versiones_bd (archivo, tipo, huella) values ($1, $2, $3)
                      on conflict (archivo) do update set huella = excluded.huella, aplicado_en = now()`, [p.archivo, p.tipo, sha(p.texto)]);
      await db.query('commit');
      console.log('ok');
    } catch (e) {
      await db.query('rollback').catch(() => {});
      console.log('FALLÓ');
      console.error(`✘ ${p.archivo}: ${e.message}${e.where ? `\n  ${e.where}` : ''}\nNo se aplicó nada de este archivo; lo anterior quedó aplicado.`);
      await db.end();
      process.exit(1);
    }
  }
  const { rows: [c] } = await db.query(`select (select count(*) from public.genericos) g, (select count(*) from public.productos) p,
    (select count(*) from public.productos where estado = 'PROVISIONAL') prov,
    (select count(*) from public.revision_catalogo where decision is null) pares`);
  console.log(`✔ Base al día: ${c.g} genéricos · ${c.p} productos (${c.prov} provisionales) · ${c.pares} pares por revisar en la app.`);
}
await db.end();
