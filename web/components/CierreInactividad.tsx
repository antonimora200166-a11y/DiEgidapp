'use client';
import { useEffect, useRef, useState } from 'react';
import { salirPorInactividad } from '@/app/login/acciones';

// Cierra la sesión tras un rato sin tocar la app: en un iPad compartido, lo que se registre
// después no queda a nombre de quien dejó la sesión abierta. Un minuto antes avisa.
// Los borradores (bajas, conteos, recepciones) siguen guardados en el equipo.
const MINUTOS = 15;

export default function CierreInactividad() {
  const ultimo = useRef(0);
  const [quedan, setQuedan] = useState<number | null>(null);
  useEffect(() => {
    ultimo.current = Date.now();
    const tocar = () => { ultimo.current = Date.now(); setQuedan(null); };
    const eventos = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    for (const e of eventos) window.addEventListener(e, tocar, { passive: true });
    const reloj = window.setInterval(() => {
      const resta = MINUTOS * 60_000 - (Date.now() - ultimo.current);
      if (resta <= 0) { window.clearInterval(reloj); void salirPorInactividad(); }
      else setQuedan(resta <= 60_000 ? Math.ceil(resta / 1000) : null);
    }, 1000);
    return () => { for (const e of eventos) window.removeEventListener(e, tocar); window.clearInterval(reloj); };
  }, []);
  if (quedan === null) return null;
  return (
    <div className="aviso" role="alert" style={{ position: 'fixed', left: 16, right: 16, bottom: 90, zIndex: 50, textAlign: 'center' }}>
      Sin uso: la sesión se cierra en {quedan} s. Toca la pantalla para seguir.
    </div>
  );
}
