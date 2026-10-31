'use client';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

// Lista al estilo de Odoo para pantallas cuyos datos caben en el navegador (propuestas, fichas,
// existencias, historial): búsqueda, filtros por grupo con casillas (se suman dentro del grupo y
// se cruzan entre grupos), chips con ×, agrupar por, columnas que se prenden y apagan, orden por
// columna y, si la pantalla lo pide, selección de filas para acciones en grupo.
// Lo elegido (filtros, columnas, orden) queda recordado en este equipo con «clave».

export type Grupo<T> = {
  clave: string; titulo: string;
  valor: (f: T) => string | string[] | null;          // valor(es) de la fila en este grupo
  opciones?: { v: string; t: string }[];               // si no vienen, salen de los datos
  unico?: boolean;                                      // una sola opción a la vez
};
export type Columna<T> = {
  k: string; t: string; def?: boolean; der?: boolean;
  ver: (f: T) => React.ReactNode;
  orden?: (f: T) => string | number | null;            // para ordenar al tocar el encabezado
};
export type Agrupar<T> = { v: string; t: string; valor: (f: T) => string };

const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const lista = (x: string | string[] | null) => (x === null ? [] : Array.isArray(x) ? x : [x]);
type Estado = { f: Record<string, string[]>; q: string; agrupar: string | null; cols: string[] | null; orden: string | null; desc: boolean };

