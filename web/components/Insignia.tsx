// Estado con símbolo y palabra, nunca solo color: se lee con daltonismo, al sol y impreso.
// ✓ bien · ▲ cerca o atención · ✕ mal · · sin dato
export type Tono = 'ok' | 'aviso' | 'error' | 'gris';
const SIMBOLO: Record<Tono, string> = { ok: '✓', aviso: '▲', error: '✕', gris: '·' };
export const TEXTO_META: Record<Tono, string> = { ok: 'En meta', aviso: 'Cerca', error: 'Sobre la meta', gris: 'Sin dato' };

export function Insignia({ tono, children, titulo }: { tono: Tono; children?: React.ReactNode; titulo?: string }) {
  return (
    <span className={`insignia ${tono}`} title={titulo}>
      <span aria-hidden>{SIMBOLO[tono]}</span>{children ?? TEXTO_META[tono]}
    </span>
  );
}

// % de costo contra la meta: en la meta, hasta «banda» puntos encima, o más
export const tonoMeta = (v: number | null | undefined, meta: number | null | undefined, banda = 3): Tono | null =>
  v === null || v === undefined || meta === null || meta === undefined ? null : v <= meta ? 'ok' : v <= meta + banda ? 'aviso' : 'error';
export const tonoSemaforo = (s: string | null | undefined): Tono | null =>
  s === 'VERDE' ? 'ok' : s === 'AMARILLO' ? 'aviso' : s === 'ROJO' ? 'error' : null;

// Cambio frente al período anterior: flecha y signo, y el tono dice si es bueno (inverso: bajar es bueno)
export function Cambio({ dif, unidad, inverso = false, sufijo = 'vs. anterior' }: { dif: number; unidad: string; inverso?: boolean; sufijo?: string }) {
  const bueno = inverso ? dif <= 0 : dif >= 0;
  const flecha = dif > 0 ? '▲' : dif < 0 ? '▼' : '=';
  const texto = `${dif > 0 ? '+' : ''}${dif.toLocaleString('es-CO', { maximumFractionDigits: 1 })} ${unidad}`;
  return (
    <small className={`cambio ${bueno ? 'ok' : 'error'}`}>
      <span aria-hidden>{flecha}</span> {texto} {sufijo}<span className="sr-only"> ({bueno ? 'mejor' : 'peor'})</span>
    </small>
  );
}
