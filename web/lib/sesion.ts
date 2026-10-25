import { cache } from 'react';
import { redirect } from 'next/navigation';
import { supabaseServidor } from './supabase/server';
import type { Perfil } from './roles';

// Perfil del usuario de esta petición (una consulta por render). Sin sesión o sin perfil activo → login.
export const perfilActual = cache(async (): Promise<Perfil> => {
  const supabase = await supabaseServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data } = await supabase.from('perfiles').select('id, nombre, usuario, rol, areas, activo, debe_cambiar_clave').eq('id', user.id).maybeSingle();
  if (!data || !data.activo) redirect('/login?error=sin-perfil');
  return data as Perfil;
});
