// Crea un usuario con su perfil desde la terminal. Sirve para el primer admin (después se usa la
// pantalla Usuarios). Lee web/.env.local.
//   npm run crear-usuario                 — pregunta usuario, nombre, rol y contraseña uno por uno
//   npm run crear-usuario -- anthony "Anthony Mora" admin
// La contraseña siempre se pide por la terminal (no queda en el historial).
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
const USUARIO = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !clave) { console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en web/.env.local.'); process.exit(1); }
const dominio = process.env.NEXT_PUBLIC_DOMINIO_USUARIOS || 'usuarios.diegida.local';

// con argumentos completos no pregunta; si falta algo o viene mal, lo pide (evita pelear con comillas)
// el iterador guarda las líneas que llegan antes de preguntar (pegar varias de una vez no las pierde)
const rl = createInterface({ input: process.stdin, terminal: false });
const lineas = rl[Symbol.asyncIterator]();
const preguntar = async (texto, valido, ayuda) => {
  for (;;) {
    process.stdout.write(texto);
    const { value, done } = await lineas.next();
    if (done) { console.error('\n✘ Se cerró la entrada sin terminar: no se creó nada.'); process.exit(1); }
    const v = String(value).trim();
    if (valido(v)) return v;
    console.log(`  ${ayuda}`);
  }
};
let [usuario = '', nombre = '', rol = '', areasTxt] = process.argv.slice(2);
usuario = usuario.toLowerCase();
const args = process.argv.slice(2).length;
if (args > 4 || !USUARIO.test(usuario) || nombre.length < 3 || !(rol in ROLES)) {
  if (args) console.log('Los datos del comando no se entendieron; vamos uno por uno.\n');
  usuario = (await preguntar('Usuario (minúsculas, sin espacios, ej.: anthony): ', (v) => USUARIO.test(v.toLowerCase()),
    'Solo minúsculas, números, punto o guion; de 3 a 30 caracteres.')).toLowerCase();
  nombre = await preguntar('Nombre completo (ej.: Anthony David España Mora): ', (v) => v.length >= 3, 'Escribe el nombre completo.');
  rol = await preguntar(`Rol (${Object.keys(ROLES).join(', ')}): `, (v) => v.toLowerCase() in ROLES, 'Escribe uno de los roles de la lista.');
  rol = rol.toLowerCase();
  areasTxt = undefined;
}
const areas = areasTxt ? areasTxt.split(',').map((a) => a.trim().toUpperCase()) : ROLES[rol];
const pass = await preguntar('Contraseña inicial (mínimo 8): ', (v) => v.length >= 8, 'La contraseña es muy corta: mínimo 8 caracteres.');
rl.close();

const sb = createClient(url, clave, { auth: { persistSession: false } });
const { data, error } = await sb.auth.admin.createUser({ email: `${usuario}@${dominio}`, password: pass, email_confirm: true, user_metadata: { usuario, nombre } });
if (error) { console.error(`✘ ${error.message}`); process.exit(1); }
const { error: e2 } = await sb.from('perfiles').insert({ id: data.user.id, nombre, usuario, rol, areas });
if (e2) { await sb.auth.admin.deleteUser(data.user.id); console.error(`✘ perfil: ${e2.message}`); process.exit(1); }
console.log(`✔ ${usuario} (${rol}${areas.length ? ' · ' + areas.join(', ') : ''}) creado. Entra con el usuario «${usuario}».`);
