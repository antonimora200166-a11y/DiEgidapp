'use client';
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { decidirPropuestas } from './acciones';

type Cambios = { unidad_base?: string; unidad_compra?: string; contenido_base?: number; contenido_variable?: boolean; categoria?: string };
type Actual = { unidad_base?: string; unidad_compra?: string; contenido_base?: number | null; contenido_variable?: boolean; categoria?: string | null };
export type Propuesta = {
  id: string; producto_id: string; codigo: string; generico: string; marca: string; presentacion: string; area: 'BAR' | 'COCINA';
  tipo: string; cambios: Cambios; actual: Actual; categoria_propuesta: string | null; seguridad: 'ALTA' | 'MEDIA' | 'BAJA';
  razon: string | null; estado: 'PENDIENTE' | 'ACEPTADA' | 'CORREGIDA' | 'RECHAZADA'; mensaje: string | null;
  decidido_por: string | null; decidido_en: string | null;
};
type Categoria = { codigo: string; nombre: string; area: string };

const COLOR = { ALTA: 'var(--ok)', MEDIA: 'var(--aviso)', BAJA: 'var(--error)' };
const QUE: Record<string, { t: string; f: (c: Cambios) => boolean }> = {
  unidad: { t: 'Unidad base', f: (c) => !!c.unidad_base },
  contenido: { t: 'Contenido', f: (c) => c.contenido_base !== undefined },
  variable: { t: 'Se pesa al recibir', f: (c) => !!c.contenido_variable },
  categoria: { t: 'Categoría', f: (c) => !!c.categoria },
};
const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const cant = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: 3 }));

function Chips<T extends string>({ opciones, valor, poner }: { opciones: [T, string][]; valor: T; poner: (v: T) => void }) {
  return (
    <div className="segmentos" role="radiogroup">
      {opciones.map(([v, t]) => <label key={v}><input type="radio" checked={valor === v} onChange={() => poner(v)} /><span>{t}</span></label>)}
    </div>
  );
}

