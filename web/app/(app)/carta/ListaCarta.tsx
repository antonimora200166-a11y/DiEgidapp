'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import VistaFiltrable, { type Agrupar, type Columna, type Grupo } from '@/components/VistaFiltrable';
import { fijarPrecio, moverAlBaul } from './acciones';
import { pesos, pct } from '@/lib/formato';
import { Insignia, tonoSemaforo, type Tono } from '@/components/Insignia';

// Una fila de public.carta_margen: producto final con su ficha, costo, precio y meta.
export type Ingrediente = {
  linea: number; generico_id: string; nombre: string; tipo: string; cantidad: number | null; unidad: string;
  costo: number | null; falta: string | null; estimado: boolean;
};
export type PlatoCarta = {
  generico_id: string; codigo: string; nombre: string; tipo: 'BEBIDA' | 'PLATO'; area: 'BAR' | 'COCINA';
  seccion: string | null; ficha_codigo: string | null; ficha_version: number | null;
  estado_ficha: 'COMPLETA' | 'PARCIAL' | 'SIN_FICHA';
  lineas: number; lineas_con_costo: number; faltantes: string[]; estimado: boolean; costo: number | null;
  precio: number | null; precio_desde: string | null; impoconsumo_pct: number; precio_neto: number | null;
  pct_costo: number | null; margen: number | null; margen_pct: number | null;
  meta_pct: number; banda_pp: number; semaforo: 'VERDE' | 'AMARILLO' | 'ROJO' | null;
  ingredientes: Ingrediente[];
};

const num = (s: string) => { const n = Number(s.replace(/[.$\s]/g, '').replace(',', '.')); return s.trim() === '' || !Number.isFinite(n) ? null : n; };
const ESTADO = { COMPLETA: 'Completa', PARCIAL: 'Parcial', SIN_FICHA: 'Sin ficha' } as const;
const SEMAFORO = { VERDE: 'En meta', AMARILLO: 'Cerca de la meta', ROJO: 'Sobre la meta' } as const;
const semaforo = (f: PlatoCarta) => (f.semaforo ? SEMAFORO[f.semaforo]
  : f.estado_ficha !== 'COMPLETA' ? 'Sin % (ficha incompleta)' : 'Sin % (sin precio)');

function Estado({ f }: { f: PlatoCarta }) {
  const color = f.estado_ficha === 'COMPLETA' ? 'var(--ok)' : f.estado_ficha === 'PARCIAL' ? 'var(--aviso)' : 'var(--error)';
  return (
    <span>
      <span className="etiqueta" style={{ color, fontSize: '.8rem', padding: '.1rem .45rem' }}>
        {ESTADO[f.estado_ficha]}{f.estado_ficha === 'PARCIAL' ? ` ${f.lineas_con_costo}/${f.lineas}` : ''}
      </span>
      {f.estimado && <div className="suave" style={{ fontSize: '.75rem' }} title="Sin kardex todavía: precios de referencia y recetas de las MPI">estimado</div>}
    </span>
  );
}

