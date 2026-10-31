'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import VistaFiltrable, { type Agrupar, type Columna, type Grupo } from '@/components/VistaFiltrable';
import { decidirPropuestas } from './acciones';
import EliminarProductos from '@/components/EliminarProductos';

type Cambios = { unidad_base?: string; unidad_compra?: string; contenido_base?: number; contenido_variable?: boolean; categoria?: string;
                 presentacion?: string; conservacion?: string; vida_util_dias?: number };
type Actual = { unidad_base?: string; unidad_compra?: string; contenido_base?: number | null; contenido_variable?: boolean; categoria?: string | null;
                presentacion?: string | null; conservacion?: string | null; vida_util_dias?: number | null };
export type Propuesta = {
  id: string; producto_id: string; codigo: string; generico: string; marca: string; presentacion: string; area: 'BAR' | 'COCINA';
  tipo: string; cambios: Cambios; actual: Actual; categoria_propuesta: string | null; seguridad: 'ALTA' | 'MEDIA' | 'BAJA';
  razon: string | null; estado: 'PENDIENTE' | 'ACEPTADA' | 'CORREGIDA' | 'RECHAZADA' | 'REEMPLAZADA'; mensaje: string | null;
  decidido_por: string | null; decidido_en: string | null; fuente: string;
};
type Categoria = { codigo: string; nombre: string; area: string };

const COLOR = { ALTA: 'var(--ok)', MEDIA: 'var(--aviso)', BAJA: 'var(--error)' };
const QUE: Record<string, { t: string; f: (c: Cambios) => boolean }> = {
  unidad: { t: 'Unidad base', f: (c) => !!c.unidad_base },
  contenido: { t: 'Contenido', f: (c) => c.contenido_base !== undefined },
  variable: { t: 'Se pesa al recibir', f: (c) => !!c.contenido_variable },
  categoria: { t: 'Categoría', f: (c) => !!c.categoria },
  presentacion: { t: 'Presentación', f: (c) => !!c.presentacion },
  almacenamiento: { t: 'Almacenamiento', f: (c) => !!c.conservacion || !!c.vida_util_dias },
};
const ESTADO: Record<string, string> = { PENDIENTE: 'Pendiente', ACEPTADA: 'Aplicada', CORREGIDA: 'Aplicada', RECHAZADA: 'Rechazada', REEMPLAZADA: 'Reemplazada' };
const FUENTE: Record<string, string> = { CLAUDE: 'Revisión del catálogo', 'REGISTRO-PRODUCCION': 'Registro de producción' };
const cant = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: 3 }));

// «actual → propuesta» solo en lo que cambia
const celda = (actual: React.ReactNode, nuevo: React.ReactNode | undefined) => (
  nuevo === undefined ? <span className="suave">{actual}</span>
    : <span><span className="suave" style={{ textDecoration: 'line-through' }}>{actual}</span> → <strong style={{ color: 'var(--marca)' }}>{nuevo}</strong></span>
);
const almacen = (cons?: string | null, vida?: number | null) => [cons, vida && `${vida} d`].filter(Boolean).join(' · ');

