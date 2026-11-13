'use client';
import Link from 'next/link';
import { useEffect, useSyncExternalStore } from 'react';

// Confirmación breve al guardar (GEN-09): sale abajo, dice qué quedó y con qué código, ofrece «Ver» y se va sola.
// En Android además vibra: quien guarda con prisa sabe que quedó sin mirar la pantalla.
//   avisar({ texto: 'Recepción guardada · REC-0123', ver: { href: '/historial', t: 'Ver en historial' } });
// <Avisos /> va una sola vez en el layout.
type Aviso = { id: number; texto: string; tono: 'ok' | 'error'; ver?: { href: string; t: string } };
const VACIO: Aviso[] = [];   // la misma lista vacía siempre (useSyncExternalStore la compara)
let lista: Aviso[] = VACIO;
let siguiente = 1;
const oyentes = new Set<() => void>();
const avisarCambio = () => oyentes.forEach((o) => o());

export function avisar(a: { texto: string; tono?: 'ok' | 'error'; ver?: { href: string; t: string } }) {
  const nuevo: Aviso = { id: siguiente++, tono: a.tono ?? 'ok', texto: a.texto, ver: a.ver };
  lista = [...lista.slice(-2), nuevo];
  avisarCambio();
  try { navigator.vibrate?.(nuevo.tono === 'ok' ? 40 : [60, 60, 60]); } catch { /* sin vibración */ }
  setTimeout(() => quitar(nuevo.id), 6000);
}
function quitar(id: number) { lista = lista.filter((x) => x.id !== id); avisarCambio(); }

export function Avisos() {
  const avisos = useSyncExternalStore((o) => { oyentes.add(o); return () => oyentes.delete(o); }, () => lista, () => VACIO);
  useEffect(() => () => { lista = VACIO; }, []);
  return (
    <div className="avisos" role="status" aria-live="polite">
      {avisos.map((a) => (
        <div key={a.id} className={`aviso-flotante ${a.tono}`}>
          <span aria-hidden className="af-icono">{a.tono === 'ok' ? '✓' : '✕'}</span>
          <span className="af-texto">{a.texto}</span>
          {a.ver && <Link href={a.ver.href} className="af-ver" onClick={() => quitar(a.id)}>{a.ver.t}</Link>}
          <button type="button" className="af-cerrar" aria-label="Cerrar aviso" onClick={() => quitar(a.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
