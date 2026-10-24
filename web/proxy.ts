import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Refresca la sesión de Supabase en cada petición y manda al login a quien no la tenga.
// Es un filtro optimista: los permisos reales los aplican RLS y las RPC en la base.
const PUBLICAS = ['/login', '/offline'];

export async function proxy(request: NextRequest) {
  let respuesta = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (lista) => {
        for (const { name, value } of lista) request.cookies.set(name, value);
        respuesta = NextResponse.next({ request });
        for (const { name, value, options } of lista) respuesta.cookies.set(name, value, options);
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();

  const ruta = request.nextUrl.pathname;
  const publica = PUBLICAS.some((p) => ruta === p || ruta.startsWith(`${p}/`));
  if (!user && !publica) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = ruta === '/' ? '' : `?volver=${encodeURIComponent(ruta)}`;
    return NextResponse.redirect(url);
  }
  if (user && ruta === '/login') return NextResponse.redirect(new URL('/', request.url));
  return respuesta;
}

export const config = {
  // todo menos estáticos, íconos, manifiesto y service worker
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon|icono-|apple-icon|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|webp|ico)$).*)'],
};