export default function Propuestas({ filas, categorias, soloLectura, esAdmin }: { filas: Propuesta[]; categorias: Categoria[]; soloLectura: boolean; esAdmin?: boolean }) {
  const router = useRouter();
  const [corrigiendo, setCorrigiendo] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Cambios & { contenido_texto?: string }>({});
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string; lista?: string[] } | null>(null);
  const [enviando, iniciar] = useTransition();
  const pendientes = filas.filter((p) => p.estado === 'PENDIENTE');

  function decidir(ids: string[], decision: 'ACEPTAR' | 'RECHAZAR', correccion: Cambios | null = null, limpiar?: () => void) {
    if (!ids.length) return;
    if (ids.length > 1 && !confirm(`¿${decision === 'ACEPTAR' ? 'Aceptar' : 'Rechazar'} ${ids.length} propuesta(s)?`)) return;
    setMensaje(null);
    iniciar(async () => {
      const r = await decidirPropuestas(ids, decision, correccion);
      if ('error' in r) { setMensaje({ ok: false, texto: r.error }); return; }
      setMensaje({ ok: !r.fallidos, texto: `${r.ok} ${decision === 'ACEPTAR' ? 'aplicada(s)' : 'rechazada(s)'}${r.fallidos ? `; ${r.fallidos} no se pudieron aplicar y siguen pendientes:` : '.'}`,
                   lista: r.detalle.filter((d) => !d.ok).map((d) => `${d.codigo}: ${d.mensaje ?? ''}`) });
      limpiar?.();
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
    // lo que el panel no muestra (presentación, conservación, vida útil) se aplica como venía propuesto
    const c: Cambios = { presentacion: p.cambios.presentacion, conservacion: p.cambios.conservacion, vida_util_dias: p.cambios.vida_util_dias };
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

  const grupos: Grupo<Propuesta>[] = [
    { clave: 'estado', titulo: 'Estado', valor: (p) => ESTADO[p.estado], opciones: ['Pendiente', 'Aplicada', 'Rechazada', 'Reemplazada'].map((v) => ({ v, t: v })) },
    { clave: 'seguridad', titulo: 'Seguridad', valor: (p) => p.seguridad, opciones: [{ v: 'ALTA', t: 'Alta' }, { v: 'MEDIA', t: 'Media' }, { v: 'BAJA', t: 'Baja (revisar)' }] },
    { clave: 'fuente', titulo: 'Fuente', valor: (p) => p.fuente, opciones: Object.entries(FUENTE).map(([v, t]) => ({ v, t })) },
    { clave: 'area', titulo: 'Área', valor: (p) => p.area, opciones: [{ v: 'BAR', t: 'Bar' }, { v: 'COCINA', t: 'Cocina' }] },
    { clave: 'tipo', titulo: 'Tipo', valor: (p) => p.tipo, opciones: [{ v: 'MPe', t: 'MPe · se compra' }, { v: 'MPI', t: 'MPI · se produce' }] },
    { clave: 'que', titulo: 'Qué cambia', valor: (p) => Object.entries(QUE).filter(([, q]) => q.f(p.cambios)).map(([k]) => k),
      opciones: Object.entries(QUE).map(([v, q]) => ({ v, t: q.t })) },
    { clave: 'unidad', titulo: 'Unidad que queda', valor: (p) => p.cambios.unidad_base ?? p.actual.unidad_base ?? null,
      opciones: [{ v: 'g', t: 'g' }, { v: 'ml', t: 'ml' }, { v: 'und', t: 'und' }] },
    { clave: 'categoria', titulo: 'Categoría propuesta', valor: (p) => p.categoria_propuesta },
  ];
  const agrupar: Agrupar<Propuesta>[] = [
    { v: 'categoria', t: 'Categoría propuesta', valor: (p) => p.categoria_propuesta ?? p.actual.categoria ?? 'Sin categoría' },
    { v: 'seguridad', t: 'Seguridad', valor: (p) => p.seguridad },
    { v: 'fuente', t: 'Fuente', valor: (p) => FUENTE[p.fuente] ?? p.fuente },
    { v: 'area', t: 'Área', valor: (p) => (p.area === 'BAR' ? 'Bar' : 'Cocina') },
    { v: 'estado', t: 'Estado', valor: (p) => ESTADO[p.estado] },
  ];
  const columnas: Columna<Propuesta>[] = [
    { k: 'producto', t: 'Producto', orden: (p) => p.generico, ver: (p) => (
      <div style={{ minWidth: 190 }}>
        <Link href={`/catalogo/producto/${p.producto_id}`}><strong>{p.generico}</strong>{p.marca && ` · ${p.marca}`}</Link>
        <div className="suave" style={{ fontSize: '.82rem' }}>{p.presentacion} · <span className="cod">{p.codigo}</span></div>
      </div>) },
    { k: 'unidad', t: 'Unidad base', orden: (p) => p.cambios.unidad_base ?? p.actual.unidad_base ?? '', ver: (p) => celda(p.actual.unidad_base, p.cambios.unidad_base) },
    { k: 'presentacion', t: 'Presentación', ver: (p) => celda(p.actual.presentacion ?? p.presentacion, p.cambios.presentacion) },
    { k: 'compra', t: 'Compra', ver: (p) => celda(p.actual.unidad_compra, p.cambios.unidad_compra) },
    { k: 'contenido', t: 'Contenido', ver: (p) => {
      const a = p.actual, c = p.cambios;
      return <span style={{ whiteSpace: 'nowrap' }}>{celda(a.contenido_variable ? 'variable' : `${cant(a.contenido_base)} ${a.unidad_base ?? ''}`,
        c.contenido_variable ? 'se pesa al recibir' : c.contenido_base !== undefined ? `${cant(c.contenido_base)} ${c.unidad_base ?? a.unidad_base}` : undefined)}</span>;
    } },
    { k: 'categoria', t: 'Categoría', orden: (p) => p.categoria_propuesta ?? p.actual.categoria ?? '',
      ver: (p) => celda(p.actual.categoria ?? 'sin categoría', p.cambios.categoria ? (p.categoria_propuesta ?? p.cambios.categoria) : undefined) },
    { k: 'almacen', t: 'Almacenamiento', ver: (p) => (
      <span style={{ whiteSpace: 'nowrap' }}>{celda(almacen(p.actual.conservacion, p.actual.vida_util_dias) || '—',
        p.cambios.conservacion || p.cambios.vida_util_dias ? almacen(p.cambios.conservacion ?? p.actual.conservacion, p.cambios.vida_util_dias ?? p.actual.vida_util_dias) : undefined)}</span>) },
    { k: 'seguridad', t: 'Seguridad', orden: (p) => ({ ALTA: 0, MEDIA: 1, BAJA: 2 })[p.seguridad],
      ver: (p) => <span className="etiqueta" style={{ color: COLOR[p.seguridad] }}>{p.seguridad.toLowerCase()}</span> },
    { k: 'razon', t: 'Por qué', ver: (p) => (
      <div style={{ fontSize: '.85rem', minWidth: 220 }}>
        {p.fuente === 'REGISTRO-PRODUCCION' && <span className="etiqueta validado" style={{ marginRight: '.3rem' }}>registro</span>}
        {p.razon}
        {p.mensaje && <div style={{ color: p.estado === 'PENDIENTE' ? 'var(--error)' : 'var(--suave)', marginTop: '.2rem' }}>{p.mensaje}</div>}
        {p.estado !== 'PENDIENTE' && <div className="suave" style={{ marginTop: '.2rem' }}>{ESTADO[p.estado].toLowerCase()}{p.decidido_por ? ` · ${p.decidido_por}` : ''}</div>}
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
      </div>) },
    { k: 'acciones', t: '', ver: (p) => (!soloLectura && p.estado === 'PENDIENTE' && corrigiendo !== p.id ? (
      <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
        <button type="button" disabled={enviando} style={{ minHeight: 32, padding: '.1rem .6rem' }} onClick={() => decidir([p.id], 'ACEPTAR')}>Aceptar</button>
        <button type="button" className="secundario" disabled={enviando} style={{ minHeight: 32, padding: '.1rem .6rem' }} onClick={() => abrirCorreccion(p)}>Corregir</button>
        <button type="button" className="secundario" disabled={enviando} style={{ minHeight: 32, padding: '.1rem .6rem' }} onClick={() => decidir([p.id], 'RECHAZAR')}>Rechazar</button>
      </div>) : null) },
  ];

  return (
    <>
      <p style={{ margin: '0 0 .4rem' }}>
        <strong>{pendientes.length}</strong> pendientes de {filas.length}
        <span className="suave"> · seguridad alta {pendientes.filter((p) => p.seguridad === 'ALTA').length} · media {pendientes.filter((p) => p.seguridad === 'MEDIA').length} · baja {pendientes.filter((p) => p.seguridad === 'BAJA').length}</span>
      </p>
      {mensaje && (
        <div className={mensaje.ok ? 'exito' : 'aviso'} role="status">
          {mensaje.texto}{mensaje.lista && mensaje.lista.length > 0 && <ul>{mensaje.lista.map((m) => <li key={m}>{m}</li>)}</ul>}
        </div>
      )}
      <VistaFiltrable clave="propuestas-unidad" filas={filas} id={(p) => p.id}
                      buscar={(p) => `${p.generico} ${p.marca} ${p.presentacion} ${p.codigo} ${p.razon ?? ''}`}
                      grupos={grupos} columnas={columnas} agrupar={agrupar} filtrosIniciales={{ estado: ['Pendiente'] }}
                      seleccionable={soloLectura ? undefined : (p) => p.estado === 'PENDIENTE'}
                      vacio="No quedan propuestas con estos filtros. ✔"
                      acciones={(elegidas, limpiar) => (
                        <div className="barra-bloque">
                          <div className="linea" style={{ flexWrap: 'wrap' }}>
                            <strong>{elegidas.length} seleccionada(s)</strong>
                            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                              <button type="button" disabled={enviando} onClick={() => decidir(elegidas.map((p) => p.id), 'ACEPTAR', null, limpiar)}>{enviando ? 'Aplicando…' : `Aceptar ${elegidas.length}`}</button>
                              <button type="button" className="secundario" disabled={enviando} onClick={() => decidir(elegidas.map((p) => p.id), 'RECHAZAR', null, limpiar)}>Rechazar {elegidas.length}</button>
                              {esAdmin && <EliminarProductos productos={[...new Set(elegidas.map((p) => p.producto_id))].map((id) => ({ id }))} alTerminar={limpiar} etiqueta={`Eliminar los productos (${new Set(elegidas.map((p) => p.producto_id)).size})`} />}
                              <button type="button" className="secundario" disabled={enviando} onClick={limpiar}>Quitar selección</button>
                            </div>
                          </div>
                        </div>
                      )} />
    </>
  );
}
