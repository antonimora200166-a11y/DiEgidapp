'use client';
// Descargar en Excel los bloques de la pantalla, o imprimirla / guardarla como PDF.
export default function Exportar({ bloques, params }: { bloques: { bloque: string; t: string }[]; params: Record<string, string | null | undefined> }) {
  const q = (bloque: string) => {
    const u = new URLSearchParams({ bloque });
    for (const [k, v] of Object.entries(params)) if (v && v !== 'TODO') u.set(k, v);
    return `/consulta/exportar?${u}`;
  };
  return (
    <div className="no-imprimir" style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '.88rem' }}>
      <span className="suave">Descargar en Excel:</span>
      {bloques.map((b) => <a key={b.bloque} href={q(b.bloque)} className="boton mini secundario" download>{b.t}</a>)}
      <button type="button" className="mini secundario" onClick={() => window.print()}>Imprimir o PDF</button>
    </div>
  );
}
