import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { navDe, nombreRol, menuDe, grupoDe, GRUPOS_MENU } from '@/lib/roles';
import MenuLateral from '@/components/MenuLateral';
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
  const lateral = menuDe(perfil).map((o) => ({ ruta: o.ruta, titulo: o.titulo, icono: o.icono, grupo: grupoDe(o.ruta) }));
  return (
    <>
      <TemaDelRol oscuro={perfil.rol === 'jefe_bar' || perfil.rol === 'aux_bar'} />
      <header className="barra">
        <Link href="/" className="marca" aria-label="Di Égida · Inicio">
          <span className="monograma" aria-hidden>D·É</span>
          <span className="marca-txt"><strong>Di Égida</strong><small>Tosca Bistró · SGI</small></span>
        </Link>
        {/* Salir está en Mi cuenta: en la cabecera se tocaba sin querer */}
        <div className="barra-der">
          <BotonTema />
          <Link href="/cuenta" className="quien" title="Mi cuenta">
            <span>{perfil.nombre}<br /><small>{nombreRol(perfil.rol)}</small></span>
            <Icono nombre="cuenta" />
          </Link>
        </div>
      </header>
      <MenuLateral opciones={lateral} grupos={GRUPOS_MENU} />
      <main className="contenido">{children}</main>
      <NavInferior principales={nav.principales} resto={nav.resto} />
      <Dialogos />
      <CierreInactividad />
    </>
  );
}
