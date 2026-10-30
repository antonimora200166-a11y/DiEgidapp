'use client';
import type { Resultado } from '@/lib/catalogo';

// Lo que la base respondió al no guardar: F (no se puede) en rojo; B (se puede con motivo) en
// amarillo, con el campo del motivo del forzado (mínimo 15 caracteres, MIN_MOTIVO_OVERRIDE).
export default function RechazoConMotivo({ resultado, motivo, setMotivo, ejemplo }: {
  resultado: Resultado | null; motivo: string; setMotivo: (s: string) => void; ejemplo: string;
}) {
  if (!resultado || resultado.ok) return null;
  const bloqueado = !resultado.fatales.length && resultado.bloqueos.length > 0;
  return (
    <div className={bloqueado ? 'aviso' : 'error'} role="alert">
      <strong>{bloqueado ? 'Para guardar así hace falta un motivo:' : 'No se guardó:'}</strong>
      <ul>{[...resultado.fatales, ...resultado.bloqueos].map((m) => <li key={m}>{m}</li>)}</ul>
      {resultado.avisos.length > 0 && <><strong>Avisos:</strong><ul>{resultado.avisos.map((m) => <li key={m}>{m}</li>)}</ul></>}
      {bloqueado && (
        <>
          <label htmlFor="motivo">Corrige lo de arriba, o escribe por qué se registra así</label>
          <textarea id="motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={ejemplo} />
        </>
      )}
    </div>
  );
}
