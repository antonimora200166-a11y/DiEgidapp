'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

// Filtros del catálogo en la dirección (?tipo=MPe,MPI&unidad=g…): se pueden guardar como enlace.
// Dentro de un grupo se suman (g o ml); entre grupos se cruzan (g y Lácteos), como en Odoo.
type Opcion = { v: string; t: string };
type Grupo = { clave: string; titulo: string; opciones: Opcion[]; unico?: boolean };

export const GRUPOS_BASE: Grupo[] = [
  { clave: 'estado', titulo: 'Estado', opciones: [{ v: 'PROVISIONAL', t: 'Provisional' }, { v: 'VALIDADO', t: 'Validado' }] },
  { clave: 'activos', titulo: 'Activos', unico: true, opciones: [{ v: 'inactivos', t: 'Solo inactivos' }, { v: 'todos', t: 'Activos e inactivos' }] },
  { clave: 'tipo', titulo: 'Tipo', opciones: [{ v: 'MPe', t: 'MPe · se compra' }, { v: 'MPI', t: 'MPI · se produce' }, { v: 'SIN_COSTO', t: 'Sin costo' },
                                              { v: 'BEBIDA', t: 'Cóctel o bebida' }, { v: 'PLATO', t: 'Plato' }] },
  { clave: 'unidad', titulo: 'Unidad base', opciones: [{ v: 'g', t: 'g · peso' }, { v: 'ml', t: 'ml · volumen' }, { v: 'und', t: 'und · unidades' }] },
  { clave: 'cons', titulo: 'Conservación', opciones: [{ v: 'Ambiente', t: 'Ambiente' }, { v: 'Refrigerado', t: 'Refrigerado' }, { v: 'Congelado', t: 'Congelado' }, { v: 'SIN', t: 'Sin definir' }] },
  { clave: 'abc', titulo: 'Clase ABC', opciones: [{ v: 'A', t: 'A' }, { v: 'B', t: 'B' }, { v: 'C', t: 'C' }, { v: 'SIN', t: 'Sin clase' }] },
  { clave: 'falta', titulo: 'Le falta', opciones: [{ v: 'categoria', t: 'Categoría' }, { v: 'frio', t: 'Conservación' }, { v: 'factor', t: 'Factor de compra' },
                                                   { v: 'costo', t: 'Costo de partida' }, { v: 'tara', t: 'Peso de tara' }] },
  { clave: 'kardex', titulo: 'Kardex', unico: true, opciones: [{ v: 'con', t: 'Con movimientos' }, { v: 'sin', t: 'Sin movimientos' }] },
  { clave: 'variable', titulo: 'Contenido', unico: true, opciones: [{ v: 'true', t: 'Variable (se pesa al recibir)' }, { v: 'false', t: 'Fijo por presentación' }] },
];
export const AGRUPAR: Opcion[] = [
  { v: 'categoria', t: 'Categoría' }, { v: 'unidad', t: 'Unidad base' }, { v: 'tipo', t: 'Tipo' }, { v: 'estado', t: 'Estado' },
  { v: 'conservacion', t: 'Conservación' }, { v: 'abc', t: 'Clase ABC' }, { v: 'area', t: 'Área' },
];

