'use server';
import { revalidatePath } from 'next/cache';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor, supabaseServicio } from '@/lib/supabase/server';
import { ROLES, USUARIO_VALIDO, correoDe, type Area, type Rol } from '@/lib/roles';

export type EstadoUsuario = { ok?: string; error?: string };

export async function crearUsuario(_: EstadoUsuario, form: FormData): Promise<EstadoUsuario> {
  const yo = await perfilActual();
  if (yo.rol !== 'admin') return { error: 'Solo administración crea usuarios.' };

  const usuario = String(form.get('usuario') || '').trim().toLowerCase();
  const nombre = String(form.get('nombre') || '').trim();
  const clave = String(form.get('clave') || '');
  const rol = String(form.get('rol') || '') as Rol;
  const def = ROLES.find((r) => r.rol === rol);
  if (!USUARIO_VALIDO.test(usuario)) return { error: 'El usuario va en minúsculas, de 3 a 30 letras, números, punto o guion (ej.: frank.motato).' };
  if (nombre.length < 3) return { error: 'Falta el nombre completo.' };
  if (clave.length < 8) return { error: 'La contraseña debe tener al menos 8 caracteres.' };
  if (!def) return { error: 'Elige un rol.' };
  // el área sale del rol; el admin y servicio pueden marcar áreas a mano
  const marcadas = form.getAll('areas').map(String).filter((a): a is Area => a === 'BAR' || a === 'COCINA');
  const areas = def.areas.length && rol !== 'admin' ? def.areas : marcadas;

  const servicio = supabaseServicio();
  const { data, error } = await servicio.auth.admin.createUser({
    email: correoDe(usuario), password: clave, email_confirm: true, user_metadata: { usuario, nombre },
  });
  if (error || !data.user) {
    return { error: /already|registered|exists/i.test(error?.message || '') ? `El usuario «${usuario}» ya existe.` : `No se pudo crear: ${error?.message}` };
  }
  // el perfil lo inserta el admin con su sesión: la bitácora queda a su nombre
  const supabase = await supabaseServidor();
  const { error: e2 } = await supabase.from('perfiles').insert({ id: data.user.id, nombre, usuario, rol, areas });
  if (e2) {
    await servicio.auth.admin.deleteUser(data.user.id);   // usuario de Auth recién creado y sin perfil: no deja rastro operativo
    return { error: `No se pudo crear el perfil: ${e2.message}` };
  }
  revalidatePath('/admin/usuarios');
  return { ok: `Usuario «${usuario}» creado. Entrégale su contraseña en persona.` };
}

export async function cambiarActivo(form: FormData) {
  const yo = await perfilActual();
  if (yo.rol !== 'admin') return;
  const id = String(form.get('id'));
  if (id === yo.id) return;                    // nadie se desactiva a sí mismo
  const supabase = await supabaseServidor();
  await supabase.from('perfiles').update({ activo: form.get('activo') === 'true' }).eq('id', id);
  revalidatePath('/admin/usuarios');
}
