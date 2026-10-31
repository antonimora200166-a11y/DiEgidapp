import Link from 'next/link';
import { perfilActual } from '@/lib/sesion';
import { areasDe, menuDe } from '@/lib/roles';
import Icono from '@/components/Icono';

export default async function Inicio() {
  const perfil = await perfilActual();
  const menu = menuDe(perfil);
  const areas = areasDe(perfil);
  return (
    <>
      <h1>Hola, {perfil.nombre.split(' ')[0]}</h1>
      {areas.length > 0 && <p className="suave">Operas en: {areas.map((a) => (a === 'BAR' ? 'Bar' : 'Cocina')).join(' y ')}.</p>}
      {menu.length ? (
        <nav className="menu">
          {menu.map((o) => (
            <Link key={o.ruta} href={o.ruta} className="tarjeta">
              <Icono nombre={o.icono} className="icono-menu" />
              <span><strong>{o.titulo}</strong><span>{o.detalle}</span></span>
            </Link>
          ))}
        </nav>
      ) : (
        <p className="tarjeta">Todavía no hay pantallas para tu rol. Las de servicio llegan con la carta y las fichas.</p>
      )}
    </>
  );
}
