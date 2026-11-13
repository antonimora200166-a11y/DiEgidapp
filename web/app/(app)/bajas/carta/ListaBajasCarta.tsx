'use client';
import { useState, useTransition } from 'react';
import { registrarCobro } from './acciones';
import { pesos, fecha } from '@/lib/formato';

export type FilaBajaCarta = {
  baja_id: string; codigo: string; area: 'BAR' | 'COCINA'; fecha: string; tipo: 'CORTESIA' | 'MAL_HECHO'; producto: string; unidades: number;
  autorizado_por: string | null; responsable_id: string | null; responsable: string | null; a_cargo: boolean; costo_mp: number | null;
  costo_estimado: boolean; estado_cobro: 'NO_APLICA' | 'PENDIENTE' | 'DESCONTADO' | 'CONDONADO'; cobro_nota: string | null; cobro_por: string | null;
  cobro_en: string | null; observaciones: string | null; registrado_por: string | null; forzada: boolean; anulada: boolean;
};

const ESTADO: Record<string, { t: string; c: string }> = {
  PENDIENTE: { t: 'por cobrar', c: 'provisional' }, DESCONTADO: { t: 'descontado', c: 'validado' }, CONDONADO: { t: 'condonado', c: 'inactivo' },
};

function Cobro({ f }: { f: FilaBajaCarta }) {
  const [nota, setNota] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, start] = useTransition();
  const marcar = (estado: 'DESCONTADO' | 'CONDONADO' | 'PENDIENTE') => start(async () => {
    setMsg(null);
    const r = await registrarCobro({ baja_id: f.baja_id, estado, nota });
    if (!r.ok) setMsg(r.error ?? 'No se pudo.');
  });
  return (
    <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '.4rem' }}>
      <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder={f.estado_cobro === 'PENDIENTE' ? 'Nota (obligatoria para condonar)' : 'Por qué vuelve a pendiente'}
             style={{ flex: '1 1 180px', minHeight: 34 }} />
      {f.estado_cobro === 'PENDIENTE' ? <>
        <button type="button" className="mini" disabled={pend} onClick={() => marcar('DESCONTADO')}>Descontado</button>
        <button type="button" className="mini secundario" disabled={pend} onClick={() => marcar('CONDONADO')}>Condonar</button>
      </> : <button type="button" className="mini secundario" disabled={pend} onClick={() => marcar('PENDIENTE')}>Volver a pendiente</button>}
      {msg && <span role="alert" style={{ color: 'var(--error)', fontSize: '.88rem' }}>{msg}</span>}
    </div>
  );
}

