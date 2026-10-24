// Crea un usuario con su perfil desde la terminal. Sirve para el primer admin (después se usa la
// pantalla Usuarios). Lee web/.env.local.
//   npm run crear-usuario -- <usuario> "<Nombre completo>" <rol> [BAR,COCINA]
//   npm run crear-usuario -- anthony "Anthony Mora" admin
// Pide la contraseña por la terminal (no queda en el historial).
import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { createClient } from '@supabase/supabase-js';

if (existsSync(new URL('../.env.local', import.meta.url))) {
  for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(l);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const ROLES = { admin: [], jefe_bar: ['BAR'], aux_bar: ['BAR'], chef: ['COCINA'], sous_chef: ['COCINA'], aux_cocina: ['COCINA'], servicio: [], auditor: [] };
const [usuario, nombre, rol, areasTxt] = process.argv.slice(2);
if (!usuario || !nombre || !(rol in ROLES)) {
  console.error(`Uso: npm run crear-usuario -- <usuario> "<Nombre completo>" <${Object.keys(ROLES).join('|')}> [BAR,COCINA]`);
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(usuario)) { console.error('Usuario no válido: minúsculas, 3 a 30 caracteres.'); process.exit(1); }
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !clave) { console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en web/.env.local.'); process.exit(1); }
const dominio = process.env.NEXT_PUBLIC_DOMINIO_USUARIOS || 'usuarios.diegida.local';
const areas = areasTxt ? areasTxt.split(',').map((a) => a.trim().toUpperCase()) : ROLES[rol];

const rl = createInterface({ input: process.stdin, output: process.stdout });
const pass = await rl.question('Contraseña inicial (mínimo 8): ');
rl.close();
if (pass.length < 8) { console.error('La contraseña es muy corta.'); process.exit(1); }

const sb = createClient(url, clave, { auth: { persistSession: false } });
const { data, error } = await sb.auth.admin.createUser({ email: `${usuario}@${dominio}`, password: pass, email_confirm: true, user_metadata: { usuario, nombre } });
if (error) { console.error(`✘ ${error.message}`); process.exit(1); }
const { error: e2 } = await sb.from('perfiles').insert({ id: data.user.id, nombre, usuario, rol, areas });
if (e2) { await sb.auth.admin.deleteUser(data.user.id); console.error(`✘ perfil: ${e2.message}`); process.exit(1); }
console.log(`✔ ${usuario} (${rol}${areas.length ? ' · ' + areas.join(', ') : ''}) creado. Entra con el usuario «${usuario}».`);
