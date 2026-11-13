'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { decidirPropuesta } from './acciones';
import { pesos, pct, fecha } from '@/lib/formato';

export type Propuesta = {
  id: string; codigo: string; generico_id: string; nombre: string; area: 'BAR' | 'COCINA'; precio_actual: number | null; precio_nuevo: number;
  costo_actual: number | null; costo_nuevo: number | null; pct_actual: number | null; pct_nuevo: number | null;
  cambios: { generico_id: string; nombre: string; unidad: string; cantidad_actual: number; cantidad_nueva: number }[];
  resultado: { area?: { pct_actual: number | null; pct_nuevo: number | null; dif_margen: number } | null };
  nota: string | null; estado: 'PROPUESTA' | 'APROBADA' | 'DESCARTADA'; creada_por: string | null; creada_en: string;
  decidida_por: string | null; decidida_en: string | null; motivo: string | null; precio_aplicado: boolean; precio_hoy: number | null;
};


function Decidir({ p }: { p: Propuesta }) {
  const [aplicar, setAplicar] = useState(p.precio_nuevo !== p.precio_actual);
  const [motivo, setMotivo] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, start] = useTransition();
  const decidir = (decision: 'APROBAR' | 'DESCARTAR') => start(async () => {
    setMsg(null);
    const r = await decidirPropuesta({ id: p.id, decision, motivo, aplicar_precio: aplicar });
    if (!r.ok) setMsg(r.error ?? 'No se pudo.');
  });
  const precioCambia = p.precio_nuevo !== p.precio_actual;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'center', marginTop: '.5rem' }}>
      {precioCambia && (
        <label style={{ display: 'flex', gap: '.35rem', alignItems: 'center', fontSize: '.9rem' }}>
          <input type="checkbox" checked={aplicar} onChange={(e) => setAplicar(e.target.checked)} style={{ width: 'auto', minHeight: 0 }} />
          Al aprobar, poner {pesos(p.precio_nuevo)} en la carta desde hoy
        </label>)}
      <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (obligatorio para descartar)" style={{ flex: '1 1 200px', minHeight: 36 }} />
      <button type="button" className="chico" disabled={pend} onClick={() => decidir('APROBAR')}>Aprobar</button>
      <button type="button" className="chico secundario peligro" disabled={pend} onClick={() => decidir('DESCARTAR')}>Descartar</button>
      {msg && <span role="alert" style={{ color: 'var(--error)', fontSize: '.9rem' }}>{msg}</span>}
    </div>
  );
}

export default function Propuestas({ propuestas }: { propuestas: Propuesta[] }) {
  const [verTodas, setVerTodas] = useState(false);
  const abiertas = propuestas.filter((p) => p.estado === 'PROPUESTA');
  const lista = verTodas ? propuestas : abiertas;
  return (
    <section>
      <h2>Propuestas {abiertas.length ? `(${abiertas.length} sin decidir)` : ''}</h2>
      {propuestas.length > abiertas.length && (
        <button type="button" className="discreto chico" onClick={() => setVerTodas((v) => !v)}>
          {verTodas ? 'Ver solo las que faltan por decidir' : `Ver también las decididas (${propuestas.length - abiertas.length})`}</button>)}
      {lista.length === 0 ? <p className="suave">No hay propuestas {verTodas ? '' : 'sin decidir'}.</p> : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '.6rem' }}>
          {lista.map((p) => (
            <li key={p.id} className="tarjeta" style={{ padding: '.75rem .9rem' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', alignItems: 'baseline' }}>
                <strong>{p.codigo} · <Link href={`/consulta/simulador?producto=${p.generico_id}`}>{p.nombre}</Link></strong>
                <span className={`etiqueta ${p.estado === 'APROBADA' ? 'validado' : p.estado === 'DESCARTADA' ? 'inactivo' : 'provisional'}`}>
                  {p.estado === 'PROPUESTA' ? 'sin decidir' : p.estado.toLowerCase()}</span>
                <small className="suave ml-auto">{p.creada_por ?? '—'} · {fecha(p.creada_en)}</small>
              </div>
              <div style={{ fontSize: '.92rem', marginTop: '.3rem' }}>
                {p.precio_nuevo !== p.precio_actual && <>Precio {pesos(p.precio_actual)} → <b>{pesos(p.precio_nuevo)}</b> · </>}
                % costo {pct(p.pct_actual)} → <b>{pct(p.pct_nuevo)}</b>
                {p.resultado?.area && <> · área {pct(p.resultado.area.pct_actual)} → {pct(p.resultado.area.pct_nuevo)}
                  {' '}({p.resultado.area.dif_margen >= 0 ? '+' : '−'}{pesos(Math.abs(p.resultado.area.dif_margen))} de margen en el período)</>}
              </div>
              {p.cambios.length > 0 && (
                <div className="suave texto-nota">Receta: {p.cambios.map((c) =>
                  `${c.nombre} ${Number(c.cantidad_actual).toLocaleString('es-CO')} → ${Number(c.cantidad_nueva).toLocaleString('es-CO')} ${c.unidad}`).join(' · ')}</div>)}
              {p.nota && <div className="texto-nota">«{p.nota}»</div>}
              {p.estado === 'PROPUESTA' ? <Decidir p={p} /> : (
                <div className="suave" style={{ fontSize: '.88rem', marginTop: '.3rem' }}>
                  {p.estado === 'APROBADA' ? 'Aprobada' : 'Descartada'} por {p.decidida_por ?? '—'}{p.decidida_en ? ` el ${fecha(p.decidida_en)}` : ''}
                  {p.motivo ? ` · ${p.motivo}` : ''}
                  {p.estado === 'APROBADA' && (p.precio_aplicado ? ' · el precio ya está en la carta' : p.precio_nuevo !== p.precio_actual ? ' · el precio no se aplicó' : '')}
                  {p.estado === 'APROBADA' && p.cambios.length > 0 && <> · <Link href={`/fichas/${p.generico_id}`}>falta la versión nueva de la ficha</Link></>}
                </div>)}
            </li>))}
        </ul>)}
    </section>
  );
}
