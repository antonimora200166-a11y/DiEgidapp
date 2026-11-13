'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fijarEquivalencia } from './acciones';
import { pesos } from '@/lib/formato';

export type SinEquivalencia = {
  clave: string; codigo_odoo: string | null; nombre_odoo: string; categoria: string | null; unidades: number; valor_neto: number;
  sugerido_id: string | null; sugerido: string | null; sugerido_codigo: string | null; parecido: number | null;
};
export type ProductoCarta = { id: string; codigo: string; nombre: string; area: 'BAR' | 'COCINA' };

const TIPOS = [
  { v: 'PRODUCTO', t: 'Es un producto de la carta' },
  { v: 'COMBO', t: 'Es un combo (varios productos)' },
  { v: 'IGNORAR', t: 'No se tiene en cuenta' },
  { v: 'PROPINA', t: 'Propina' },
  { v: 'PROMOCION', t: 'Promoción o descuento' },
];

function Fila({ f, carta }: { f: SinEquivalencia; carta: ProductoCarta[] }) {
  const router = useRouter();
  const [tipo, setTipo] = useState('PRODUCTO');
  const [partes, setPartes] = useState<string[]>(f.sugerido_id ? [f.sugerido_id] : ['']);
  const [error, setError] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  const lleva = tipo === 'PRODUCTO' || tipo === 'COMBO';
  const guardar = () => {
    const elegidas = lleva ? partes.filter(Boolean) : [];
    if (lleva && !elegidas.length) { setError('Escoja el producto de la carta.'); return; }
    iniciar(async () => {
      const r = await fijarEquivalencia({ clave: f.clave, nombre_odoo: f.nombre_odoo, tipo,
                                          partes: elegidas.map((g) => ({ generico_id: g, cantidad: 1 })) });
      if (r.ok) router.refresh(); else setError(r.error ?? 'No se pudo guardar.');
    });
  };
  return (
    <li className="tarjeta" style={{ display: 'grid', gap: '.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap' }}>
        <span><strong>{f.nombre_odoo}</strong>{f.codigo_odoo && <span className="cod"> · {f.codigo_odoo}</span>}
          {f.categoria && <span className="suave bloque texto-mini">{f.categoria}</span>}</span>
        <span className="suave" style={{ textAlign: 'right', fontSize: '.88rem' }}>{Number(f.unidades).toLocaleString('es-CO')} und<br />{pesos(Number(f.valor_neto))}</span>
      </div>
      <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label={`Qué es ${f.nombre_odoo}`}>
        {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.t}</option>)}
      </select>
      {lleva && partes.map((g, i) => (
        <div className="fila-flex" key={i}>
          <select value={g} onChange={(e) => setPartes((p) => p.map((x, j) => (j === i ? e.target.value : x)))} aria-label="Producto de la carta" style={{ flex: 1 }}>
            <option value="">Escoja el producto de la carta…</option>
            {(['BAR', 'COCINA'] as const).map((a) => (
              <optgroup key={a} label={a === 'BAR' ? 'Bar' : 'Cocina'}>
                {carta.filter((c) => c.area === a).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </optgroup>
            ))}
          </select>
          {tipo === 'COMBO' && partes.length > 1 && <button type="button" className="discreto" onClick={() => setPartes((p) => p.filter((_, j) => j !== i))} aria-label="Quitar">×</button>}
        </div>
      ))}
      {tipo === 'COMBO' && <button type="button" className="secundario mini" onClick={() => setPartes((p) => [...p, ''])}>+ Otro producto del combo</button>}
      {f.sugerido && tipo === 'PRODUCTO' && partes[0] === f.sugerido_id && <span className="suave texto-mini">Sugerido por el nombre (parecido {Math.round(Number(f.parecido) * 100)} %)</span>}
      {error && <span style={{ color: 'var(--error)', fontSize: '.85rem' }}>{error}</span>}
      <div><button type="button" className="mini" disabled={enviando} onClick={guardar}>{enviando ? 'Guardando…' : 'Guardar'}</button></div>
    </li>
  );
}

export default function Equivalencias({ filas, carta }: { filas: SinEquivalencia[]; carta: ProductoCarta[] }) {
  if (!filas.length) return <p className="tarjeta">Todo lo vendido en Odoo tiene equivalencia con la carta.</p>;
  return <ul className="pila" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{filas.map((f) => <Fila key={f.clave} f={f} carta={carta} />)}</ul>;
}
