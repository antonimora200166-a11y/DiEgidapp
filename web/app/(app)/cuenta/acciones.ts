'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';

export type EstadoClave = { ok?: boolean; error?: string };

export async function cambiarClave(_: EstadoClave, form: FormData): Promise<EstadoClave> {
  const actual = String(form.get('actual') || '');
  const nueva = String(form.get('nueva') || '');
  const repetida = String(form.get('repetida') || '');
  if (nueva.length < 8) return { error: 'La contraseña nueva debe tener al menos 8 caracteres.' };
  if (nueva !== repetida) return { error: 'Las dos contraseñas nuevas no coinciden.' };
  if (nueva === actual) return { error: 'La contraseña nueva debe ser distinta de la actual.' };

  const supabase = await supabaseServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { error: 'Tu sesión se cerró. Vuelve a entrar.' };
  // se comprueba la actual: un celular olvidado abierto no basta para cambiarla
  const { error: e1 } = await supabase.auth.signInWithPassword({ email: user.email, password: actual });
  if (e1) return { error: e1.status === 400 ? 'La contraseña actual no es correcta.' : 'No hay conexión con el servidor.' };
  const { error: e2 } = await supabase.auth.updateUser({ password: nueva });
  if (e2) return { error: /weak|short|length/i.test(e2.message) ? 'Esa contraseña es muy débil: usa una más larga.' : `No se pudo cambiar: ${e2.message}` };
  await supabase.rpc('clave_cambiada');
  revalidatePath('/', 'layout');
  return { ok: true };
}
