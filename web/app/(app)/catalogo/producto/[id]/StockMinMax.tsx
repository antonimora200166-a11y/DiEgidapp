'use client';
import { useState, useTransition } from 'react';
import { fijarStock } from '../../acciones';

const num = (s: string) => { const n = Number(s.replace(',', '.')); return s.trim() === '' || !Number.isFinite(n) ? null : n; };

// Mínimo y máximo en unidades de compra: cuando lo que hay llega al mínimo, sale en el pedido sugerido.
export default function StockMinMax({ id, minimo, maximo, unidad }: { id: string; minimo: number | null; maximo: number | null; unidad: string }) {
  const [min, setMin] = useState(minimo === null ? '' : String(minimo));
  const [max, setMax] = useState(maximo === null ? '' : String(maximo));
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [enviando, iniciar] = useTransition();
  const cambio = (num(min) ?? null) !== minimo || (num(max) ?? null) !== maximo;

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      iniciar(async () => {
        const r = await fijarStock(id, num(min), num(max));
        setMsg(r.ok ? { ok: true, texto: 'Guardado.' } : { ok: false, texto: r.error ?? 'No se pudo guardar.' });
      });
    }}>
      <div className="fila">
        <label style={{ marginTop: 0 }}>Mínimo ({unidad.toLowerCase()})
          <input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder="sin mínimo" />
        </label>
        <label style={{ marginTop: 0 }}>Máximo ({unidad.toLowerCase()})
          <input inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} placeholder="el doble del mínimo" />
        </label>
      </div>
      <div className="acciones" style={{ marginTop: '.6rem' }}>
        <button type="submit" className="secundario chico" disabled={enviando || !cambio}>{enviando ? 'Guardando…' : 'Guardar mínimo y máximo'}</button>
        {msg && <span role="status" style={{ color: msg.ok ? 'var(--ok)' : 'var(--error)', alignSelf: 'center' }}>{msg.texto}</span>}
      </div>
    </form>
  );
}