export default function ListaBajasCarta({ filas, esAdmin }: { filas: FilaBajaCarta[]; esAdmin: boolean }) {
  const [solo, setSolo] = useState<'TODO' | 'PENDIENTE'>(esAdmin && filas.some((f) => f.estado_cobro === 'PENDIENTE' && !f.anulada) ? 'PENDIENTE' : 'TODO');
  const vigentes = filas.filter((f) => !f.anulada);
  const pendientes = vigentes.filter((f) => f.estado_cobro === 'PENDIENTE');
  // por persona: lo que tiene pendiente por responder
  const porPersona = new Map<string, { nombre: string; total: number; n: number }>();
  for (const f of pendientes) {
    const k = f.responsable_id ?? '';
    const x = porPersona.get(k) ?? { nombre: f.responsable ?? '—', total: 0, n: 0 };
    x.total += Number(f.costo_mp ?? 0); x.n += 1; porPersona.set(k, x);
  }
  const lista = solo === 'PENDIENTE' ? pendientes : filas;
  const totalCortesias = vigentes.filter((f) => f.tipo === 'CORTESIA').reduce((s, f) => s + Number(f.costo_mp ?? 0), 0);
  const totalMal = vigentes.filter((f) => f.tipo === 'MAL_HECHO').reduce((s, f) => s + Number(f.costo_mp ?? 0), 0);

  return (
    <section>
      <h2>Registrados</h2>
      {esAdmin && vigentes.length > 0 && (
        <div className="cifras">
          <div className="cifra"><span>Cortesías</span><b>{pesos(totalCortesias)}</b><small>{vigentes.filter((f) => f.tipo === 'CORTESIA').length} registros</small></div>
          <div className="cifra"><span>Mal hechos</span><b>{pesos(totalMal)}</b><small>{vigentes.filter((f) => f.tipo === 'MAL_HECHO').length} registros</small></div>
          <div className="cifra sa"><span>Por cobrar</span><b>{pesos(pendientes.reduce((s, f) => s + Number(f.costo_mp ?? 0), 0))}</b><small>{pendientes.length} pendientes</small></div>
        </div>)}
      {esAdmin && porPersona.size > 0 && (
        <table className="tabla" style={{ marginBottom: '1rem' }}>
          <thead><tr><th>Responsable</th><th style={{ textAlign: 'right' }}>Pendientes</th><th style={{ textAlign: 'right' }}>Por cobrar</th></tr></thead>
          <tbody>{[...porPersona.values()].sort((a, b) => b.total - a.total).map((p) => (
            <tr key={p.nombre}><td>{p.nombre}</td><td style={{ textAlign: 'right' }}>{p.n}</td><td style={{ textAlign: 'right' }}>{pesos(p.total)}</td></tr>))}</tbody>
        </table>)}
      {esAdmin && pendientes.length > 0 && (
        <div className="chips-sel" style={{ marginBottom: '.6rem' }}>
          <button type="button" aria-pressed={solo === 'PENDIENTE'} onClick={() => setSolo('PENDIENTE')}>Por cobrar ({pendientes.length})</button>
          <button type="button" aria-pressed={solo === 'TODO'} onClick={() => setSolo('TODO')}>Todos ({filas.length})</button>
        </div>)}
      {lista.length === 0 ? <p className="suave">Nada registrado todavía.</p> : (
        <ul className="lista">
          {lista.map((f) => (
            <li key={f.baja_id} className="tarjeta" style={{ padding: '.7rem .85rem', display: 'block', opacity: f.anulada ? .55 : 1 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', alignItems: 'baseline' }}>
                <strong>{Number(f.unidades).toLocaleString('es-CO')} × {f.producto}</strong>
                <span className="etiqueta">{f.tipo === 'CORTESIA' ? 'cortesía' : 'mal hecho'}</span>
                {f.a_cargo && ESTADO[f.estado_cobro] && <span className={`etiqueta ${ESTADO[f.estado_cobro].c}`}>{ESTADO[f.estado_cobro].t}</span>}
                {f.forzada && <span className="etiqueta provisional">forzada</span>}
                {f.anulada && <span className="etiqueta inactivo">anulada</span>}
                <small className="suave" style={{ marginLeft: 'auto' }}><span className="cod">{f.codigo}</span> · {fecha(f.fecha)}</small>
              </div>
              <div className="suave" style={{ fontSize: '.88rem', marginTop: '.2rem' }}>
                {f.autorizado_por && <>Autorizó {f.autorizado_por} · </>}
                {f.responsable && <>Responsable {f.responsable}{f.a_cargo ? ' (responde por el costo)' : ''} · </>}
                Registró {f.registrado_por ?? '—'}
                {esAdmin && <> · costo {pesos(f.costo_mp)}{f.costo_estimado ? ' (estimado)' : ''}</>}
              </div>
              {f.observaciones && <div style={{ fontSize: '.88rem' }}>{f.observaciones}</div>}
              {f.cobro_en && <div className="suave" style={{ fontSize: '.85rem' }}>{ESTADO[f.estado_cobro]?.t ?? f.estado_cobro} por {f.cobro_por ?? '—'}{f.cobro_nota ? ` · ${f.cobro_nota}` : ''}</div>}
              {esAdmin && f.a_cargo && !f.anulada && <Cobro f={f} />}
            </li>))}
        </ul>)}
    </section>
  );
}
