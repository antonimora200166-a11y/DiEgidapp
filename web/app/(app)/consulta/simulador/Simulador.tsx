'use client';
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { simular, type MezclaSim, type ProductoSim, type Semaforo } from '@/lib/simulador';
import { guardarPropuesta } from './acciones';
import { pesos, pct } from '@/lib/formato';

const CLASE: Record<string, string> = { VERDE: ' sv', AMARILLO: ' sa', ROJO: ' sr' };
const cls = (s: Semaforo) => CLASE[s ?? ''] ?? '';
const num = (s: string) => { const n = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

type Prod = { generico_id: string; nombre: string; area: 'BAR' | 'COCINA'; seccion: string | null; estado_ficha: string };

function Dif({ antes, ahora, inverso = false, unidad }: { antes: number | null; ahora: number | null; inverso?: boolean; unidad: 'pts' | '$' }) {
  if (antes == null || ahora == null || antes === ahora) return null;
  const d = ahora - antes, bueno = inverso ? d < 0 : d > 0;
  return <small style={{ color: bueno ? 'var(--ok)' : 'var(--error)', display: 'block' }}>
    {d > 0 ? '+' : '−'}{unidad === '$' ? pesos(Math.abs(d)) : `${Math.abs(d).toLocaleString('es-CO', { maximumFractionDigits: 1 })} pts`}</small>;
}

export default function Simulador({ producto, base, mezcla, desde, hasta }: { producto: Prod; base: ProductoSim; mezcla: MezclaSim | null; desde: string; hasta: string }) {
  const [precio, setPrecio] = useState(base.precio ? String(base.precio) : '');
  const [cant, setCant] = useState<Record<string, string>>({});
  const [unidades, setUnidades] = useState('');
  const [nota, setNota] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pend, start] = useTransition();

  const cantidades = useMemo(() => {
    const c: Record<string, number> = {};
    for (const [k, v] of Object.entries(cant)) { const n = num(v); if (n != null && n >= 0) c[k] = n; }
    return c;
  }, [cant]);
  const precioN = num(precio);
  const uN = unidades.trim() === '' ? null : num(unidades);
  const r = simular(base, { precio_nuevo: precioN, cantidades, unidades_nuevas: uN }, mezcla);
  const sinCosto = base.lineas.length === 0 || base.lineas.some((l) => l.costo == null);
  const pagadas = mezcla ? mezcla.unidades - mezcla.unidades_sin_valor : 0;
  const cambio = (precioN != null && precioN !== base.precio) || Object.entries(cantidades).some(([k, v]) => base.lineas.find((l) => l.generico_id === k)?.cantidad !== v);

  function guardar() {
    setMsg(null);
    start(async () => {
      const res = await guardarPropuesta({ generico_id: producto.generico_id, precio_nuevo: precioN, cantidades, unidades_nuevas: uN, nota, desde, hasta });
      setMsg(res.ok ? { ok: true, texto: `Propuesta ${res.codigo} guardada. Apruébala o descártala abajo.` } : { ok: false, texto: res.error ?? 'No se pudo guardar.' });
      if (res.ok) setNota('');
    });
  }

  return (
    <section className="tarjeta" style={{ marginBottom: '1.2rem' }}>
      <h2 style={{ marginTop: 0 }}>{producto.nombre}</h2>
      <p className="suave" style={{ marginTop: '-.4rem', fontSize: '.88rem' }}>
        {producto.area === 'BAR' ? 'Bar' : 'Cocina'} · {producto.seccion ?? 'sin sección'} · meta {base.meta_pct ?? '—'} %
        {base.banda_pp ? ` (amarillo hasta ${(base.meta_pct ?? 0) + base.banda_pp} %)` : ''} · <Link href={`/fichas/${producto.generico_id}`}>Abrir la ficha</Link>
      </p>
      {sinCosto && <p className="aviso">La ficha {producto.estado_ficha === 'SIN_FICHA' ? 'no existe' : 'tiene ingredientes sin costo'}: se puede simular el precio, pero no hay % de costo hasta completarla.</p>}

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <div>
          <label>Precio de carta con impuesto
            <input inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value)} />
          </label>
          <p style={{ fontSize: '.85rem', margin: '.3rem 0' }} className="suave">
            Hoy {pesos(base.precio)}.{' '}
            {r.precio_para_meta != null && (
              <button type="button" className="mini secundario" onClick={() => setPrecio(String(r.precio_para_meta))}>
                Precio para la meta: {pesos(r.precio_para_meta)}</button>)}
          </p>
          {mezcla && (
            <label style={{ marginTop: '.6rem', display: 'block' }}>Unidades esperadas en el período
              <input inputMode="numeric" placeholder={`igual: ${mezcla.unidades.toLocaleString('es-CO')}`} value={unidades} onChange={(e) => setUnidades(e.target.value)} />
              <small className="suave">Vendidas {pagadas.toLocaleString('es-CO')}{mezcla.unidades_sin_valor ? ` + ${mezcla.unidades_sin_valor.toLocaleString('es-CO')} a $0` : ''}.
                Déjalo vacío si crees que el precio nuevo no cambia lo que se vende.</small>
            </label>)}
        </div>
        <div>
          <strong style={{ fontSize: '.9rem' }}>Receta (cantidad por unidad vendida)</strong>
          {base.lineas.length === 0 ? <p className="suave">Sin ficha.</p> : (
            <table className="tabla" style={{ fontSize: '.9rem' }}>
              <thead><tr><th>Ingrediente</th><th style={{ textAlign: 'right' }}>Hoy</th><th style={{ textAlign: 'right' }}>Nueva</th><th style={{ textAlign: 'right' }}>Costo</th></tr></thead>
              <tbody>{base.lineas.map((l) => {
                const n = cantidades[l.generico_id];
                const costo = l.costo == null ? null : n == null ? l.costo : l.cantidad > 0 ? l.costo * n / l.cantidad : 0;
                return (
                  <tr key={l.generico_id}>
                    <td>{l.nombre}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{l.cantidad.toLocaleString('es-CO')} {l.unidad}</td>
                    <td style={{ textAlign: 'right' }}>
                      <input aria-label={`Cantidad nueva de ${l.nombre}`} inputMode="decimal" style={{ width: '5.5rem', minHeight: 34, textAlign: 'right' }}
                             placeholder={l.cantidad.toLocaleString('es-CO')} value={cant[l.generico_id] ?? ''}
                             onChange={(e) => setCant((c) => ({ ...c, [l.generico_id]: e.target.value }))} />
                    </td>
                    <td style={{ textAlign: 'right' }}>{l.costo == null ? <span className="suave">sin costo</span> : pesos(costo)}</td>
                  </tr>);
              })}</tbody>
            </table>)}
        </div>
      </div>

      <h3 style={{ marginBottom: '.4rem' }}>Resultado</h3>
      <div className="cifras">
        <div className="cifra"><span>Costo por unidad</span><b>{pesos(r.costo_nuevo)}</b><small>hoy {pesos(r.costo_actual)}</small>
          <Dif antes={r.costo_actual} ahora={r.costo_nuevo} inverso unidad="$" /></div>
        <div className="cifra"><span>Precio neto</span><b>{pesos(r.neto_nuevo)}</b><small>sin {base.imp_pct} % de impoconsumo</small></div>
        <div className={`cifra${cls(r.semaforo_nuevo)}`}><span>% costo</span><b>{pct(r.pct_nuevo)}</b><small>hoy {pct(r.pct_actual)}</small>
          <Dif antes={r.pct_actual} ahora={r.pct_nuevo} inverso unidad="pts" /></div>
        <div className="cifra"><span>Margen por unidad</span><b>{pesos(r.margen_nuevo)}</b><small>hoy {pesos(r.margen_actual)}</small>
          <Dif antes={r.margen_actual} ahora={r.margen_nuevo} unidad="$" /></div>
        {r.area && <>
          <div className="cifra"><span>% teórico {producto.area === 'BAR' ? 'del bar' : 'de cocina'}</span><b>{pct(r.area.pct_nuevo)}</b><small>hoy {pct(r.area.pct_actual)}</small>
            <Dif antes={r.area.pct_actual} ahora={r.area.pct_nuevo} inverso unidad="pts" /></div>
          <div className="cifra"><span>Margen del período</span><b>{pesos(r.area.margen_periodo_nuevo)}</b><small>hoy {pesos(r.area.margen_periodo_actual)}</small>
            <Dif antes={r.area.margen_periodo_actual} ahora={r.area.margen_periodo_nuevo} unidad="$" /></div>
        </>}
      </div>
      {!mezcla && <p className="suave" style={{ fontSize: '.85rem' }}>No hay ventas cargadas en el período de referencia: no se calcula el efecto sobre el área.</p>}
      {mezcla && mezcla.unidades === 0 && <p className="suave" style={{ fontSize: '.85rem' }}>Este producto no se vendió en el período de referencia.</p>}

      <label style={{ display: 'block', marginTop: '.6rem' }}>Nota de la propuesta (opcional)
        <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="por qué se propone" maxLength={300} />
      </label>
      <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '.6rem' }}>
        <button type="button" disabled={!cambio || pend} onClick={guardar}>{pend ? 'Guardando…' : 'Guardar como propuesta'}</button>
        <button type="button" className="secundario" disabled={pend} onClick={() => { setPrecio(base.precio ? String(base.precio) : ''); setCant({}); setUnidades(''); setMsg(null); }}>Volver a lo de hoy</button>
        {msg && <span role="status" style={{ color: msg.ok ? 'var(--ok)' : 'var(--error)' }}>{msg.texto}</span>}
      </div>
    </section>
  );
}
