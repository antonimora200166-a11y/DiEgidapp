'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import VistaFiltrable, { type Agrupar, type Columna, type Grupo } from '@/components/VistaFiltrable';
import { fijarPrecio } from './acciones';

export type PlatoCarta = {
  generico_id: string; nombre: string; tipo: 'BEBIDA' | 'PLATO'; carta: string | null; ficha_codigo: string | null;
  lineas: number; lineas_con_costo: number; faltantes: string[]; costo: number | null;
  precio: number | null; precio_desde: string | null; pct_costo: number | null; margen: number | null;
};
const pesos = (n: number) => n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const num = (s: string) => { const n = Number(s.replace(/[.$\s]/g, '').replace(',', '.')); return s.trim() === '' || !Number.isFinite(n) ? null : n; };

function estado(f: PlatoCarta, meta: number) {
  if (!f.ficha_codigo || !f.lineas) return 'Sin receta';
  if (f.lineas_con_costo < f.lineas) return 'Costo incompleto';
  if (!f.precio) return 'Sin precio';
  return f.pct_costo! <= meta ? 'En meta' : 'Sobre la meta';
}

// Precio de carta escrito en la fila: Enter o «Guardar» lo fija (uno por día).
function Precio({ f, puede }: { f: PlatoCarta; puede: boolean }) {
  const router = useRouter();
  const [valor, setValor] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  if (!abierto) {
    return (
      <span style={{ whiteSpace: 'nowrap' }}>
        {f.precio ? pesos(Number(f.precio)) : <span className="suave">—</span>}
        {puede && <button type="button" className="discreto mini" onClick={() => { setValor(f.precio ? String(f.precio) : ''); setAbierto(true); }}>
          {f.precio ? 'Cambiar' : 'Poner'}</button>}
      </span>
    );
  }
  const guardar = () => {
    const n = num(valor);
    if (!n) { setError('Escribe el precio con impoconsumo.'); return; }
    iniciar(async () => {
      const r = await fijarPrecio(f.generico_id, n);
      if (r.ok) { setAbierto(false); setError(null); router.refresh(); } else setError(r.error ?? 'No se pudo guardar.');
    });
  };
  return (
    <span style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <input autoFocus inputMode="numeric" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="$ con impoconsumo"
             onKeyDown={(e) => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setAbierto(false); }}
             style={{ width: 120, minHeight: 32, padding: '.2rem .5rem' }} aria-label={`Precio de ${f.nombre}`} />
      <button type="button" className="mini" disabled={enviando} onClick={guardar}>{enviando ? '…' : 'Guardar'}</button>
      <button type="button" className="discreto mini" onClick={() => setAbierto(false)}>×</button>
      {error && <span style={{ color: 'var(--error)', fontSize: '.8rem', flexBasis: '100%', textAlign: 'right' }}>{error}</span>}
    </span>
  );
}

export default function ListaCarta({ filas, meta, puedePrecio }: { filas: PlatoCarta[]; meta: number; puedePrecio: boolean }) {
  const grupos: Grupo<PlatoCarta>[] = [
    { clave: 'estado', titulo: 'Estado', valor: (f) => estado(f, meta) },
    { clave: 'carta', titulo: 'Sección de la carta', valor: (f) => f.carta ?? 'Sin sección' },
    { clave: 'tipo', titulo: 'Tipo', valor: (f) => (f.tipo === 'BEBIDA' ? 'Cóctel / bebida' : 'Plato') },
  ];
  const agrupar: Agrupar<PlatoCarta>[] = [
    { v: 'carta', t: 'Sección de la carta', valor: (f) => f.carta ?? 'Sin sección' },
    { v: 'estado', t: 'Estado', valor: (f) => estado(f, meta) },
  ];
  const columnas: Columna<PlatoCarta>[] = [
    { k: 'nombre', t: 'Nombre', orden: (f) => f.nombre, ver: (f) => (
      <div><Link href={`/fichas/${f.generico_id}`}><strong>{f.nombre}</strong></Link>
        {f.carta && <div className="suave" style={{ fontSize: '.8rem' }}>{f.carta}</div>}</div>) },
    { k: 'costo', t: 'Costo receta', der: true, orden: (f) => f.costo, ver: (f) => (
      !f.lineas ? <span className="suave">sin receta</span>
        : <span>{pesos(Number(f.costo ?? 0))}{f.lineas_con_costo < f.lineas && <div style={{ color: 'var(--aviso)', fontSize: '.8rem' }}>{f.lineas_con_costo} de {f.lineas} con costo</div>}</span>) },
    { k: 'precio', t: 'Precio carta', der: true, orden: (f) => f.precio, ver: (f) => <Precio f={f} puede={puedePrecio} /> },
    { k: 'pct', t: '% costo', der: true, orden: (f) => f.pct_costo, ver: (f) => (
      f.pct_costo === null ? <span className="suave">—</span>
        : <strong style={{ color: f.pct_costo <= meta ? 'var(--ok)' : 'var(--error)' }}>{Number(f.pct_costo).toLocaleString('es-CO')} %</strong>) },
    { k: 'margen', t: 'Margen', der: true, orden: (f) => f.margen, ver: (f) => (f.margen === null ? <span className="suave">—</span> : pesos(Number(f.margen))) },
    { k: 'falta', t: 'Qué falta', def: false, ver: (f) => (
      f.faltantes.length ? <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '.85rem' }}>{f.faltantes.slice(0, 3).map((x) => <li key={x}>{x}</li>)}</ul>
        : <span className="suave">—</span>) },
  ];
  return (
    <VistaFiltrable clave="carta" filas={filas} id={(f) => f.generico_id} buscar={(f) => `${f.nombre} ${f.carta ?? ''}`}
                    grupos={grupos} columnas={columnas} agrupar={agrupar} vacio="Nada coincide con estos filtros."
                    pie={(vis) => {
                      const con = vis.filter((f) => f.pct_costo !== null);
                      const prom = con.length ? con.reduce((t, f) => t + Number(f.pct_costo), 0) / con.length : null;
                      return (
                        <p className="suave" style={{ fontSize: '.88rem' }}>
                          Meta: {meta} % de costo sobre el precio sin impoconsumo.
                          {prom !== null && <> Promedio de lo filtrado: <strong>{Math.round(prom * 10) / 10} %</strong> en {con.length} con costo y precio.</>}
                          {' '}{vis.filter((f) => estado(f, meta) === 'Costo incompleto').length} con costo incompleto: abre la ficha para ver qué falta.
                        </p>
                      );
                    }} />
  );
}
