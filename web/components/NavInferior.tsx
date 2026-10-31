'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icono from './Icono';

// Barra fija abajo en el celular: las pantallas de todos los días a un toque. Lo demás, en Inicio.
export default function NavInferior({ opciones }: { opciones: { ruta: string; titulo: string; icono: string }[] }) {
  const ruta = usePathname();
  const activa = (r: string) => (r === '/' ? ruta === '/' : ruta === r || ruta.startsWith(`${r}/`));
  return (
    <nav className="nav-inferior" aria-label="Pantallas principales">
      {opciones.map((o) => (
        <Link key={o.ruta} href={o.ruta} aria-current={activa(o.ruta) ? 'page' : undefined}>
          <Icono nombre={o.icono} />
          <span>{o.titulo}</span>
        </Link>
      ))}
    </nav>
  );
}
