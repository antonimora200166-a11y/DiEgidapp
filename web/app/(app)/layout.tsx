import Link from 'next/link';
import { perfilActual } from '@/lib/sesion';
import { nombreRol } from '@/lib/roles';
import { salir } from '../login/acciones';

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const perfil = await perfilActual();
  return (
    <>
      <header className="barra">
        <Link href="/">SGI Di Égida</Link>
        <form action={salir} style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
          <span className="quien">{perfil.nombre}<br />{nombreRol(perfil.rol)}</span>
          <button type="submit" className="secundario" style={{ color: 'inherit', borderColor: 'currentColor' }}>Salir</button>
        </form>
      </header>
      <main className="contenido">{children}</main>
    </>
  );
}
