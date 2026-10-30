'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Resultado } from '@/lib/catalogo';
import { anularDocumento } from '../../acciones';

// Anular el documento completo o, en una recepción, una sola línea. Pide el motivo y confirma:
// la anulación reversa los movimientos en el kardex y no se puede deshacer.
export default function Anular({ tipo, id, lineaId, etiqueta, pequeno }: {
  tipo: string; id: string; lineaId?: string; etiqueta: string; pequeno?: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [enviando, iniciar] = useTransition();

  if (!abierto) {
    return (
      <button type="button" className="secundario" style={pequeno ? { minHeight: 34, padding: '.2rem .6rem', fontSize: '.85rem' } : undefined}
              onClick={() => setAbierto(true)}>
        {etiqueta}
      </button>
    );
  }
  function anular() {
    if (!confirm(`${etiqueta}: sus movimientos se reversan en el kardex. Queda en el historial y no se puede deshacer. ¿Seguir?`)) return;
    iniciar(async () => {
      const r = await anularDocumento(tipo, id, motivo, lineaId ?? null);
      setResultado(r);
      if (r.ok) router.refresh();
    });
  }
  if (resultado?.ok) {
    return (
      <div className="exito" role="status" style={{ margin: '.5rem 0 0' }}>
        Anulado.{resultado.avisos.length > 0 && <ul>{resultado.avisos.map((m) => <li key={m}>{m}</li>)}</ul>}
      </div>
    );
  }
  return (
    <div className="tarjeta" style={{ marginTop: '.5rem', width: '100%' }}>
      <label htmlFor={`motivo-${lineaId ?? id}`} style={{ marginTop: 0 }}>¿Por qué se anula?</label>
      <textarea id={`motivo-${lineaId ?? id}`} rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej.: se registró dos veces / el producto se devolvió al proveedor" />
      <span className="ayuda">Mínimo 15 caracteres. Queda en la bitácora con tu nombre.</span>
      {resultado && !resultado.ok && (
        <div className="error" role="alert"><ul style={{ margin: 0 }}>{resultado.fatales.map((m) => <li key={m}>{m}</li>)}</ul></div>
      )}
      <div className="acciones">
        <button type="button" disabled={enviando || motivo.trim().length < 15} onClick={anular}>{enviando ? 'Anulando…' : etiqueta}</button>
        <button type="button" className="secundario" disabled={enviando} onClick={() => { setAbierto(false); setMotivo(''); setResultado(null); }}>Cancelar</button>
      </div>
    </div>
  );
}
