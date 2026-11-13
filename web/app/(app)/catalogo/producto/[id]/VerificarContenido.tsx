'use client';
import { useState, useTransition } from 'react';
import { verificarContenido } from './acciones-verificar';
import { fecha as fmtFecha } from '@/lib/formato';

// «Sí, cada unidad trae esto»: el contenido verificado deja de pedirse en conteos y recepciones.
// Si alguien cambia el contenido, la verificación se pierde (la base lo hace sola).
export default function VerificarContenido({ id, texto, verificado }: { id: string; texto: string; verificado: string | null }) {
  const [hecho, setHecho] = useState(verificado);
  const [error, setError] = useState<string | null>(null);
  const [pend, start] = useTransition();
  if (hecho) return <p className="suave" style={{ fontSize: '.88rem' }}>✔ Contenido verificado ({texto}) el {hecho}.</p>;
  return (
    <div className="aviso" style={{ fontSize: '.9rem' }}>
      <strong>Contenido sin verificar:</strong> la app cuenta cada unidad como {texto}. Mira una unidad real (etiqueta o báscula) y confírmalo.
      {error && <p className="error" style={{ margin: '.4rem 0 0' }}>{error}</p>}
      <div className="acciones" style={{ marginTop: '.4rem' }}>
        <button type="button" className="chico" disabled={pend} onClick={() => start(async () => {
          const r = await verificarContenido(id);
          if (r.ok) setHecho(fmtFecha(new Date())); else setError(r.error ?? 'No se pudo verificar.');
        })}>{pend ? 'Guardando…' : `Sí, trae ${texto}`}</button>
      </div>
    </div>
  );
}
