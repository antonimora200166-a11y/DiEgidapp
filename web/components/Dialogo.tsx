'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

// Ventanas propias en lugar de confirm/prompt/alert del navegador: se ven igual en toda la app,
// en el celular suben desde abajo y la de motivo valida el largo antes de aceptar.
//   if (!(await confirmar('¿Descartar?', { peligro: true }))) return;
//   const motivo = await pedirTexto('¿Por qué?', { min: 5 });   // null si cancela
// <Dialogos /> va una sola vez en el layout.

type Opciones = { titulo?: string; aceptar?: string; cancelar?: string; peligro?: boolean };
type Pedido =
  | { tipo: 'confirmar'; mensaje: string; op: Opciones; responder: (v: boolean) => void }
  | { tipo: 'texto'; mensaje: string; op: Opciones & { min?: number; placeholder?: string }; responder: (v: string | null) => void };

let actual: Pedido | null = null;
const oyentes = new Set<() => void>();
const poner = (p: Pedido | null) => { actual = p; oyentes.forEach((o) => o()); };

export const confirmar = (mensaje: string, op: Opciones = {}) =>
  new Promise<boolean>((responder) => poner({ tipo: 'confirmar', mensaje, op, responder }));
export const pedirTexto = (mensaje: string, op: Opciones & { min?: number; placeholder?: string } = {}) =>
  new Promise<string | null>((responder) => poner({ tipo: 'texto', mensaje, op, responder }));

export function Dialogos() {
  const p = useSyncExternalStore((o) => { oyentes.add(o); return () => oyentes.delete(o); }, () => actual, () => null);
  const ref = useRef<HTMLDialogElement>(null);
  const [texto, setTexto] = useState('');

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (p && !d.open) { setTexto(''); d.showModal(); }
    if (!p && d.open) d.close();
  }, [p]);

  function cerrar(valor: boolean) {
    if (!p) return;
    if (p.tipo === 'confirmar') p.responder(valor);
    else p.responder(valor ? texto.trim() : null);
    poner(null);
  }
  const min = p?.tipo === 'texto' ? p.op.min ?? 1 : 0;
  const corto = p?.tipo === 'texto' && texto.trim().length < min;

  return (
    <dialog ref={ref} className="dialogo" onCancel={(e) => { e.preventDefault(); cerrar(false); }}
            onClick={(e) => { if (e.target === ref.current) cerrar(false); }}>
      {p && (
        <form method="dialog" onSubmit={(e) => { e.preventDefault(); if (!corto) cerrar(true); }}>
          {p.op.titulo && <h2 style={{ margin: '0 0 .5rem' }}>{p.op.titulo}</h2>}
          <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{p.mensaje}</p>
          {p.tipo === 'texto' && (
            <>
              <textarea autoFocus rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={p.op.placeholder}
                        style={{ marginTop: '.8rem' }} aria-label={p.mensaje} />
              {min > 1 && <span className="ayuda">{corto ? `Mínimo ${min} caracteres (van ${texto.trim().length}).` : '✔'}</span>}
            </>
          )}
          <div className="acciones" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="secundario" onClick={() => cerrar(false)}>{p.op.cancelar ?? 'Cancelar'}</button>
            <button type="submit" className={p.op.peligro ? 'peligro' : undefined} disabled={corto} autoFocus={p.tipo === 'confirmar'}>
              {p.op.aceptar ?? 'Aceptar'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
