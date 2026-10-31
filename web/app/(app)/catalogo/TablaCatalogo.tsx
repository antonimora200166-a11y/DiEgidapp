'use client';
import { Fragment, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Resultado } from '@/lib/catalogo';
import { editarEnBloque, editarProducto, validarProducto } from './acciones';
import BarraBloque, { type Categoria } from './BarraBloque';
import { faltasDe, type ProductoCatalogo } from './tipos';
import { confirmar } from '@/components/Dialogo';

// Vista de lista al estilo de Odoo: columnas que se prenden y apagan (quedan recordadas en este
// equipo), edición en la celda y, si hay filas seleccionadas, el cambio se ofrece para todas.
type Editor = 'texto' | 'mayus' | 'num' | 'ub' | 'cat' | 'cons' | 'tipo';
type Col = {
  k: string; t: string; def: boolean; edit?: Editor; campo?: ['generico' | 'producto', string]; bloque?: boolean;
  ver: (p: ProductoCatalogo) => React.ReactNode; valor?: (p: ProductoCatalogo) => string; der?: boolean;
};
const pesos = (n: number | null) => (n === null ? '—' : Number(n).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: Number(n) < 100 ? 2 : 0 }));
const cant = (n: number | null) => (n === null ? '—' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: 3 }));

const COLUMNAS: Col[] = [
  { k: 'codigo', t: 'Código', def: true, ver: (p) => <span className="cod">{p.codigo}</span> },
  { k: 'generico', t: 'Genérico', def: true, edit: 'texto', campo: ['generico', 'nombre'], ver: (p) => <strong>{p.generico}</strong>, valor: (p) => p.generico },
  { k: 'marca', t: 'Marca', def: true, edit: 'texto', campo: ['producto', 'marca'], ver: (p) => p.marca || <span className="suave">—</span>, valor: (p) => p.marca },
  { k: 'presentacion', t: 'Presentación', def: true, edit: 'texto', campo: ['producto', 'presentacion'], ver: (p) => p.presentacion, valor: (p) => p.presentacion },
  { k: 'area', t: 'Área', def: false, ver: (p) => (p.area === 'BAR' ? 'Bar' : 'Cocina') },
  { k: 'tipo', t: 'Tipo', def: true, edit: 'tipo', campo: ['generico', 'tipo'], ver: (p) => p.tipo, valor: (p) => p.tipo },
  { k: 'categoria', t: 'Categoría', def: true, edit: 'cat', campo: ['generico', 'categoria'], bloque: true,
    ver: (p) => p.categoria_nombre ?? <span style={{ color: 'var(--aviso)' }}>Sin categoría</span>, valor: (p) => p.categoria ?? '' },
  { k: 'unidad_base', t: 'Unidad base', def: true, edit: 'ub', campo: ['generico', 'unidad_base'], bloque: true, ver: (p) => p.unidad_base, valor: (p) => p.unidad_base },
  { k: 'unidad_compra', t: 'Unidad compra', def: true, edit: 'mayus', campo: ['producto', 'unidad_compra'], bloque: true, ver: (p) => p.unidad_compra || '—', valor: (p) => p.unidad_compra },
  { k: 'contenido', t: 'Contenido', def: true, edit: 'num', campo: ['producto', 'contenido_base'], bloque: true, der: true,
    ver: (p) => (p.contenido_variable ? <span className="suave">variable</span> : p.contenido_base ? `${cant(p.contenido_base)} ${p.unidad_base}` : <span style={{ color: 'var(--aviso)' }}>—</span>),
    valor: (p) => (p.contenido_base === null ? '' : String(p.contenido_base)) },
  { k: 'conservacion', t: 'Conservación', def: true, edit: 'cons', campo: ['generico', 'conservacion'], bloque: true,
    ver: (p) => p.conservacion ?? <span className="suave">—</span>, valor: (p) => p.conservacion ?? '' },
  { k: 'estado', t: 'Estado', def: true, ver: (p) => <span className={`etiqueta ${p.activo ? p.estado.toLowerCase() : 'inactivo'}`}>{p.activo ? p.estado : 'INACTIVO'}</span> },
  { k: 'abc', t: 'Clase', def: false, ver: (p) => p.clase_abc ?? '—' },
  { k: 'costo_referencia', t: 'Costo de partida', def: true, der: true, ver: (p) => (p.costo_referencia === null ? '—' : `${pesos(p.costo_referencia)}/${p.unidad_base}`) },
  { k: 'costo_promedio', t: 'Costo promedio', def: false, der: true, ver: (p) => (p.costo_promedio === null ? '—' : `${pesos(p.costo_promedio)}/${p.unidad_base}`) },
  { k: 'saldo', t: 'Saldo', def: false, der: true, ver: (p) => (p.saldo === null ? '—' : `${cant(p.saldo)} ${p.unidad_base}`) },
  { k: 'kardex', t: 'Kardex', def: false, ver: (p) => (p.con_kardex ? 'sí' : 'no') },
  { k: 'faltas', t: 'Le falta', def: true, ver: (p) => { const f = faltasDe(p); return f.length ? <span style={{ color: 'var(--aviso)', fontSize: '.85rem' }}>{f.join(', ')}</span> : <span style={{ color: 'var(--ok)' }}>✓</span>; } },
  { k: 'creado_por', t: 'Creado por', def: false, ver: (p) => p.creado_por ?? 'migración' },
];
const CLAVE_COLUMNAS = 'sgi-catalogo-columnas';