export default function Propuestas({ filas, categorias, soloLectura }: { filas: Propuesta[]; categorias: Categoria[]; soloLectura: boolean }) {
  const router = useRouter();
  const [estado, setEstado] = useState<'PENDIENTE' | 'HECHAS' | 'RECHAZADA' | 'todas'>('PENDIENTE');
  const [seguridad, setSeguridad] = useState<'todas' | 'ALTA' | 'MEDIA' | 'BAJA'>('todas');
  const [area, setArea] = useState<'todas' | 'BAR' | 'COCINA'>('todas');
  const [que, setQue] = useState<'todo' | keyof typeof QUE>('todo');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [corrigiendo, setCorrigiendo] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Cambios & { contenido_texto?: string }>({});
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string; lista?: string[] } | null>(null);
  const [enviando, iniciar] = useTransition();

  const visibles = useMemo(() => filas.filter((p) =>
    (estado === 'todas' || (estado === 'HECHAS' ? ['ACEPTADA', 'CORREGIDA'].includes(p.estado) : p.estado === estado))
    && (seguridad === 'todas' || p.seguridad === seguridad)
    && (area === 'todas' || p.area === area)
    && (que === 'todo' || QUE[que].f(p.cambios))
    && (!q.trim() || sinTildes(`${p.generico} ${p.marca} ${p.presentacion} ${p.codigo}`).includes(sinTildes(q.trim())))), [filas, estado, seguridad, area, que, q]);
  const pendientes = filas.filter((p) => p.estado === 'PENDIENTE');
  const elegibles = visibles.filter((p) => p.estado === 'PENDIENTE');
  const todas = elegibles.length > 0 && elegibles.every((p) => sel.has(p.id));
  const cambia = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function decidir(ids: string[], decision: 'ACEPTAR' | 'RECHAZAR', correccion: Cambios | null = null) {
    if (!ids.length) return;
    if (ids.length > 1 && !confirm(`¿${decision === 'ACEPTAR' ? 'Aceptar' : 'Rechazar'} ${ids.length} propuesta(s)?`)) return;
    setMensaje(null);
    iniciar(async () => {
      const r = await decidirPropuestas(ids, decision, correccion);
      if ('error' in r) { setMensaje({ ok: false, texto: r.error }); return; }
      setMensaje({ ok: !r.fallidos, texto: `${r.ok} ${decision === 'ACEPTAR' ? 'aplicada(s)' : 'rechazada(s)'}${r.fallidos ? `; ${r.fallidos} no se pudieron aplicar y siguen pendientes:` : '.'}`,
                   lista: r.detalle.filter((d) => !d.ok).map((d) => `${d.codigo}: ${d.mensaje ?? ''}`) });
      setSel(new Set(r.detalle.filter((d) => !d.ok).map((d) => d.id)));
      setCorrigiendo(null);
      router.refresh();
    });
  }

  function abrirCorreccion(p: Propuesta) {
    setCorrigiendo(p.id);
    const base = { ...p.actual, ...p.cambios } as Cambios & { contenido_base?: number | null };
    setBorrador({ unidad_base: base.unidad_base, unidad_compra: base.unidad_compra, contenido_variable: !!base.contenido_variable,
                  contenido_texto: base.contenido_base == null ? '' : String(base.contenido_base),
                  categoria: p.cambios.categoria ?? categorias.find((c) => c.nombre === p.actual.categoria && c.area === p.area)?.codigo ?? '' });
  }
  function guardarCorreccion(p: Propuesta) {
    const c: Cambios = {};
    if (borrador.unidad_base && borrador.unidad_base !== p.actual.unidad_base) c.unidad_base = borrador.unidad_base;
    if (borrador.unidad_compra && borrador.unidad_compra.toUpperCase() !== p.actual.unidad_compra) c.unidad_compra = borrador.unidad_compra.toUpperCase();
    if (borrador.contenido_variable) c.contenido_variable = true;
    else {
      const v = Number((borrador.contenido_texto ?? '').replace(',', '.'));
      if (v > 0) { c.contenido_base = v; c.contenido_variable = false; }
    }
    if (borrador.categoria) c.categoria = borrador.categoria;
    decidir([p.id], 'ACEPTAR', c);
  }

  // muestra «actual → propuesta» solo en lo que cambia
  const celda = (actual: React.ReactNode, nuevo: React.ReactNode | undefined) => (
    nuevo === undefined ? <span className="suave">{actual}</span>
      : <span><span className="suave" style={{ textDecoration: 'line-through' }}>{actual}</span> → <strong style={{ color: 'var(--marca)' }}>{nuevo}</strong></span>
  );

  return (
    <>
      <div className="linea" style={{ flexWrap: 'wrap', margin: '0 0 .6rem' }}>
        <span>
          <strong>{pendientes.length}</strong> pendientes de {filas.length}
          <span className="suave"> · seguridad alta {pendientes.filter((p) => p.seguridad === 'ALTA').length} · media {pendientes.filter((p) => p.seguridad === 'MEDIA').length} · baja {pendientes.filter((p) => p.seguridad === 'BAJA').length}</span>
        </span>
      </div>
      <div style={{ display: 'grid', gap: '.45rem', marginBottom: '.8rem' }}>
        <Chips valor={estado} poner={(v) => { setEstado(v); setSel(new Set()); }} opciones={[['PENDIENTE', 'Pendientes'], ['HECHAS', 'Aplicadas'], ['RECHAZADA', 'Rechazadas'], ['todas', 'Todas']]} />
        <Chips valor={seguridad} poner={setSeguridad} opciones={[['todas', 'Toda seguridad'], ['ALTA', 'Alta'], ['MEDIA', 'Media'], ['BAJA', 'Baja (revisar)']]} />
        <Chips valor={area} poner={setArea} opciones={[['todas', 'Bar y cocina'], ['BAR', 'Bar'], ['COCINA', 'Cocina']]} />
        <Chips valor={que} poner={setQue} opciones={[['todo', 'Todo cambio'], ...Object.entries(QUE).map(([k, v]) => [k, v.t] as [keyof typeof QUE, string])]} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto o código…" aria-label="Buscar" style={{ maxWidth: 420 }} />
      </div>

      {mensaje && (
        <div className={mensaje.ok ? 'exito' : 'aviso'} role="status">
          {mensaje.texto}{mensaje.lista && mensaje.lista.length > 0 && <ul>{mensaje.lista.map((m) => <li key={m}>{m}</li>)}</ul>}
        </div>
      )}

      {visibles.length ? (
        <div className="desborde tarjeta" style={{ padding: 0 }}>
          <table className="tabla tabla-catalogo">
            <thead>
              <tr>
                <th style={{ width: 36 }}>{!soloLectura && elegibles.length > 0 && (
                  <input type="checkbox" aria-label="Seleccionar las visibles" checked={todas} style={{ width: 20, minHeight: 20 }}
                         onChange={() => setSel(todas ? new Set() : new Set(elegibles.map((p) => p.id)))} />
                )}</th>
                <th>Producto</th><th>Unidad base</th><th>Compra</th><th>Contenido</th><th>Categoría</th><th>Seguridad</th><th>Por qué</th><th />
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => {
                const c = p.cambios, a = p.actual;
                const contenidoActual = a.contenido_variable ? 'variable' : `${cant(a.contenido_base)} ${a.unidad_base ?? ''}`;
                const contenidoNuevo = c.contenido_variable ? 'se pesa al recibir'
                  : c.contenido_base !== undefined ? `${cant(c.contenido_base)} ${c.unidad_base ?? a.unidad_base}` : undefined;
                return (
                  <tr key={p.id} className={sel.has(p.id) ? 'elegida' : undefined} style={p.estado !== 'PENDIENTE' ? { opacity: 0.7 } : undefined}>
                    <td>{!soloLectura && p.estado === 'PENDIENTE' && (
                      <input type="checkbox" aria-label={`Seleccionar ${p.generico}`} checked={sel.has(p.id)} onChange={() => cambia(p.id)} style={{ width: 20, minHeight: 20 }} />
                    )}</td>
                    <td style={{ minWidth: 200 }}>
                      <Link href={`/catalogo/producto/${p.producto_id}`}><strong>{p.generico}</strong>{p.marca && ` · ${p.marca}`}</Link>
                      <div className="suave" style={{ fontSize: '.82rem' }}>{p.presentacion} · <span className="cod">{p.codigo}</span></div>
                    </td>
                    <td>{celda(a.unidad_base, c.unidad_base)}</td>
                    <td>{celda(a.unidad_compra, c.unidad_compra)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{celda(contenidoActual, contenidoNuevo)}</td>
                    <td>{celda(a.categoria ?? 'sin categoría', c.categoria ? (p.categoria_propuesta ?? c.categoria) : undefined)}</td>
                    <td><span className="etiqueta" style={{ color: COLOR[p.seguridad] }}>{p.seguridad.toLowerCase()}</span></td>
                    <td style={{ fontSize: '.85rem', minWidth: 220 }}>
                      {p.razon}
                      {p.mensaje && <div style={{ color: p.estado === 'PENDIENTE' ? 'var(--error)' : 'var(--suave)', marginTop: '.2rem' }}>{p.mensaje}</div>}
                      {p.estado !== 'PENDIENTE' && <div className="suave" style={{ marginTop: '.2rem' }}>{p.estado.toLowerCase()} · {p.decidido_por ?? ''}</div>}
                      {corrigiendo === p.id && (
                        <div className="tarjeta" style={{ marginTop: '.5rem', display: 'grid', gap: '.4rem' }}>
                          <label style={{ margin: 0 }}>Unidad base
                            <select value={borrador.unidad_base ?? ''} onChange={(e) => setBorrador((b) => ({ ...b, unidad_base: e.target.value }))}>
                              <option value="g">g</option><option value="ml">ml</option><option value="und">und</option>
                            </select>
                          </label>
                          <label style={{ margin: 0 }}>Unidad de compra
                            <input value={borrador.unidad_compra ?? ''} onChange={(e) => setBorrador((b) => ({ ...b, unidad_compra: e.target.value }))} />
                          </label>
                          <label style={{ margin: 0, display: 'flex', gap: '.4rem', alignItems: 'center', fontWeight: 400 }}>
                            <input type="checkbox" checked={!!borrador.contenido_variable} style={{ width: 20, minHeight: 20 }}
                                   onChange={(e) => setBorrador((b) => ({ ...b, contenido_variable: e.target.checked }))} />
                            Se pesa al recibir (contenido variable)
                          </label>
                          {!borrador.contenido_variable && (
                            <label style={{ margin: 0 }}>Contenido por unidad de compra ({borrador.unidad_base})
                              <input inputMode="decimal" value={borrador.contenido_texto ?? ''} onChange={(e) => setBorrador((b) => ({ ...b, contenido_texto: e.target.value }))} />
                            </label>
                          )}
                          <label style={{ margin: 0 }}>Categoría
                            <select value={borrador.categoria ?? ''} onChange={(e) => setBorrador((b) => ({ ...b, categoria: e.target.value }))}>
                              <option value="">— sin cambiar —</option>
                              {categorias.filter((x) => x.area === p.area).map((x) => <option key={x.codigo} value={x.codigo}>{x.nombre}</option>)}
                            </select>
                          </label>
                          <div style={{ display: 'flex', gap: '.4rem' }}>
                            <button type="button" disabled={enviando} onClick={() => guardarCorreccion(p)}>Aplicar corrección</button>
                            <button type="button" className="secundario" disabled={enviando} onClick={() => setCorrigiendo(null)}>Cancelar</button>
                          </div>
                        </div>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {!soloLectura && p.estado === 'PENDIENTE' && corrigiendo !== p.id && (
                        <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
                          <button type="button" disabled={enviando} style={{ minHeight: 32, padding: '.1rem .6rem' }} onClick={() => decidir([p.id], 'ACEPTAR')}>Aceptar</button>
                          <button type="button" className="secundario" disabled={enviando} style={{ minHeight: 32, padding: '.1rem .6rem' }} onClick={() => abrirCorreccion(p)}>Corregir</button>
                          <button type="button" className="secundario" disabled={enviando} style={{ minHeight: 32, padding: '.1rem .6rem' }} onClick={() => decidir([p.id], 'RECHAZAR')}>Rechazar</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="tarjeta">{estado === 'PENDIENTE' ? 'No quedan propuestas pendientes con estos filtros. ✔' : 'Nada coincide.'}</p>}

      {sel.size > 0 && (
        <div className="barra-bloque">
          <div className="linea" style={{ flexWrap: 'wrap' }}>
            <strong>{sel.size} seleccionada(s)</strong>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
              <button type="button" disabled={enviando} onClick={() => decidir([...sel], 'ACEPTAR')}>{enviando ? 'Aplicando…' : `Aceptar ${sel.size}`}</button>
              <button type="button" className="secundario" disabled={enviando} onClick={() => decidir([...sel], 'RECHAZAR')}>Rechazar {sel.size}</button>
              <button type="button" className="secundario" disabled={enviando} onClick={() => setSel(new Set())}>Quitar selección</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