// Precio de carta escrito en la fila: Enter o «Guardar» lo fija (uno por día, con historia).
function Precio({ f }: { f: PlatoCarta }) {
  const router = useRouter();
  const [valor, setValor] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  if (!abierto) {
    return (
      <span style={{ whiteSpace: 'nowrap' }}>
        {f.precio ? pesos(f.precio) : <span className="suave">—</span>}
        <button type="button" className="discreto mini" onClick={() => { setValor(f.precio ? String(f.precio) : ''); setAbierto(true); }}>
          {f.precio ? 'Cambiar' : 'Poner'}</button>
      </span>
    );
  }
  const guardar = () => {
    const n = num(valor);
    if (!n) { setError('Escribe el precio de carta, con impoconsumo.'); return; }
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

// Ingredientes de la ficha con su costo: se abre al tocar la fila.
function Ingredientes({ f }: { f: PlatoCarta }) {
  if (f.estado_ficha === 'SIN_FICHA') {
    return <p className="suave" style={{ margin: '.3rem 0' }}>{f.nombre} no tiene ficha técnica todavía. <Link href={`/fichas/${f.generico_id}`}>Crear o abrir la ficha</Link></p>;
  }
  return (
    <div style={{ padding: '.3rem 0', maxWidth: 640 }}>
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'baseline', marginBottom: '.4rem' }}>
        <strong>Ficha {f.ficha_codigo}{f.ficha_version ? ` · versión ${f.ficha_version}` : ''}</strong>
        <Link href={`/fichas/${f.generico_id}`} className="mini">Abrir la ficha técnica</Link>
      </div>
      <table className="tabla" style={{ fontSize: '.9rem' }}>
        <thead><tr><th>Insumo</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Costo</th><th style={{ textAlign: 'right' }}>Peso</th></tr></thead>
        <tbody>
          {f.ingredientes.map((i) => (
            <tr key={i.linea}>
              <td>
                <Link href={i.tipo === 'MPI' ? `/fichas/${i.generico_id}` : `/catalogo/generico/${i.generico_id}`}>{i.nombre}</Link>
                {i.tipo === 'MPI' && <span className="suave" style={{ fontSize: '.75rem' }}> · MPI</span>}
                {i.falta && <div style={{ color: 'var(--aviso)', fontSize: '.8rem' }}>{i.falta}</div>}
              </td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{i.cantidad === null ? <span className="suave">al gusto</span> : `${Number(i.cantidad).toLocaleString('es-CO')} ${i.unidad}`}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{i.falta ? <span style={{ color: 'var(--error)' }}>sin costo</span> : pesos(i.costo)}{i.estimado && !i.falta && <span className="suave" title="estimado"> *</span>}</td>
              <td style={{ textAlign: 'right' }}>{!i.falta && f.costo ? `${Math.round(Number(i.costo ?? 0) / Number(f.costo) * 100)} %` : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td><strong>Total</strong></td><td /><td style={{ textAlign: 'right' }}><strong>{pesos(f.costo)}</strong></td><td /></tr></tfoot>
      </table>
      {f.estimado && <p className="suave" style={{ fontSize: '.8rem', margin: '.3rem 0 0' }}>* Costo estimado: precio de referencia o receta de la MPI, mientras no haya kardex.</p>}
    </div>
  );
}

// Barra de las filas marcadas: las lleva al baúl (con un motivo opcional).
function AlBaul({ elegidas, limpiar }: { elegidas: PlatoCarta[]; limpiar: () => void }) {
  const router = useRouter();
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  const llevar = () => {
    const nombres = elegidas.slice(0, 5).map((f) => f.nombre).join(', ') + (elegidas.length > 5 ? ` y ${elegidas.length - 5} más` : '');
    if (!confirm(`¿Llevar al baúl ${elegidas.length === 1 ? 'esta ficha' : `estas ${elegidas.length} fichas`}?\n\n${nombres}\n\n`
      + 'Dejan de salir en la carta, en Fichas técnicas y en los promedios. Se pueden sacar cuando quieras.')) return;
    iniciar(async () => {
      const r = await moverAlBaul(elegidas.map((f) => f.generico_id), motivo.trim());
      if (r.ok) { setMotivo(''); setError(null); limpiar(); router.refresh(); } else setError(r.error ?? 'No se pudo mover.');
    });
  };
  return (
    <div className="barra-bloque">
      <div className="linea" style={{ flexWrap: 'wrap' }}>
        <strong>{elegidas.length} seleccionado(s)</strong>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional)" aria-label="Motivo"
                 style={{ minWidth: 180, flex: '1 1 180px' }} />
          <button type="button" disabled={enviando} onClick={llevar}>{enviando ? 'Moviendo…' : `Llevar ${elegidas.length} al baúl`}</button>
          <button type="button" className="secundario" disabled={enviando} onClick={limpiar}>Quitar selección</button>
        </div>
      </div>
      {error && <p style={{ color: 'var(--error)', margin: '.4rem 0 0' }}>{error}</p>}
    </div>
  );
}

// Franja de arriba: cuántos están en la meta, cerca o sobre ella. Tocar una cifra filtra la tabla.
function FranjaMeta({ filas, elegido, filtrar }: { filas: PlatoCarta[]; elegido: string[]; filtrar: (v: string[]) => void }) {
  const items: { v: string; tono: Tono; t: string; n: number }[] = [
    { v: SEMAFORO.VERDE, tono: 'ok', t: 'En meta', n: filas.filter((f) => f.semaforo === 'VERDE').length },
    { v: SEMAFORO.AMARILLO, tono: 'aviso', t: 'Cerca', n: filas.filter((f) => f.semaforo === 'AMARILLO').length },
    { v: SEMAFORO.ROJO, tono: 'error', t: 'Sobre la meta', n: filas.filter((f) => f.semaforo === 'ROJO').length },
  ];
  const sinPct = filas.filter((f) => !f.semaforo).length;
  return (
    <div className="franja" role="group" aria-label="Contra la meta: toca para filtrar">
      {items.map((i) => {
        const activo = elegido.length === 1 && elegido[0] === i.v;
        return (
          <button key={i.v} type="button" className={`franja-item${activo ? ' activa' : ''}`} aria-pressed={activo}
                  onClick={() => filtrar(activo ? [] : [i.v])}>
            <b>{i.n}</b><Insignia tono={i.tono}>{i.t}</Insignia>
          </button>
        );
      })}
      <span className="franja-nota suave">{sinPct ? `${sinPct} sin % (ficha incompleta o sin precio)` : 'Todos tienen %'}{elegido.length ? ' · toca de nuevo para ver todos' : ' · toca una cifra para filtrar'}</span>
    </div>
  );
}

export default function ListaCarta({ filas, variasAreas }: { filas: PlatoCarta[]; variasAreas: boolean }) {
  const seccion = (f: PlatoCarta) => f.seccion ?? 'Sin sección';
  const grupos: Grupo<PlatoCarta>[] = [
    { clave: 'seccion', titulo: 'Sección', valor: seccion },
    { clave: 'estado', titulo: 'Ficha', valor: (f) => ESTADO[f.estado_ficha] },
    { clave: 'semaforo', titulo: 'Contra la meta', valor: semaforo },
    ...(variasAreas ? [{ clave: 'area', titulo: 'Área', valor: (f: PlatoCarta) => (f.area === 'BAR' ? 'Bar' : 'Cocina') }] : []),
  ];
  const agrupar: Agrupar<PlatoCarta>[] = [
    { v: 'seccion', t: 'Sección', valor: seccion },
    { v: 'semaforo', t: 'Contra la meta', valor: semaforo },
    { v: 'estado', t: 'Ficha', valor: (f) => ESTADO[f.estado_ficha] },
  ];
  const columnas: Columna<PlatoCarta>[] = [
    { k: 'codigo', t: 'Código', orden: (f) => f.codigo, ver: (f) => <span className="suave" style={{ fontSize: '.8rem', fontFamily: 'ui-monospace, monospace' }}>{f.codigo}</span> },
    { k: 'nombre', t: 'Nombre', orden: (f) => f.nombre, ver: (f) => <strong>{f.nombre}</strong> },
    { k: 'seccion', t: 'Sección', orden: seccion, ver: (f) => <span style={{ fontSize: '.88rem' }}>{seccion(f)}</span> },
    { k: 'ficha', t: 'Ficha', orden: (f) => f.estado_ficha, ver: (f) => <Estado f={f} /> },
    { k: 'costo', t: 'Costo', der: true, orden: (f) => f.costo, ver: (f) => (f.estado_ficha === 'SIN_FICHA' ? <span className="suave">—</span> : pesos(f.costo)) },
    { k: 'precio', t: 'Precio carta', der: true, orden: (f) => f.precio, ver: (f) => <Precio f={f} /> },
    { k: 'neto', t: 'Precio neto', der: true, orden: (f) => f.precio_neto, ver: (f) => pesos(f.precio_neto === null ? null : Math.round(f.precio_neto)) },
    { k: 'pct', t: '% costo', der: true, orden: (f) => f.pct_costo, ver: (f) => (
      f.pct_costo === null ? <span className="suave">—</span>
        : <span className="con-estado"><strong>{pct(f.pct_costo)}</strong>
            {f.semaforo && <Insignia tono={tonoSemaforo(f.semaforo)!}>{f.semaforo === 'AMARILLO' ? 'Cerca' : SEMAFORO[f.semaforo]}</Insignia>}</span>) },
    { k: 'margen', t: 'Margen $', der: true, orden: (f) => f.margen, ver: (f) => pesos(f.margen) },
    { k: 'margen_pct', t: 'Margen %', der: true, orden: (f) => f.margen_pct, ver: (f) => pct(f.margen_pct) },
    { k: 'meta', t: 'Meta', der: true, orden: (f) => f.meta_pct, ver: (f) => <span className="suave">{Number(f.meta_pct).toLocaleString('es-CO')} %</span> },
  ];
  return (
    <VistaFiltrable clave="carta-margen" filas={filas} id={(f) => f.generico_id} buscar={(f) => `${f.nombre} ${f.codigo} ${f.seccion ?? ''}`}
                    grupos={grupos} columnas={columnas} agrupar={agrupar} vacio="Nada coincide con estos filtros."
                    detalle={(f) => <Ingredientes f={f} />}
                    resumen={({ filas: todas, filtros, filtrar }) => <FranjaMeta filas={todas} elegido={filtros.semaforo ?? []} filtrar={(v) => filtrar('semaforo', v)} />}
                    seleccionable={() => true}
                    acciones={(elegidas, limpiar) => <AlBaul elegidas={elegidas} limpiar={limpiar} />}
                    pie={(vis) => {
                      const con = vis.filter((f) => f.pct_costo !== null);
                      const prom = con.length ? con.reduce((t, f) => t + Number(f.pct_costo), 0) / con.length : null;
                      return (
                        <p className="suave" style={{ fontSize: '.88rem' }}>
                          {vis.length} productos · {con.length} con % de costo
                          {prom !== null && <> · promedio simple <strong>{pct(prom)}</strong></>}
                          {' '}· {vis.filter((f) => f.semaforo === 'ROJO').length} sobre la meta
                          {' '}· {vis.filter((f) => f.estado_ficha === 'PARCIAL').length} con ficha parcial
                          {' '}· {vis.filter((f) => f.estado_ficha === 'SIN_FICHA').length} sin ficha.
                          {' '}Toca un producto para ver sus ingredientes.
                        </p>
                      );
                    }} />
  );
}
