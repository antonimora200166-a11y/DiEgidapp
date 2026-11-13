'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import Icono from './Icono';

// «+ Registrar» (INI-04): botón al pulgar para el personal de operación. Abre una hoja con lo que se registra
// a diario (Recibir, Producir, Reportar pérdida, Trasladar): cualquier registro en 2 toques desde donde esté.
// No aparece donde ya hay una barra de guardar abajo (CSS), para no tapar la acción principal.
const OPCIONES = [
  { ruta: '/recibir', t: 'Recibir', d: 'Mercancía de un proveedor', icono: 'recibir' },
  { ruta: '/producir', t: 'Producir', d: 'Un lote de MPI', icono: 'producir' },
  { ruta: '/bajas', t: 'Reportar pérdida', d: 'Lo que se dañó, venció o se regaló', icono: 'bajas' },
  { ruta: '/trasladar', t: 'Trasladar', d: 'De una zona a otra', icono: 'trasladar' },
];

export default function BotonRegistrar({ rutas }: { rutas: string[] }) {
  const ruta = usePathname();
  const hoja = useRef<HTMLDialogElement>(null);
  useEffect(() => { hoja.current?.close(); }, [ruta]);
  const opciones = OPCIONES.filter((o) => rutas.includes(o.ruta === '/producir' ? '/produccion' : o.ruta));
  if (!opciones.length) return null;
  return (
    <>
      <button type="button" className="boton-registrar" aria-haspopup="dialog" onClick={() => hoja.current?.showModal()}>
        <Icono nombre="nuevo" /><span>Registrar</span>
      </button>
      <dialog ref={hoja} className="dialogo hoja-mas" aria-label="Registrar"
              onClick={(e) => { if (e.target === hoja.current) hoja.current?.close(); }}>
        <div className="hoja-mas-cab">
          <strong>¿Qué va a registrar?</strong>
          <button type="button" className="discreto" onClick={() => hoja.current?.close()} aria-label="Cerrar">✕</button>
        </div>
        <ul>
          {opciones.map((o) => (
            <li key={o.ruta}>
              <Link href={o.ruta}>
                <Icono nombre={o.icono} className="icono-menu" />
                <span><strong>{o.t}</strong><small>{o.d}</small></span>
              </Link>
            </li>
          ))}
        </ul>
      </dialog>
    </>
  );
}
