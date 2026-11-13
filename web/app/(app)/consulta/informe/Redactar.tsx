'use client';
import { useState, useTransition } from 'react';
import { guardar, redactar } from './acciones';

// La IA propone el borrador; la persona lo revisa y lo guarda (cada guardado es una versión nueva).
export default function Redactar({ periodo_id, hay }: { periodo_id: string; hay: boolean }) {
  const [texto, setTexto] = useState<string | null>(null);
  const [modelo, setModelo] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [pend, start] = useTransition();

  const conIA = () => start(async () => {
    setMsg(null);
    const r = await redactar(periodo_id);
    if (r.ok) { setTexto(r.texto); setModelo(r.modelo); } else setMsg({ ok: false, t: r.error });
  });
  const aMano = () => { setTexto(''); setModelo(null); setMsg(null); };
  const guardarlo = () => start(async () => {
    const r = await guardar({ periodo_id, resumen: texto ?? '', modelo });
    if (r.ok) { setTexto(null); setMsg({ ok: true, t: `Guardado como versión ${r.version}.` }); } else setMsg({ ok: false, t: r.error ?? 'No se pudo guardar.' });
  });

  return (
    <div style={{ marginTop: '.6rem' }}>
      {texto === null ? (
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="chico" disabled={pend} onClick={conIA}>{pend ? 'Redactando…' : hay ? 'Redactar otra versión con IA' : 'Redactar con IA'}</button>
          <button type="button" className="chico secundario" disabled={pend} onClick={aMano}>Escribirlo a mano</button>
        </div>
      ) : (
        <>
          <label>Borrador {modelo ? '(redactado por la IA solo con las cifras de arriba: revíselo antes de guardar)' : ''}
            <textarea rows={7} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={4000} />
          </label>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginTop: '.4rem' }}>
            <button type="button" className="chico" disabled={pend || texto.trim().length < 20} onClick={guardarlo}>Guardar informe</button>
            <button type="button" className="chico secundario" disabled={pend} onClick={() => setTexto(null)}>Cancelar</button>
          </div>
        </>
      )}
      {msg && <p role="status" style={{ color: msg.ok ? 'var(--ok)' : 'var(--error)', margin: '.4rem 0 0' }}>{msg.t}</p>}
    </div>
  );
}
