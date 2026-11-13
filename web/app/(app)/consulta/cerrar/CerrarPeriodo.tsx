'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cerrarPeriodo, type Cierre } from './acciones';
import { confirmar } from '@/components/Dialogo';
import { pesos, pct, fecha } from '@/lib/formato';

// cifras del período abierto, en vivo, para mostrar qué se va a congelar (CIE-02)
export type ResumenAbierto = { ventas_netas: number; cmv_real: number; cmv_teorico: number; pct_real: number | null; pct_teorico: number | null; perdidas: number; no_explicado: number } | null;

// Administración cierra el período después del conteo de cierre del jefe de bar (decisión 07/11/2026).
export default function CerrarPeriodo({ area, desde, hastaSugerido, desdeFijo, resumen = null }: { area: 'BAR' | 'COCINA'; desde: string; hastaSugerido: string; desdeFijo: boolean; resumen?: ResumenAbierto }) {
  const router = useRouter();
  const [d, setD] = useState(desde);
  const [h, setH] = useState(hastaSugerido);
  const [nota, setNota] = useState('');
  const [motivo, setMotivo] = useState('');
  const [r, setR] = useState<Cierre | null>(null);
  const [enviando, iniciar] = useTransition();
  // un cierre no se deshace: antes se muestra qué queda congelado
  async function confirmarCierre(forzar: boolean) {
    const cifras = resumen ? [
      `Ventas netas: ${pesos(resumen.ventas_netas)}`,
      `Costo real: ${pesos(resumen.cmv_real)} (${pct(resumen.pct_real)})`,
      `Costo teórico: ${pesos(resumen.cmv_teorico)} (${pct(resumen.pct_teorico)})`,
      `Pérdidas reportadas: ${pesos(resumen.perdidas)}`,
      `No explicado: ${pesos(resumen.no_explicado)}`,
    ].join('\n') + '\n\n(cifras de hoy; al cerrar se recalculan con las fechas elegidas)\n\n' : '';
    if (await confirmar(`${cifras}Se cierra ${area === 'BAR' ? 'bar' : 'cocina'} del ${fecha(d)} al ${fecha(h)}. Las cifras y el costo de cada ficha quedan congelados: un período cerrado no se edita.`,
      { titulo: '¿Cerrar el período?', aceptar: 'Cerrar el período', peligro: true })) cerrar(forzar);
  }
  const cerrar = (forzar: boolean) => iniciar(async () => {
    const x = await cerrarPeriodo({ area, desde: d, hasta: h, nota, forzar, motivo });
    setR(x);
    if (x.ok) router.push(`/consulta?area=${area}`);
  });
  return (
    <section className="tarjeta" style={{ display: 'grid', gap: '.6rem' }}>
      <div className="fila">
        <label className="m-0">Desde<span className="ayuda">{desdeFijo ? 'El día siguiente al último cierre.' : 'El primer día con kardex.'}</span>
          <input type="date" value={d} onChange={(e) => setD(e.target.value)} disabled={desdeFijo} /></label>
        <label className="m-0">Hasta<span className="ayuda">El día del conteo de cierre.</span>
          <input type="date" value={h} onChange={(e) => setH(e.target.value)} /></label>
      </div>
      <label className="m-0">Nota (opcional)<input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: quincena 1–15 de noviembre" /></label>
      {r && !r.ok && (
        <div className="aviso m-0">
          {r.error}
          {r.faltan?.length ? <ul>{r.faltan.map((z) => <li key={z}>{z}</li>)}</ul> : null}
          {r.faltan?.length ? (
            <div className="mt-2">
              <label className="m-0">Cerrar de todas formas: motivo<input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por qué se cierra sin contar esas zonas" /></label>
              <button type="button" className="secundario mt-1" disabled={enviando || !motivo.trim()} onClick={() => confirmarCierre(true)}>Cerrar sin el conteo completo</button>
            </div>
          ) : null}
        </div>
      )}
      <div className="acciones m-0">
        <button aria-busy={enviando} type="button" disabled={enviando || !d || !h} onClick={() => confirmarCierre(false)}>{enviando ? 'Cerrando…' : 'Cerrar el período'}</button>
      </div>
      <p className="suave" style={{ fontSize: '.85rem', margin: 0 }}>Al cerrar se guardan las cifras y el costo de cada ficha tal como están hoy: si después cambian los precios, el período no cambia.
        Un período cerrado no se edita.</p>
    </section>
  );
}
