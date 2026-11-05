'use client';
import { useEffect, useState } from 'react';

// Pestañas simples; la elegida queda en la dirección (#repetidos) para volver a ella.
export default function Pestanas({ pestanas }: { pestanas: { clave: string; titulo: string; contenido: React.ReactNode }[] }) {
  const [activa, setActiva] = useState(pestanas[0].clave);
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (pestanas.some((p) => p.clave === h)) setActiva(h);
  }, [pestanas]);
  return (
    <>
      <div className="pagina-ancha" role="tablist" style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', margin: '.4rem 0 .8rem' }}>
        {pestanas.map((p) => (
          <button key={p.clave} type="button" role="tab" aria-selected={activa === p.clave}
                  className={activa === p.clave ? '' : 'secundario'}
                  onClick={() => { setActiva(p.clave); history.replaceState(null, '', `#${p.clave}`); }}>
            {p.titulo}
          </button>
        ))}
      </div>
      {pestanas.find((p) => p.clave === activa)?.contenido}
    </>
  );
}
