'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import Icono from './Icono';

type Principal = { ruta: string; titulo: string; icono: string };
type Resto = Principal & { detalle: string };

// Barra fija abajo en el celular y el iPad vertical: Inicio, las tres pantallas de todos los días del rol
// y «Más», que abre una hoja con las demás. Máximo cinco botones, al alcance del pulgar.
export default function NavInferior({ principales, resto }: { principales: Principal[]; resto: Resto[] }) {
  const ruta = usePathname();
  const hoja = useRef<HTMLDialogElement>(null);
  const activa = (r: string) => (r === '/' ? ruta === '/' : ruta === r || ruta.startsWith(`${r}/`));
  const enResto = resto.some((o) => activa(o.ruta)) && !principales.some((o) => o.ruta !== '/' && activa(o.ruta));
  useEffect(() => { hoja.current?.close(); }, [ruta]);   // al navegar, la hoja se cierra
  return (
    <>
      <nav className="nav-inferior" aria-label="Pantallas principales">
        {principales.map((o) => (
          <Link key={o.ruta} href={o.ruta} aria-current={activa(o.ruta) ? 'page' : undefined}>
            <Icono nombre={o.icono} />
            <span>{o.titulo}</span>
          </Link>
        ))}
        {resto.length > 0 && (
          <button type="button" className="nav-mas" aria-haspopup="dialog" aria-current={enResto ? 'page' : undefined}
                  onClick={() => hoja.current?.showModal()}>
            <Icono nombre="mas" />
            <span>Más</span>
          </button>
        )}
      </nav>
      {resto.length > 0 && (
        <dialog ref={hoja} className="dialogo hoja-mas" aria-label="Más pantallas"
                onClick={(e) => { if (e.target === hoja.current) hoja.current?.close(); }}>
          <div className="hoja-mas-cab">
            <strong>Más pantallas</strong>
            <button type="button" className="discreto" onClick={() => hoja.current?.close()} aria-label="Cerrar">✕</button>
          </div>
          <ul>
            {resto.map((o) => (
              <li key={o.ruta}>
                <Link href={o.ruta} aria-current={activa(o.ruta) ? 'page' : undefined}>
                  <Icono nombre={o.icono} className="icono-menu" />
                  <span><strong>{o.titulo}</strong><small>{o.detalle}</small></span>
                </Link>
              </li>
            ))}
          </ul>
        </dialog>
      )}
    </>
  );
}
