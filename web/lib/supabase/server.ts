import { createServerClient } from '@supabase/ssr';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

// Cliente con la sesión del usuario: RLS decide qué ve y qué escribe.
export async function supabaseServidor() {
  const almacen = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => almacen.getAll(),
      setAll: (lista) => {
        try {
          for (const { name, value, options } of lista) almacen.set(name, value, options);
        } catch {
          // desde un Server Component no se escriben cookies: el proxy ya refrescó la sesión
        }
      },
    },
  });
}

// Cliente de servicio: salta RLS. Solo para crear usuarios, y solo después de comprobar que quien
// lo pide es admin.
export function supabaseServicio() {
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!clave) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY en el servidor.');
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, clave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
