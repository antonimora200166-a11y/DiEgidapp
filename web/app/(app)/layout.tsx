import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { nombreRol } from '@/lib/roles';
import { salir } from '../login/acciones';

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const perfil = await perfilActual();
  // contraseña puesta por administración: primero una propia
  const ruta = (await headers()).get('x-ruta') ?? '';
  if (perfil.debe_cambiar_clave && ruta !== '/cuenta') redirect('/cuenta');
  return (
    <>
      <header className="barra">
        <Link href="/">SGI Di Égida</Link>
        <form action={salir} style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
          <Link href="/cuenta" className="quien" title="Mi cuenta">{perfil.nombre}<br />{nombreRol(perfil.rol)}</Link>
          <button type="submit" className="secundario" style={{ color: 'inherit', borderColor: 'currentColor' }}>Salir</button>
        </form>
      </header>
      <main className="contenido">{children}</main>
    </>
  );
}