export default function TablaCatalogo({ filas, categorias, esAdmin }: { filas: ProductoCatalogo[]; categorias: Categoria[]; esAdmin?: boolean }) {
  const router = useRouter();
  const [visibles, setVisibles] = useState<string[]>(COLUMNAS.filter((c) => c.def).map((c) => c.k));
  const [menu, setMenu] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editando, setEditando] = useState<{ id: string; k: string } | null>(null);
  const [borrador, setBorrador] = useState('');
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string; lista?: string[] } | null>(null);
  const [enviando, iniciar] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem(CLAVE_COLUMNAS) || 'null'); if (Array.isArray(v) && v.length) setVisibles(v); } catch { /* nada */ }
  }, []);
  useEffect(() => {
    const cerrar = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, []);
  const alternarCol = (k: string) => setVisibles((v) => {
    const n = v.includes(k) ? v.filter((x) => x !== k) : COLUMNAS.filter((c) => v.includes(c.k) || c.k === k).map((c) => c.k);
    try { localStorage.setItem(CLAVE_COLUMNAS, JSON.stringify(n)); } catch { /* nada */ }
    return n;
  });
  const cols = COLUMNAS.filter((c) => visibles.includes(c.k));
  const editables = filas.filter((f) => f.edita);
  const todas = editables.length > 0 && editables.every((f) => sel.has(f.id));
  const cambia = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function abrir(p: ProductoCatalogo, c: Col) {
    if (!p.edita || !c.edit || enviando) return;
    if (c.edit === 'tipo' && !['MPe', 'MPI'].includes(p.tipo)) return;
    setEditando({ id: p.id, k: c.k });
    setBorrador(c.valor?.(p) ?? '');
    setMensaje(null);
  }

  async function guardar(p: ProductoCatalogo, c: Col, valor: string) {
    setEditando(null);
    if (valor === (c.valor?.(p) ?? '')) return;
    const v: string | number | null = c.edit === 'num' ? (valor.trim() === '' ? null : Number(valor.replace(',', '.')))
      : c.edit === 'mayus' ? valor.trim().toUpperCase() : valor;
    const cambios = { [c.campo![0]]: { [c.campo![1]]: v } };
    const enBloque = c.bloque && sel.has(p.id) && sel.size > 1;
    if (enBloque && !(await confirmar(`¿Cambiar «${c.t}» en los ${sel.size} productos seleccionados?`, { aceptar: 'Cambiar' }))) return;
    iniciar(async () => {
      if (enBloque) {
        const r = await editarEnBloque([...sel], cambios, false);
        if ('error' in r) setMensaje({ ok: false, texto: r.error });
        else setMensaje({ ok: !r.fallidos, texto: `${c.t}: ${r.ok} cambiado(s)${r.fallidos ? `, ${r.fallidos} no` : ''}.`,
                          lista: r.detalle.filter((d) => !d.ok).map((d) => `${d.codigo}: ${d.mensajes.join(' ')}`) });
      } else {
        const r: Resultado = await editarProducto({ id: p.id, ...cambios });
        setMensaje(r.ok ? { ok: true, texto: `${p.generico}: ${c.t.toLowerCase()} guardado.${r.avisos.length ? ` ${r.avisos.join(' ')}` : ''}` }
                        : { ok: false, texto: `${p.generico}: no se guardó.`, lista: r.fatales });
      }
      router.refresh();
    });
  }

  function editor(p: ProductoCatalogo, c: Col) {
    const comun = { autoFocus: true, style: { minHeight: 34, padding: '.2rem .4rem', minWidth: 90 } as React.CSSProperties,
                    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Escape') setEditando(null); } };
    const opciones = c.edit === 'ub' ? [['g', 'g'], ['ml', 'ml'], ['und', 'und']]
      : c.edit === 'cons' ? [['', '— sin definir —'], ['Ambiente', 'Ambiente'], ['Refrigerado', 'Refrigerado'], ['Congelado', 'Congelado']]
      : c.edit === 'tipo' ? [['MPe', 'MPe'], ['MPI', 'MPI']]
      : c.edit === 'cat' ? [['', '— sin categoría —'], ...categorias.filter((x) => x.area === p.area).map((x) => [x.codigo, x.nombre])]
      : null;
    if (opciones) {
      return (
        <select {...comun} value={borrador} onChange={(e) => guardar(p, c, e.target.value)} onBlur={() => setEditando(null)}>
          {opciones.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      );
    }
    return (
      <input {...comun} value={borrador} inputMode={c.edit === 'num' ? 'decimal' : undefined}
             onChange={(e) => setBorrador(e.target.value)} onBlur={() => guardar(p, c, borrador)}
             onKeyDown={(e) => { if (e.key === 'Enter') guardar(p, c, borrador); if (e.key === 'Escape') setEditando(null); }} />
    );
  }

  return (
    <>
      <div ref={menuRef} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', margin: '0 0 .4rem', position: 'relative' }}>
        <span className="suave" style={{ fontSize: '.85rem' }}>
          Toca una celda para corregirla{sel.size > 1 ? `; con ${sel.size} filas seleccionadas, el cambio se ofrece para todas` : ''}. Enter guarda, Esc cancela.
        </span>
        <button type="button" className={menu ? 'herramienta chico activa' : 'herramienta chico'} style={{ whiteSpace: 'nowrap' }} onClick={() => setMenu((m) => !m)}>⚙ Columnas</button>
        {menu && (
          <div className="tarjeta" style={{ position: 'absolute', right: 0, top: '100%', zIndex: 20, minWidth: 230, boxShadow: '0 8px 28px rgb(0 0 0 / .25)' }}>
            {COLUMNAS.map((c) => (
              <label key={c.k} style={{ display: 'flex', gap: '.45rem', alignItems: 'center', fontWeight: 400, margin: '.15rem 0' }}>
                <input type="checkbox" checked={visibles.includes(c.k)} onChange={() => alternarCol(c.k)} style={{ width: 20, minHeight: 20 }} />
                {c.t}
              </label>
            ))}
          </div>
        )}
      </div>
      {mensaje && (
        <div className={mensaje.ok ? 'exito' : 'error'} role="status" style={{ margin: '0 0 .6rem' }}>
          {mensaje.texto}{mensaje.lista && mensaje.lista.length > 0 && <ul>{mensaje.lista.map((m) => <li key={m}>{m}</li>)}</ul>}
        </div>
      )}
      <div className="desborde tarjeta" style={{ padding: 0 }}>
        <table className="tabla tabla-catalogo tabla-movil">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                {editables.length > 0 && (
                  <input type="checkbox" aria-label="Seleccionar todos" checked={todas} style={{ width: 20, minHeight: 20 }}
                         onChange={() => setSel(todas ? new Set() : new Set(editables.map((f) => f.id)))} />
                )}
              </th>
              {cols.map((c) => <th key={c.k} style={c.der ? { textAlign: 'right' } : undefined}>{c.t}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {filas.map((p, i) => (
              <Fragment key={p.id}>
                {p.grupo !== null && (i === 0 || filas[i - 1].grupo !== p.grupo) && (
                  <tr className="fila-grupo">
                    <td colSpan={cols.length + 2}><strong>{p.grupo}</strong> <span className="suave">· {p.total_grupo}</span></td>
                  </tr>
                )}
                <tr className={sel.has(p.id) ? 'elegida' : undefined}>
                  <td className="celda-sel">{p.edita && <input type="checkbox" aria-label={`Seleccionar ${p.generico}`} checked={sel.has(p.id)} onChange={() => cambia(p.id)} style={{ width: 20, minHeight: 20 }} />}</td>
                  {cols.map((c) => {
                    const puede = p.edita && !!c.edit && !(c.edit === 'tipo' && !['MPe', 'MPI'].includes(p.tipo));
                    return (
                      <td key={c.k} data-t={c.t} className={puede ? 'celda-editable' : undefined} style={c.der ? { textAlign: 'right', whiteSpace: 'nowrap' } : undefined}
                          onClick={() => editando?.id === p.id && editando.k === c.k ? null : abrir(p, c)}
                          title={puede ? (c.bloque && sel.has(p.id) && sel.size > 1 ? `Cambiar en los ${sel.size} seleccionados` : 'Tocar para corregir') : undefined}>
                        {editando?.id === p.id && editando.k === c.k ? editor(p, c) : c.ver(p)}
                      </td>
                    );
                  })}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {p.edita && <Link href={`/catalogo/producto/${p.id}`} className="suave" style={{ fontSize: '.85rem' }}>Abrir</Link>}
                    {p.edita && p.estado === 'PROVISIONAL' && p.activo && (
                      <form action={validarProducto} style={{ display: 'inline', marginLeft: '.5rem' }}>
                        <input type="hidden" name="id" value={p.id} />
                        <button type="submit" className="secundario mini">Validar</button>
                      </form>
                    )}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <BarraBloque elegidos={filas.filter((f) => sel.has(f.id))} categorias={categorias} setSel={setSel} esAdmin={esAdmin} />
    </>
  );
}
