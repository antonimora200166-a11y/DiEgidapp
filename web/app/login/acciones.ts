'use server';
import { redirect } from 'next/navigation';
import { supabaseServidor } from '@/lib/supabase/server';
import { correoDe } from '@/lib/roles';

export type EstadoLogin = { error?: string };

export async function entrar(_: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const usuario = String(form.get('usuario') || '').trim();
  const clave = String(form.get('clave') || '');
  if (!usuario || !clave) return { error: 'Escribe tu usuario y tu contraseña.' };

  const supabase = await supabaseServidor();
  const { error } = await supabase.auth.signInWithPassword({ email: correoDe(usuario), password: clave });
  if (error) {
    return { error: error.status === 400 ? 'Usuario o contraseña incorrectos.' : 'No hay conexión con el servidor. Revisa la red e inténtalo otra vez.' };
  }

  // solo sirve una ruta interna: no se redirige a otro sitio
  const volver = String(form.get('volver') || '/');
  redirect(volver.startsWith('/') && !volver.startsWith('//') ? volver : '/');
}

export async function salir() {
  const supabase = await supabaseServidor();
  await supabase.auth.signOut();
  redirect('/login');
}
