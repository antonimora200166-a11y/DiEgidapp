'use client';
import { useEffect, useRef, useState } from 'react';

// Modo «Cocinando» (FICH-02): la ficha a pantalla completa para tenerla abierta en la estación. Primero los
// ingredientes, después un paso por pantalla con letra grande y botones al pulgar. Mientras está abierto, la
// pantalla no se apaga (Wake Lock, donde el navegador lo permite).
type Ingrediente = { nombre: string; cantidad: string };

export default function ModoCocinando({ titulo, ingredientes, pasos, puntos = [] }: {
  titulo: string; ingredientes: Ingrediente[]; pasos: string[]; puntos?: string[];
}) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [i, setI] = useState(0);   // 0 = ingredientes; 1..n = pasos
  const total = pasos.length + 1;
  const bloqueo = useRef<{ release: () => Promise<void> } | null>(null);

  async function abrir() {
    setI(0);
    dlg.current?.showModal();
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      bloqueo.current = (await wl?.request('screen')) ?? null;
    } catch { /* el navegador no lo permite: la pantalla se apaga como siempre */ }
  }
  function cerrar() { dlg.current?.close(); }
  useEffect(() => {
    const d = dlg.current;
    const soltar = () => { void bloqueo.current?.release().catch(() => {}); bloqueo.current = null; };
    d?.addEventListener('close', soltar);
    return () => { d?.removeEventListener('close', soltar); soltar(); };
  }, []);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (!dlg.current?.open) return;
      if (e.key === 'ArrowRight') setI((x) => Math.min(total - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [total]);

  if (!pasos.length) return null;
  return (
    <>
      <button type="button" className="secundario" onClick={abrir}>Cocinar con esta ficha</button>
      <dialog ref={dlg} className="modo-cocinando" aria-label={`Cocinando: ${titulo}`}>
        <div className="mc-cab">
          <strong>{titulo}</strong>
          <span className="suave">{i === 0 ? 'Ingredientes' : `Paso ${i} de ${pasos.length}`}</span>
          <button type="button" className="discreto" onClick={cerrar} aria-label="Salir del modo cocinando">✕ Salir</button>
        </div>
        <div className="mc-avance" aria-hidden><span style={{ width: `${(i / (total - 1)) * 100}%` }} /></div>
        <div className="mc-cuerpo" aria-live="polite">
          {i === 0 ? (
            <>
              <ul className="mc-ingredientes">
                {ingredientes.map((x) => <li key={x.nombre}><span>{x.nombre}</span><b>{x.cantidad}</b></li>)}
              </ul>
              {puntos.length > 0 && (
                <div className="aviso mc-puntos"><strong>Cuidado:</strong><ul>{puntos.map((p) => <li key={p}>{p}</li>)}</ul></div>
              )}
            </>
          ) : (
            <p className="mc-paso"><span className="mc-n">{i}</span>{pasos[i - 1]}</p>
          )}
        </div>
        <div className="mc-pie">
          <button type="button" className="secundario" disabled={i === 0} onClick={() => setI((x) => x - 1)}>‹ Anterior</button>
          {i < total - 1
            ? <button type="button" className="principal" onClick={() => setI((x) => x + 1)}>{i === 0 ? 'Empezar · paso 1' : 'Siguiente ›'}</button>
            : <button type="button" className="principal" onClick={cerrar}>Terminé</button>}
        </div>
      </dialog>
    </>
  );
}
