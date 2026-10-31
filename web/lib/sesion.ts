import { cache } from 'react';
import { redirect } from 'next/navigation';
import { supabaseServidor } from './supabase/server';
import type { Perfil } from './roles';

// Perfil del usuario de esta petición (una consulta por render). Sin sesión o sin perfil activo → login.
export const perfilActual = cache(async (): Promise<Perfil> => {
  const supabase = await supabaseServidor();
  // el token ya lo verificó el proxy; getClaims lo vuelve a verificar sin salir del servidor
  const { data: sesion } = await supabase.auth.getClaims();
  const id = sesion?.claims?.sub;
  if (!id) redirect('/login');
  const { data } = await supabase.from('perfiles').select('id, nombre, usuario, rol, areas, activo, debe_cambiar_clave').eq('id', id).maybeSingle();
  if (!data || !data.activo) redirect('/login?error=sin-perfil');
  return data as Perfil;
});