export default function BarraFiltros({ areas, categorias }: { areas: string[]; categorias: { codigo: string; nombre: string; area: string }[] }) {
  const router = useRouter();
  const ruta = usePathname();
  const url = useSearchParams();
  // lo que se ve marcado cambia al instante; la página llega después (useTransition)
  const [sp, setSp] = useState(() => new URLSearchParams(url.toString()));
  const [cargando, iniciar] = useTransition();
  useEffect(() => setSp(new URLSearchParams(url.toString())), [url]);
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [abierto, setAbierto] = useState<'filtros' | 'agrupar' | null>(null);
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => setQ(url.get('q') ?? ''), [url]);
  // cerrar el menú al tocar fuera
  useEffect(() => {
    const cerrar = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(null); };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, []);

  const grupos: Grupo[] = [
    ...(areas.length > 1 ? [{ clave: 'area', titulo: 'Área', opciones: areas.map((a) => ({ v: a, t: a === 'BAR' ? 'Bar' : 'Cocina' })) }] : []),
    ...GRUPOS_BASE.slice(0, 4),
    { clave: 'cat', titulo: 'Categoría', opciones: [...categorias.map((c) => ({ v: c.codigo, t: areas.length > 1 ? `${c.nombre} (${c.area === 'BAR' ? 'bar' : 'cocina'})` : c.nombre })), { v: 'SIN', t: 'Sin categoría' }] },
    ...GRUPOS_BASE.slice(4),
  ];
  const valores = (clave: string) => (sp.get(clave) ?? '').split(',').filter(Boolean);
  const ir = (cambios: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(cambios)) { if (v) p.set(k, v); else p.delete(k); }
    if (!('pag' in cambios)) p.delete('pag');
    setSp(p);
    iniciar(() => router.push(`${ruta}${p.size ? `?${p}` : ''}`, { scroll: false }));
  };
  const alternar = (g: Grupo, v: string) => {
    const act = valores(g.clave);
    const nuevo = g.unico ? (act[0] === v ? [] : [v]) : act.includes(v) ? act.filter((x) => x !== v) : [...act, v];
    ir({ [g.clave]: nuevo.join(',') || null });
  };
  const chips = grupos.flatMap((g) => valores(g.clave).map((v) => ({ g, v, t: g.opciones.find((o) => o.v === v)?.t ?? v })));
  const agrupar = sp.get('agrupar');
  const vista = sp.get('vista') ?? 'lista';
  const boton = (activo: boolean) => ({ minHeight: 40, padding: '.35rem .8rem', ...(activo ? { background: 'var(--marca)', color: 'var(--marca-texto)' } : {}) });

  return (
    <div ref={caja} style={{ display: 'grid', gap: '.5rem', margin: '.4rem 0 1rem', position: 'relative' }}>
      <form onSubmit={(e) => { e.preventDefault(); ir({ q: q.trim() || null }); }}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', alignItems: 'center', border: '1px solid var(--borde)', borderRadius: 10, padding: '.35rem', background: 'var(--tarjeta)' }}>
        {chips.map((c) => (
          <span key={c.g.clave + c.v} className="etiqueta" style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center', fontSize: '.85rem', padding: '.2rem .5rem', color: 'var(--marca)' }}>
            <span className="suave" style={{ fontWeight: 400 }}>{c.g.titulo}:</span> {c.t}
            <button type="button" aria-label={`Quitar ${c.t}`} onClick={() => alternar(c.g, c.v)}
                    style={{ minHeight: 0, padding: '0 .2rem', background: 'none', border: 0, color: 'inherit', fontWeight: 800 }}>×</button>
          </span>
        ))}
        {agrupar && (
          <span className="etiqueta" style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center', fontSize: '.85rem', padding: '.2rem .5rem', color: 'var(--ok)' }}>
            Agrupado por {AGRUPAR.find((a) => a.v === agrupar)?.t.toLowerCase()}
            <button type="button" aria-label="Quitar agrupación" onClick={() => ir({ agrupar: null })}
                    style={{ minHeight: 0, padding: '0 .2rem', background: 'none', border: 0, color: 'inherit', fontWeight: 800 }}>×</button>
          </span>
        )}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar genérico, marca, código o nombre de factura…" aria-label="Buscar"
               style={{ flex: '1 1 220px', border: 0, minHeight: 40, background: 'transparent' }} />
        {(chips.length > 0 || agrupar || sp.get('q')) && (
          <button type="button" className="secundario" style={{ minHeight: 36, padding: '.2rem .6rem' }}
                  onClick={() => ir(Object.fromEntries([...sp.keys()].filter((k) => k !== 'vista').map((k) => [k, null])))}>Limpiar</button>
        )}
        <button type="submit" style={{ minHeight: 40, padding: '.35rem .9rem' }}>Buscar</button>
      </form>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', alignItems: 'center' }}>
        <button type="button" className="secundario" style={boton(abierto === 'filtros')} onClick={() => setAbierto(abierto === 'filtros' ? null : 'filtros')}>
          Filtros{chips.length ? ` (${chips.length})` : ''} ▾
        </button>
        <button type="button" className="secundario" style={boton(abierto === 'agrupar')} onClick={() => setAbierto(abierto === 'agrupar' ? null : 'agrupar')}>
          Agrupar por ▾
        </button>
        <label style={{ margin: 0, display: 'flex', gap: '.35rem', alignItems: 'center', fontWeight: 400 }}>Orden
          <select value={sp.get('orden') ?? 'nombre'} onChange={(e) => ir({ orden: e.target.value === 'nombre' ? null : e.target.value })} style={{ width: 'auto', minHeight: 40 }}>
            <option value="nombre">Nombre</option><option value="codigo">Código</option><option value="categoria">Categoría</option>
            <option value="unidad">Unidad base</option><option value="creado">Más recientes</option><option value="costo">Costo (mayor)</option><option value="saldo">Saldo (mayor)</option>
          </select>
        </label>
        {cargando && <span className="suave" role="status" style={{ fontSize: '.85rem' }}>Actualizando…</span>}
        <span style={{ flex: 1 }} />
        <div className="segmentos" role="radiogroup" aria-label="Vista">
          {[['lista', '☰ Lista'], ['tarjetas', '▦ Tarjetas']].map(([v, t]) => (
            <label key={v}><input type="radio" name="vista" checked={vista === v} onChange={() => ir({ vista: v === 'lista' ? null : v, pag: sp.get('pag') })} /><span>{t}</span></label>
          ))}
        </div>
      </div>

      {abierto === 'filtros' && (
        <div className="tarjeta" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, maxHeight: '70vh', overflow: 'auto',
                                          display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', boxShadow: '0 8px 28px rgb(0 0 0 / .25)' }}>
          {grupos.map((g) => (
            <fieldset key={g.clave} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
              <legend style={{ fontWeight: 700, marginBottom: '.3rem' }}>{g.titulo}</legend>
              <div style={g.clave === 'cat' ? { maxHeight: 260, overflow: 'auto' } : undefined}>
                {g.opciones.map((o) => (
                  <label key={o.v} style={{ display: 'flex', gap: '.45rem', alignItems: 'center', fontWeight: 400, margin: '.15rem 0' }}>
                    <input type="checkbox" checked={valores(g.clave).includes(o.v)} onChange={() => alternar(g, o.v)} style={{ width: 20, minHeight: 20 }} />
                    {o.t}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      )}
      {abierto === 'agrupar' && (
        <div className="tarjeta" style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, minWidth: 240, boxShadow: '0 8px 28px rgb(0 0 0 / .25)' }}>
          {AGRUPAR.filter((a) => a.v !== 'area' || areas.length > 1).map((a) => (
            <label key={a.v} style={{ display: 'flex', gap: '.45rem', alignItems: 'center', fontWeight: 400, margin: '.2rem 0' }}>
              <input type="radio" name="agrupar" checked={agrupar === a.v} onChange={() => { ir({ agrupar: a.v }); setAbierto(null); }} style={{ width: 20, minHeight: 20 }} />
              {a.t}
            </label>
          ))}
          {agrupar && <button type="button" className="secundario" style={{ marginTop: '.4rem', minHeight: 36 }} onClick={() => { ir({ agrupar: null }); setAbierto(null); }}>Sin agrupar</button>}
        </div>
      )}
    </div>
  );
}
