'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cerrarPeriodo, type Cierre } from './acciones';

// Administración cierra el período después del conteo de cierre del jefe de bar (decisión 07/11/2026).
export default function CerrarPeriodo({ area, desde, hastaSugerido, desdeFijo }: { area: 'BAR' | 'COCINA'; desde: string; hastaSugerido: string; desdeFijo: boolean }) {
  const router = useRouter();
  const [d, setD] = useState(desde);
  const [h, setH] = useState(hastaSugerido);
  const [nota, setNota] = useState('');
  const [motivo, setMotivo] = useState('');
  const [r, setR] = useState<Cierre | null>(null);
  const [enviando, iniciar] = useTransition();
  const cerrar = (forzar: boolean) => iniciar(async () => {
    const x = await cerrarPeriodo({ area, desde: d, hasta: h, nota, forzar, motivo });
    setR(x);
    if (x.ok) router.push(`/consulta?area=${area}`);
  });
  return (
    <section className="tarjeta" style={{ display: 'grid', gap: '.6rem' }}>
      <div className="fila">
        <label style={{ margin: 0 }}>Desde<span className="ayuda">{desdeFijo ? 'El día siguiente al último cierre.' : 'El primer día con kardex.'}</span>
          <input type="date" value={d} onChange={(e) => setD(e.target.value)} disabled={desdeFijo} /></label>
        <label style={{ margin: 0 }}>Hasta<span className="ayuda">El día del conteo de cierre.</span>
          <input type="date" value={h} onChange={(e) => setH(e.target.value)} /></label>
      </div>
      <label style={{ margin: 0 }}>Nota (opcional)<input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: quincena 1–15 de noviembre" /></label>
      {r && !r.ok && (
        <div className="aviso" style={{ margin: 0 }}>
          {r.error}
          {r.faltan?.length ? <ul>{r.faltan.map((z) => <li key={z}>{z}</li>)}</ul> : null}
          {r.faltan?.length ? (
            <div style={{ marginTop: '.5rem' }}>
              <label style={{ margin: 0 }}>Cerrar de todas formas: motivo<input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por qué se cierra sin contar esas zonas" /></label>
              <button type="button" className="secundario" style={{ marginTop: '.4rem' }} disabled={enviando || !motivo.trim()} onClick={() => cerrar(true)}>Cerrar sin el conteo completo</button>
            </div>
          ) : null}
        </div>
      )}
      <div className="acciones" style={{ margin: 0 }}>
        <button type="button" disabled={enviando || !d || !h} onClick={() => cerrar(false)}>{enviando ? 'Cerrando…' : 'Cerrar el período'}</button>
      </div>
      <p className="suave" style={{ fontSize: '.85rem', margin: 0 }}>Al cerrar se guardan las cifras y el costo de cada ficha tal como están hoy: si después cambian los precios, el período no cambia.
        Un período cerrado no se edita.</p>
    </section>
  );
}
