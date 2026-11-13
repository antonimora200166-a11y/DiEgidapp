'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Icono from './Icono';

type Opcion = { ruta: string; titulo: string; icono: string; grupo: string };

// Menú lateral en iPad horizontal y computador (desde 901 px): todas las pantallas del rol, agrupadas en
// Operación, Gestión, Catálogo y Administración, a un toque. Se pliega a solo íconos y lo recuerda el equipo.
// En el celular y el iPad vertical no se ve: ahí manda la barra de abajo.
export default function MenuLateral({ opciones, grupos }: { opciones: Opcion[]; grupos: string[] }) {
  const ruta = usePathname();
  const [plegado, setPlegado] = useState(false);
  useEffect(() => { try { setPlegado(localStorage.getItem('sgi-menu-plegado') === '1'); } catch { /* nada */ } }, []);
  useEffect(() => { document.documentElement.toggleAttribute('data-menu-plegado', plegado); }, [plegado]);
  const plegar = () => setPlegado((p) => { try { localStorage.setItem('sgi-menu-plegado', p ? '0' : '1'); } catch { /* nada */ } return !p; });
  // la opción activa es la de ruta más larga que coincide (Crear producto antes que Catálogo)
  const activa = opciones.filter((o) => (o.ruta === '/' ? ruta === '/' : ruta === o.ruta || ruta.startsWith(`${o.ruta}/`)))
    .sort((a, b) => b.ruta.length - a.ruta.length)[0]?.ruta
    ?? (ruta.startsWith('/producir') || ruta.startsWith('/fichas') ? '/produccion' : null);

  return (
    <nav className="menu-lateral" aria-label="Todas las pantallas">
      <Link href="/" className="ml-op" aria-current={ruta === '/' ? 'page' : undefined} title="Inicio">
        <Icono nombre="inicio" /><span>Inicio</span>
      </Link>
      {grupos.map((g) => {
        const items = opciones.filter((o) => o.grupo === g);
        if (!items.length) return null;
        return (
          <div key={g} className="ml-grupo">
            <span className="ml-tit">{g}</span>
            {items.map((o) => (
              <Link key={o.ruta} href={o.ruta} className="ml-op" aria-current={activa === o.ruta ? 'page' : undefined} title={o.titulo}>
                <Icono nombre={o.icono} /><span>{o.titulo}</span>
              </Link>
            ))}
          </div>
        );
      })}
      <button type="button" className="ml-plegar" onClick={plegar} aria-pressed={plegado}
              aria-label={plegado ? 'Mostrar los nombres del menú' : 'Plegar el menú a solo íconos'}>
        <span aria-hidden>{plegado ? '»' : '«'}</span><span>{plegado ? '' : 'Plegar menú'}</span>
      </button>
    </nav>
  );
}