export default function VistaFiltrable<T>({ clave, filas, id, buscar, grupos, columnas, agrupar = [], seleccionable, acciones,
  pie, filtrosIniciales, porPagina = 200, vacio = 'Nada coincide con estos filtros.' }: {
  clave: string; filas: T[]; id: (f: T) => string; buscar: (f: T) => string;
  grupos: Grupo<T>[]; columnas: Columna<T>[]; agrupar?: Agrupar<T>[];
  seleccionable?: (f: T) => boolean;
  acciones?: (elegidas: T[], limpiar: () => void) => React.ReactNode;
  pie?: (visibles: T[]) => React.ReactNode;
  filtrosIniciales?: Record<string, string[]>; porPagina?: number; vacio?: string;
}) {
  const inicial: Estado = { f: filtrosIniciales ?? {}, q: '', agrupar: null, cols: null, orden: null, desc: false };
  const [e, setE] = useState<Estado>(inicial);
  const [cargado, setCargado] = useState(false);
  const [menu, setMenu] = useState<'filtros' | 'agrupar' | 'columnas' | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [mostrar, setMostrar] = useState(porPagina);
  const caja = useRef<HTMLDivElement>(null);
  const llave = `sgi-vista:${clave}`;

  useEffect(() => {
    try { const g = JSON.parse(localStorage.getItem(llave) || 'null'); if (g) setE({ ...inicial, ...g }); } catch { /* nada */ }
    setCargado(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llave]);
  useEffect(() => { if (cargado) try { localStorage.setItem(llave, JSON.stringify(e)); } catch { /* nada */ } }, [llave, cargado, e]);
  useEffect(() => {
    const cerrar = (ev: MouseEvent) => { if (caja.current && !caja.current.contains(ev.target as Node)) setMenu(null); };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, []);
  useEffect(() => setMostrar(porPagina), [e.f, e.q, porPagina]);

  // opciones de cada grupo: las dadas o las que aparecen en los datos, con cuántas filas tienen
  const opciones = useMemo(() => Object.fromEntries(grupos.map((g) => {
    const cuenta = new Map<string, number>();
    for (const f of filas) for (const v of lista(g.valor(f))) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
    const base = g.opciones ?? [...cuenta.keys()].sort((a, b) => a.localeCompare(b, 'es')).map((v) => ({ v, t: v }));
    return [g.clave, base.map((o) => ({ ...o, n: cuenta.get(o.v) ?? 0 }))];
  })), [grupos, filas]);

  const visibles = useMemo(() => {
    const q = sinTildes(e.q.trim());
    let r = filas.filter((f) => (!q || sinTildes(buscar(f)).includes(q))
      && grupos.every((g) => { const elegidos = e.f[g.clave] ?? []; return !elegidos.length || lista(g.valor(f)).some((v) => elegidos.includes(v)); }));
    const col = columnas.find((c) => c.k === e.orden);
    const ag = agrupar.find((a) => a.v === e.agrupar);
    if (col?.orden || ag) {
      r = [...r].sort((a, b) => {
        if (ag) { const x = ag.valor(a).localeCompare(ag.valor(b), 'es'); if (x) return x; }
        if (!col?.orden) return 0;
        const va = col.orden(a), vb = col.orden(b);
        if (va === vb) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        const d = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es');
        return e.desc ? -d : d;
      });
    }
    return r;
  }, [filas, e, grupos, columnas, agrupar, buscar]);

  const cols = columnas.filter((c) => (e.cols ?? columnas.filter((x) => x.def !== false).map((x) => x.k)).includes(c.k));
  const ag = agrupar.find((a) => a.v === e.agrupar);
  const cuentaGrupo = useMemo(() => {
    const m = new Map<string, number>();
    if (ag) for (const f of visibles) m.set(ag.valor(f), (m.get(ag.valor(f)) ?? 0) + 1);
    return m;
  }, [visibles, ag]);
  const alternar = (g: Grupo<T>, v: string) => setE((x) => {
    const act = x.f[g.clave] ?? [];
    const nuevo = g.unico ? (act[0] === v ? [] : [v]) : act.includes(v) ? act.filter((y) => y !== v) : [...act, v];
    return { ...x, f: { ...x.f, [g.clave]: nuevo } };
  });
  const chips = grupos.flatMap((g) => (e.f[g.clave] ?? []).map((v) => ({ g, v, t: opciones[g.clave]?.find((o) => o.v === v)?.t ?? v })));
  const elegibles = visibles.filter((f) => seleccionable?.(f));
  const elegidas = filas.filter((f) => sel.has(id(f)));
  const todas = elegibles.length > 0 && elegibles.slice(0, mostrar).every((f) => sel.has(id(f)));
  const boton = (activo: boolean) => (activo ? 'herramienta chico activa' : 'herramienta chico');
  const panel = { position: 'absolute' as const, top: '100%', zIndex: 20, boxShadow: '0 8px 28px rgb(0 0 0 / .25)', maxHeight: '70vh', overflow: 'auto' };
  const enPantalla = visibles.slice(0, mostrar);

  return (
    <>
      <div ref={caja} style={{ display: 'grid', gap: '.5rem', margin: '.4rem 0 .8rem', position: 'relative' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', alignItems: 'center', border: '1px solid var(--borde)', borderRadius: 10, padding: '.35rem', background: 'var(--tarjeta)' }}>
          {chips.map((c) => (
            <span key={c.g.clave + c.v} className="etiqueta" style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center', fontSize: '.85rem', padding: '.2rem .5rem', color: 'var(--marca)' }}>
              <span className="suave" style={{ fontWeight: 400 }}>{c.g.titulo}:</span> {c.t}
              <button type="button" aria-label={`Quitar ${c.t}`} onClick={() => alternar(c.g, c.v)} className="quitar">×</button>
            </span>
          ))}
          {ag && (
            <span className="etiqueta" style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center', fontSize: '.85rem', padding: '.2rem .5rem', color: 'var(--ok)' }}>
              Agrupado por {ag.t.toLowerCase()}
              <button type="button" aria-label="Quitar agrupación" onClick={() => setE((x) => ({ ...x, agrupar: null }))} className="quitar">×</button>
            </span>
          )}
          <input value={e.q} onChange={(ev) => setE((x) => ({ ...x, q: ev.target.value }))} placeholder="Buscar…" aria-label="Buscar"
                 style={{ flex: '1 1 200px', border: 0, minHeight: 40, background: 'transparent' }} />
          {(chips.length > 0 || ag || e.q) && (
            <button type="button" className="secundario chico" onClick={() => setE((x) => ({ ...x, f: {}, q: '', agrupar: null }))}>Limpiar</button>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', alignItems: 'center' }}>
          <button type="button" className={boton(menu === 'filtros')} onClick={() => setMenu(menu === 'filtros' ? null : 'filtros')}>Filtros{chips.length ? ` (${chips.length})` : ''} ▾</button>
          {agrupar.length > 0 && <button type="button" className={boton(menu === 'agrupar')} onClick={() => setMenu(menu === 'agrupar' ? null : 'agrupar')}>Agrupar por ▾</button>}
          <button type="button" className={boton(menu === 'columnas')} onClick={() => setMenu(menu === 'columnas' ? null : 'columnas')}>⚙ Columnas</button>
          <span className="suave" style={{ marginLeft: 'auto' }}>{visibles.length} de {filas.length}</span>
        </div>
        {menu === 'filtros' && (
          <div className="tarjeta" style={{ ...panel, left: 0, right: 0, display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
            {grupos.map((g) => (
              <fieldset key={g.clave} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                <legend style={{ fontWeight: 700, marginBottom: '.3rem' }}>{g.titulo}</legend>
                <div style={{ maxHeight: 240, overflow: 'auto' }}>
                  {(opciones[g.clave] ?? []).map((o) => (
                    <label key={o.v} style={{ display: 'flex', gap: '.45rem', alignItems: 'center', fontWeight: 400, margin: '.15rem 0' }}>
                      <input type="checkbox" checked={(e.f[g.clave] ?? []).includes(o.v)} onChange={() => alternar(g, o.v)} style={{ width: 20, minHeight: 20 }} />
                      {o.t} <span className="suave" style={{ fontSize: '.8rem' }}>({o.n})</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        )}
        {menu === 'agrupar' && (
          <div className="tarjeta" style={{ ...panel, left: 0, minWidth: 230 }}>
            {agrupar.map((a) => (
              <label key={a.v} style={{ display: 'flex', gap: '.45rem', alignItems: 'center', fontWeight: 400, margin: '.2rem 0' }}>
                <input type="radio" name={`agrupar-${clave}`} checked={e.agrupar === a.v} onChange={() => { setE((x) => ({ ...x, agrupar: a.v })); setMenu(null); }} style={{ width: 20, minHeight: 20 }} />
                {a.t}
              </label>
            ))}
            {e.agrupar && <button type="button" className="secundario" style={{ marginTop: '.4rem', minHeight: 36 }} onClick={() => { setE((x) => ({ ...x, agrupar: null })); setMenu(null); }}>Sin agrupar</button>}
          </div>
        )}
        {menu === 'columnas' && (
          <div className="tarjeta" style={{ ...panel, right: 0, minWidth: 230 }}>
            {columnas.map((c) => (
              <label key={c.k} style={{ display: 'flex', gap: '.45rem', alignItems: 'center', fontWeight: 400, margin: '.15rem 0' }}>
                <input type="checkbox" checked={cols.some((x) => x.k === c.k)} style={{ width: 20, minHeight: 20 }}
                       onChange={() => setE((x) => { const act = cols.map((y) => y.k); const n = act.includes(c.k) ? act.filter((y) => y !== c.k) : columnas.filter((y) => act.includes(y.k) || y.k === c.k).map((y) => y.k); return { ...x, cols: n }; })} />
                {c.t}
              </label>
            ))}
          </div>
        )}
      </div>

      {visibles.length ? (
        <div className="desborde tarjeta" style={{ padding: 0 }}>
          <table className="tabla tabla-catalogo tabla-movil">
            <thead>
              <tr>
                {seleccionable && (
                  <th style={{ width: 36 }}>{elegibles.length > 0 && (
                    <input type="checkbox" aria-label="Seleccionar las visibles" checked={todas} style={{ width: 20, minHeight: 20 }}
                           onChange={() => setSel(todas ? new Set() : new Set(elegibles.slice(0, mostrar).map(id)))} />
                  )}</th>
                )}
                {cols.map((c) => (
                  <th key={c.k} style={{ ...(c.der ? { textAlign: 'right' } : {}), cursor: c.orden ? 'pointer' : undefined }}
                      onClick={() => c.orden && setE((x) => ({ ...x, orden: c.k, desc: x.orden === c.k ? !x.desc : false }))}
                      aria-sort={e.orden === c.k ? (e.desc ? 'descending' : 'ascending') : undefined}>
                    {c.t}{e.orden === c.k ? (e.desc ? ' ▼' : ' ▲') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {enPantalla.map((f, i) => {
                const g = ag?.valor(f);
                return (
                  <Fragment key={id(f)}>
                    {ag && (i === 0 || ag.valor(enPantalla[i - 1]) !== g) && (
                      <tr className="fila-grupo"><td colSpan={cols.length + (seleccionable ? 1 : 0)}><strong>{g}</strong> <span className="suave">· {cuentaGrupo.get(g!)}</span></td></tr>
                    )}
                    <tr className={sel.has(id(f)) ? 'elegida' : undefined}>
                      {seleccionable && (
                        <td className="celda-sel">{seleccionable(f) && <input type="checkbox" aria-label="Seleccionar" checked={sel.has(id(f))} style={{ width: 20, minHeight: 20 }}
                                                       onChange={() => setSel((s) => { const n = new Set(s); if (n.has(id(f))) n.delete(id(f)); else n.add(id(f)); return n; })} />}</td>
                      )}
                      {cols.map((c) => <td key={c.k} data-t={c.t} style={c.der ? { textAlign: 'right', whiteSpace: 'nowrap' } : undefined}>{c.ver(f)}</td>)}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="tarjeta">{vacio}</p>}
      {visibles.length > mostrar && (
        <div className="acciones"><button type="button" className="secundario" onClick={() => setMostrar((m) => m + porPagina)}>Ver {Math.min(porPagina, visibles.length - mostrar)} más ({visibles.length - mostrar} sin mostrar)</button></div>
      )}
      {pie?.(visibles)}
      {acciones && elegidas.length > 0 && acciones(elegidas, () => setSel(new Set()))}
    </>
  );
}
