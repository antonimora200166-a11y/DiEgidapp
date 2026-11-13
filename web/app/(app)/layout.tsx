import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { navDe, nombreRol } from '@/lib/roles';
import { Dialogos } from '@/components/Dialogo';
import Icono from '@/components/Icono';
import NavInferior from '@/components/NavInferior';
import CierreInactividad from '@/components/CierreInactividad';
import { BotonTema, TemaDelRol } from '@/components/Tema';

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const perfil = await perfilActual();
  // contraseña puesta por administración: primero una propia
  const ruta = (await headers()).get('x-ruta') ?? '';
  if (perfil.debe_cambiar_clave && ruta !== '/cuenta') redirect('/cuenta');
  const nav = navDe(perfil);
  return (
    <>
      <TemaDelRol oscuro={perfil.rol === 'jefe_bar' || perfil.rol === 'aux_bar'} />
      <header className="barra">
        <Link href="/">SGI Di Égida</Link>
        {/* Salir está en Mi cuenta: en la cabecera se tocaba sin querer */}
        <div className="barra-der">
          <BotonTema />
          <Link href="/cuenta" className="quien" title="Mi cuenta">
            <span>{perfil.nombre}<br /><small>{nombreRol(perfil.rol)}</small></span>
            <Icono nombre="cuenta" />
          </Link>
        </div>
      </header>
      <main className="contenido">{children}</main>
      <NavInferior principales={nav.principales} resto={nav.resto} />
      <Dialogos />
      <CierreInactividad />
    </>
  );
}
