'use client';
import type { Resultado } from '@/lib/catalogo';

// Lo que la base respondió al no guardar: F (no se puede) en rojo; B (se puede con motivo) en
// amarillo, con el campo del motivo del forzado (mínimo 15 caracteres, MIN_MOTIVO_OVERRIDE).
// Revisar (public.enviar): cantidades fuera de lo normal o contenidos sin verificar. Nada se
// guardó; cada uno se marca «está bien» y se vuelve a guardar.
export default function RechazoConMotivo({ resultado, motivo, setMotivo, ejemplo, confirmados, setConfirmados }: {
  resultado: Resultado | null; motivo: string; setMotivo: (s: string) => void; ejemplo: string;
  confirmados?: string[]; setConfirmados?: (f: (c: string[]) => string[]) => void;
}) {
  if (!resultado || resultado.ok) return null;
  if (resultado.revisar?.length) return <Revisiones resultado={resultado} confirmados={confirmados ?? []} setConfirmados={setConfirmados} />;
  const bloqueado = !resultado.fatales.length && resultado.bloqueos.length > 0;
  return (
    <div className={bloqueado ? 'aviso' : 'error'} role="alert">
      <strong>{bloqueado ? 'Para guardar así hace falta un motivo:' : 'No se guardó:'}</strong>
      <ul>{[...resultado.fatales, ...resultado.bloqueos].map((m) => <li key={m}>{m}</li>)}</ul>
      {resultado.avisos.length > 0 && <><strong>Avisos:</strong><ul>{resultado.avisos.map((m) => <li key={m}>{m}</li>)}</ul></>}
      {bloqueado && (
        <>
          <label htmlFor="motivo">Corrija lo de arriba, o escriba por qué se registra así</label>
          <textarea id="motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={ejemplo} />
        </>
      )}
    </div>
  );
}

export function Revisiones({ resultado, confirmados, setConfirmados }: {
  resultado: Resultado; confirmados: string[]; setConfirmados?: (f: (c: string[]) => string[]) => void;
}) {
  const lista = resultado.revisar ?? [];
  const faltan = lista.filter((r) => !confirmados.includes(r.producto_id)).length;
  return (
    <div className="aviso" role="alert">
      <strong>Revise antes de guardar. Todavía no se guardó nada:</strong>
      <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
        {lista.map((r) => (
          <li key={r.producto_id + r.motivo} style={{ marginTop: '.5rem' }}>
            <div>{r.mensaje}</div>
            {setConfirmados && (
              <label style={{ fontWeight: 600, display: 'flex', gap: '.4rem', alignItems: 'center', marginTop: '.3rem' }}>
                <input type="checkbox" checked={confirmados.includes(r.producto_id)}
                       onChange={(e) => setConfirmados((c) => (e.target.checked ? [...c, r.producto_id] : c.filter((x) => x !== r.producto_id)))} />
                {r.motivo === 'CANTIDAD' ? 'Revisé: la cantidad está bien' : 'Revisé: el contenido está bien'}
              </label>
            )}
          </li>
        ))}
      </ul>
      <span className="ayuda">
        {faltan > 0 ? 'Si algo está mal, corríjalo arriba. Si está bien, márquelo y vuelva a guardar.' : 'Listo: vuelva a guardar.'}
      </span>
    </div>
  );
}
