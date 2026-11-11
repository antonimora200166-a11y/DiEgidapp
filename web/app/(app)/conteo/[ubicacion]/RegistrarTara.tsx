'use client';
import { useState, useTransition } from 'react';
import { registrarTara } from '../acciones';

// Sin tara, la botella abierta no se puede pesar. Se registra aquí mismo, una sola vez por
// presentación: pesando la botella vacía, o una llena y sellada (la app le resta el contenido).
export default function RegistrarTara({ productoId, nombre, contenido, unidad, onLista }: {
  productoId: string; nombre: string; contenido: number | null; unidad: string; onLista: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [modo, setModo] = useState<'LLENA' | 'VACIA'>(contenido ? 'LLENA' : 'VACIA');
  const [peso, setPeso] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [enviando, iniciar] = useTransition();

  if (!abierto) {
    return (
      <button type="button" className="discreto mini" style={{ marginTop: '.4rem' }} onClick={() => setAbierto(true)}>
        ⚖ Registrar la tara para poder pesar la abierta
      </button>
    );
  }
  const guardar = () => {
    const n = Number(peso.replace(',', '.'));
    if (!peso.trim() || !Number.isFinite(n) || n <= 0) { setMsg({ ok: false, texto: 'Escribe el peso en gramos.' }); return; }
    iniciar(async () => {
      const r = await registrarTara(productoId, modo, n);
      setMsg({ ok: r.ok, texto: r.ok ? r.mensaje ?? 'Tara registrada.' : r.error ?? 'No se pudo registrar.' });
      if (r.ok) onLista();
    });
  };
  return (
    <div className="tarjeta" style={{ marginTop: '.5rem', padding: '.6rem' }}>
      <strong style={{ fontSize: '.9rem' }}>Tara de {nombre}</strong>
      <div className="segmentos" role="radiogroup" aria-label="Qué botella pesaste" style={{ margin: '.4rem 0' }}>
        {contenido && (
          <label><input type="radio" checked={modo === 'LLENA'} onChange={() => setModo('LLENA')} />
            <span>Llena y sellada</span></label>
        )}
        <label><input type="radio" checked={modo === 'VACIA'} onChange={() => setModo('VACIA')} /><span>Vacía</span></label>
      </div>
      <div className="suave" style={{ fontSize: '.8rem' }}>
        {modo === 'LLENA'
          ? `Pesa una botella cerrada de ${contenido} ${unidad}, con tapa. La app le resta el contenido (${contenido} ${unidad} × la densidad del licor).`
          : 'Pesa la botella vacía, con su tapa y su pico vertedor si lo usa.'}
      </div>
      <div className="fila" style={{ gridTemplateColumns: '1fr auto', alignItems: 'end', marginTop: '.4rem' }}>
        <label style={{ margin: 0, fontWeight: 400, fontSize: '.85rem' }}>
          Peso (g)
          <input inputMode="decimal" value={peso} onChange={(e) => setPeso(e.target.value)} />
        </label>
        <button type="button" className="chico" disabled={enviando} onClick={guardar}>{enviando ? 'Guardando…' : 'Guardar tara'}</button>
      </div>
      {msg && <div className={msg.ok ? 'exito' : 'error'} role="status" style={{ marginTop: '.4rem', fontSize: '.85rem' }}>{msg.texto}</div>}
      {!msg?.ok && <button type="button" className="discreto mini" style={{ marginTop: '.3rem' }} onClick={() => setAbierto(false)}>Cancelar</button>}
    </div>
  );
}
