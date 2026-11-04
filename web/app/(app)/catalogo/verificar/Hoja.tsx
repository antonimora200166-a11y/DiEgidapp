'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import VistaFiltrable, { type Agrupar, type Columna, type Grupo } from '@/components/VistaFiltrable';
import { corregirYVerificar, fijarCosto, marcarParecido, quitarRepetido, unir, verificar, type Correccion } from './acciones';

type Parecido = { generico_id: string; nombre: string; unidad_base: string; parecido: number };
type Hermano = { producto_id: string; codigo: string; marca: string; presentacion: string };
export type Fila = {
  producto_id: string; codigo: string; generico_id: string; generico: string; marca: string; presentacion: string;
  area: 'BAR' | 'COCINA'; tipo: 'MPe' | 'MPI'; categoria: string | null; clase_abc: 'A' | 'B' | 'C' | null;
  unidad_base: 'g' | 'ml' | 'und'; unidad_compra: string; contenido_base: number | null; contenido_variable: boolean;
  valor_compras: number | null; n_compras: number; ult_fecha: string | null; ult_proveedor: string | null; ult_nombre: string | null;
  ult_valor: number | null; ult_cantidad_base: number | null; costo_base: number | null; costo_fuente: string | null;
  costo_min: number | null; costo_max: number | null; tiene_ficha: boolean; tiene_kardex: boolean;
  parecidos: Parecido[]; hermanos: Hermano[]; alertas: string[]; verificado_en: string | null; verificado_por: string | null;
};

const ALERTA: Record<string, { t: string; d: string }> = {
  SIN_PRECIO: { t: 'Sin precio', d: 'No hay compra ni costo de referencia: no se puede costear.' },
  PRESENTACION: { t: 'Presentación ≠ contenido', d: 'La presentación dice una cantidad y el contenido guardado es otro.' },
  UNIDAD_TEXTO: { t: 'Unidad distinta', d: 'La presentación habla en g y el insumo va en ml (o al revés).' },
  CONTENIDO: { t: 'Contenido raro', d: 'Por ejemplo: se compra por KG y el contenido no es 1.000, o una botella con contenido 1.' },
  PRECIO_RARO: { t: 'Costo fuera de rango', d: 'El costo por g, ml o und es demasiado alto o bajo: suele ser una unidad mal puesta.' },
  PRECIOS_DISPARES: { t: 'Precios muy distintos', d: 'Entre una compra y otra el costo por unidad base cambia más del doble.' },
  PARECIDO: { t: 'Posible duplicado', d: 'Hay otro genérico con un nombre muy parecido.' },
  MPI_SIN_FICHA: { t: 'MPI sin ficha', d: 'Sin ficha técnica no tiene costo.' },
  VARIAS_PRESENTACIONES: { t: 'Varias presentaciones', d: 'El genérico tiene otra presentación activa: si es la misma, quita la repetida.' },
};
const GRAVES = ['PRESENTACION', 'CONTENIDO', 'PRECIO_RARO', 'UNIDAD_TEXTO'];

const pesos = (n: number | null | undefined) => (n == null ? '—' : `$${Number(n).toLocaleString('es-CO', { maximumFractionDigits: Math.abs(Number(n)) < 10 ? 2 : 0 })}`);
const cant = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: 3 }));
// «2.500» = 2500 · «0,75» = 0.75 · «$ 20.000» = 20000 · «20000.5» = 20000.5
const numero = (t: string) => {
  const x = t.replace(/[$\s]/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(x)) return Number(x.replace(/\./g, '').replace(',', '.'));
  return Number(x.replace(',', '.'));
};
const fecha = (s: string | null) => (s ? new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' }) : '');

export default function Hoja({ filas, soloLectura }: { filas: Fila[]; soloLectura: boolean }) {
  const router = useRouter();
  const [enviando, iniciar] = useTransition();
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [corrigiendo, setCorrigiendo] = useState<string | null>(null);
  const [b, setB] = useState<{ unidad_base: string; unidad_compra: string; contenido: string; variable: boolean; presentacion: string }>(
    { unidad_base: 'g', unidad_compra: '', contenido: '', variable: false, presentacion: '' });

  // un solo panel abierto a la vez: poner precio, unir con un parecido o quitar una presentación repetida
  const [panel, setPanel] = useState<
    | { tipo: 'precio'; id: string; valor: string; por: 'COMPRA' | 'KILO' | 'BASE'; otras: boolean }
    | { tipo: 'unir'; id: string; otro: string; queda: 'ESTE' | 'OTRO'; factor: string }
    | { tipo: 'repetido'; id: string; queda: string }
    | null>(null);

  const ab = filas.filter((f) => f.tipo === 'MPe' && (f.clase_abc === 'A' || f.clase_abc === 'B'));
  const abHechos = ab.filter((f) => f.verificado_en).length;

  function correr(fn: () => Promise<{ ok: true; avisos?: string[] } | { ok: false; error: string }>, exito: string, despues?: () => void) {
    setMensaje(null);
    iniciar(async () => {
      const r = await fn();
      if (!r.ok) { setMensaje({ ok: false, texto: r.error }); return; }
      setMensaje({ ok: true, texto: [exito, ...(r.avisos ?? [])].join(' ') });
      despues?.();
      router.refresh();
    });
  }

  function abrir(f: Fila) {
    setCorrigiendo(f.producto_id);
    setB({ unidad_base: f.unidad_base, unidad_compra: f.unidad_compra, contenido: f.contenido_base == null ? '' : String(f.contenido_base),
           variable: f.contenido_variable, presentacion: f.presentacion });
  }
  function guardar(f: Fila) {
    const c: Correccion = {};
    if (b.unidad_base !== f.unidad_base) c.unidad_base = b.unidad_base;
    if (b.unidad_compra.trim().toUpperCase() !== f.unidad_compra) c.unidad_compra = b.unidad_compra.trim().toUpperCase();
    if (b.presentacion.trim() !== f.presentacion) c.presentacion = b.presentacion.trim();
    if (b.variable !== f.contenido_variable) c.contenido_variable = b.variable;
    if (!b.variable) {
      const t = b.contenido.trim();
      const v = Number(/^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t.replace(',', '.'));  // «2.500» = 2500 · «0,75» = 0.75
      if (!(v > 0)) { setMensaje({ ok: false, texto: 'El contenido debe ser un número mayor que cero (o marca «se pesa al recibir»).' }); return; }
      if (v !== Number(f.contenido_base)) c.contenido_base = v;
    }
    correr(() => corregirYVerificar(f.producto_id, c), `${f.generico}: corregido y verificado.`, () => setCorrigiendo(null));
  }

  function costoEscrito(f: Fila, valor: string, por: 'COMPRA' | 'KILO' | 'BASE') {
    const v = numero(valor);
    if (!(v > 0)) return null;
    if (por === 'COMPRA') return f.contenido_variable || !f.contenido_base ? null : v / Number(f.contenido_base);
    return por === 'KILO' ? v / 1000 : v;
  }
  function guardarPrecio(f: Fila) {
    if (panel?.tipo !== 'precio') return;
    const v = numero(panel.valor);
    if (!(v > 0)) { setMensaje({ ok: false, texto: 'Escribe el precio en pesos, mayor que cero.' }); return; }
    const { por, otras } = panel;
    correr(() => fijarCosto(f.producto_id, v, por, otras), `${f.generico}: precio guardado.`, () => setPanel(null));
  }
  function guardarUnion(f: Fila, p: Parecido) {
    if (panel?.tipo !== 'unir') return;
    const este = panel.queda === 'ESTE';
    const [queda, va, ubQueda, ubVa] = este ? [f.generico_id, p.generico_id, f.unidad_base, p.unidad_base]
                                            : [p.generico_id, f.generico_id, p.unidad_base, f.unidad_base];
    let factor: number | null = null;
    if (ubQueda !== ubVa) {
      factor = numero(panel.factor);
      if (!(factor > 0)) { setMensaje({ ok: false, texto: `Di cuántos ${ubQueda} son 1 ${ubVa}.` }); return; }
    }
    const nombre = este ? f.generico : p.nombre;
    correr(() => unir(queda, va, factor), `Unidos en «${nombre}».`, () => setPanel(null));
  }

  const grupos: Grupo<Fila>[] = [
    { clave: 'estado', titulo: 'Verificación', valor: (f) => (f.verificado_en ? 'Verificado' : 'Pendiente'), opciones: [{ v: 'Pendiente', t: 'Pendiente' }, { v: 'Verificado', t: 'Verificado' }] },
    { clave: 'clase', titulo: 'Clase ABC', valor: (f) => f.clase_abc ?? 'SIN', opciones: [{ v: 'A', t: 'A · 80 % de la compra' }, { v: 'B', t: 'B · 15 %' }, { v: 'C', t: 'C · 5 %' }, { v: 'SIN', t: 'Sin clase' }] },
    { clave: 'area', titulo: 'Área', valor: (f) => f.area, opciones: [{ v: 'BAR', t: 'Bar' }, { v: 'COCINA', t: 'Cocina' }] },
    { clave: 'tipo', titulo: 'Tipo', valor: (f) => f.tipo, opciones: [{ v: 'MPe', t: 'MPe · se compra' }, { v: 'MPI', t: 'MPI · se produce' }] },
    { clave: 'alerta', titulo: 'Alertas', valor: (f) => (f.alertas.length ? f.alertas : ['NINGUNA']),
      opciones: [...Object.entries(ALERTA).map(([v, a]) => ({ v, t: a.t })), { v: 'NINGUNA', t: 'Sin alertas' }] },
    { clave: 'unidad', titulo: 'Unidad base', valor: (f) => f.unidad_base, opciones: [{ v: 'g', t: 'g' }, { v: 'ml', t: 'ml' }, { v: 'und', t: 'und' }] },
    { clave: 'categoria', titulo: 'Categoría', valor: (f) => f.categoria },
  ];
  const agrupar: Agrupar<Fila>[] = [
    { v: 'categoria', t: 'Categoría', valor: (f) => f.categoria ?? 'Sin categoría' },
    { v: 'clase', t: 'Clase ABC', valor: (f) => (f.clase_abc ? `Clase ${f.clase_abc}` : 'Sin clase') },
    { v: 'area', t: 'Área', valor: (f) => (f.area === 'BAR' ? 'Bar' : 'Cocina') },
  ];

  const columnas: Columna<Fila>[] = [
    { k: 'producto', t: 'Producto', orden: (f) => f.generico, ver: (f) => (
      <div style={{ minWidth: 190 }}>
        <Link href={`/catalogo/producto/${f.producto_id}`}><strong>{f.generico}</strong>{f.marca && ` · ${f.marca}`}</Link>
        <div className="suave" style={{ fontSize: '.82rem' }}>
          {f.presentacion} · <span className="cod">{f.codigo}</span>
          {f.clase_abc && <> · <span className="etiqueta">clase {f.clase_abc}</span></>}
        </div>
        {f.hermanos.length > 0 && (
          <div style={{ fontSize: '.8rem', marginTop: '.2rem' }}>
            <span className="suave">También: {f.hermanos.map((h) => [h.marca, h.presentacion].filter(Boolean).join(' · ')).join(' / ')}</span>
            {!soloLectura && (panel?.tipo === 'repetido' && panel.id === f.producto_id ? (
              <div className="tarjeta" style={{ display: 'grid', gap: '.35rem', marginTop: '.3rem' }}>
                <label style={{ margin: 0 }}>Esta presentación está repetida de:
                  <select value={panel.queda} onChange={(e) => setPanel({ ...panel, queda: e.target.value })}>
                    {f.hermanos.map((h) => <option key={h.producto_id} value={h.producto_id}>{[h.marca, h.presentacion].filter(Boolean).join(' · ')} ({h.codigo})</option>)}
                  </select>
                </label>
                <span className="suave">Esta («{f.presentacion}») queda inactiva; sus nombres de factura y su costo pasan a la otra.</span>
                <div style={{ display: 'flex', gap: '.3rem' }}>
                  <button type="button" className="mini" disabled={enviando}
                          onClick={() => { const q = panel.queda; correr(() => quitarRepetido(f.producto_id, q), 'Presentación repetida quitada.', () => setPanel(null)); }}>Quitar esta</button>
                  <button type="button" className="secundario mini" onClick={() => setPanel(null)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <div><button type="button" className="secundario mini" style={{ marginTop: '.2rem' }}
                           onClick={() => setPanel({ tipo: 'repetido', id: f.producto_id, queda: f.hermanos[0].producto_id })}>Esta está repetida</button></div>
            ))}
          </div>
        )}
        {f.verificado_en && <div style={{ color: 'var(--ok)', fontSize: '.82rem' }}>✓ verificado{f.verificado_por ? ` · ${f.verificado_por}` : ''} · {fecha(f.verificado_en)}</div>}
      </div>) },
    { k: 'unidad', t: 'Unidad y contenido', orden: (f) => f.unidad_base, ver: (f) => (
      <div style={{ whiteSpace: 'nowrap' }}>
        <strong>1 {f.unidad_compra}</strong> = {f.contenido_variable ? <em>se pesa al recibir</em> : <>{cant(f.contenido_base)} {f.unidad_base}</>}
        <div className="suave" style={{ fontSize: '.82rem' }}>unidad base: {f.unidad_base}</div>
      </div>) },
    { k: 'precio', t: 'Último precio', orden: (f) => f.ult_fecha ?? '', ver: (f) => (f.ult_valor == null ? <span className="suave">sin compras</span> : (
      <div style={{ fontSize: '.88rem', minWidth: 170 }}>
        <strong>{pesos(f.ult_valor)}</strong> por {cant(f.ult_cantidad_base)} {f.unidad_base}
        <div className="suave" style={{ fontSize: '.8rem' }}>{fecha(f.ult_fecha)} · {f.ult_proveedor ?? 'sin proveedor'}{f.n_compras > 1 ? ` · ${f.n_compras} compras` : ''}</div>
        {f.ult_nombre && f.ult_nombre !== f.generico && <div className="suave" style={{ fontSize: '.8rem' }}>«{f.ult_nombre}»</div>}
      </div>)) },
    { k: 'costo', t: 'Costo', der: true, orden: (f) => f.costo_base, ver: (f) => (f.costo_base == null ? <span className="suave">—</span> : (
      <div style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
        {pesos(f.costo_base)} / {f.unidad_base}
        {!f.contenido_variable && f.contenido_base && (
          <div style={{ fontSize: '.85rem' }}><strong>1 {f.unidad_compra} = {pesos(Number(f.costo_base) * Number(f.contenido_base))}</strong></div>
        )}
        {f.costo_min != null && f.costo_max != null && Number(f.costo_max) > Number(f.costo_min) * 1.05 && (
          <div className="suave" style={{ fontSize: '.78rem' }}>{pesos(f.costo_min)} a {pesos(f.costo_max)}</div>
        )}
        <div className="suave" style={{ fontSize: '.75rem' }}>{f.costo_fuente}</div>
      </div>)) },
    { k: 'alertas', t: 'Alertas', orden: (f) => -f.alertas.filter((a) => GRAVES.includes(a)).length, ver: (f) => (
      <div style={{ display: 'flex', gap: '.25rem', flexWrap: 'wrap', minWidth: 120 }}>
        {f.alertas.map((a) => (
          <span key={a} className="etiqueta" title={ALERTA[a]?.d} style={{ color: GRAVES.includes(a) ? 'var(--error)' : 'var(--aviso)' }}>{ALERTA[a]?.t ?? a}</span>
        ))}
      </div>) },
    { k: 'parecidos', t: 'Parecidos', ver: (f) => (f.parecidos.length ? (
      <div style={{ display: 'grid', gap: '.3rem', minWidth: 200, fontSize: '.85rem' }}>
        {f.parecidos.map((p) => (
          <div key={p.generico_id}>
            {p.nombre} <span className="suave">({p.unidad_base} · {Math.round(p.parecido * 100)} %)</span>
            {!soloLectura && (
              <div style={{ display: 'flex', gap: '.25rem', marginTop: '.15rem' }}>
                <button type="button" className="secundario mini" disabled={enviando}
                        onClick={() => setPanel({ tipo: 'unir', id: f.producto_id, otro: p.generico_id, queda: 'ESTE', factor: '' })}>Es el mismo: unir</button>
                <button type="button" className="secundario mini" disabled={enviando}
                        onClick={() => correr(() => marcarParecido(f.generico_id, p.generico_id, 'SEPARAR'), `«${p.nombre}» ya no sale como parecido de «${f.generico}».`)}>No es</button>
              </div>
            )}
            {panel?.tipo === 'unir' && panel.id === f.producto_id && panel.otro === p.generico_id && (
              <div className="tarjeta" style={{ display: 'grid', gap: '.35rem', marginTop: '.3rem' }}>
                <strong>¿Cuál nombre se queda?</strong>
                {(['ESTE', 'OTRO'] as const).map((k) => (
                  <label key={k} style={{ margin: 0, display: 'flex', gap: '.4rem', alignItems: 'center', fontWeight: 400 }}>
                    <input type="radio" name={`queda-${f.producto_id}-${p.generico_id}`} checked={panel.queda === k} style={{ width: 18, minHeight: 18 }}
                           onChange={() => setPanel({ ...panel, queda: k })} />
                    {k === 'ESTE' ? `${f.generico} (${f.unidad_base})` : `${p.nombre} (${p.unidad_base})`}
                  </label>
                ))}
                {p.unidad_base !== f.unidad_base && (
                  <label style={{ margin: 0 }}>
                    Van en unidades distintas: 1 {panel.queda === 'ESTE' ? p.unidad_base : f.unidad_base} = ¿cuántos {panel.queda === 'ESTE' ? f.unidad_base : p.unidad_base}?
                    <input inputMode="decimal" value={panel.factor} onChange={(e) => setPanel({ ...panel, factor: e.target.value })} />
                  </label>
                )}
                <span className="suave">El otro queda inactivo; sus presentaciones, nombres de factura y compras pasan al que se queda.</span>
                <div style={{ display: 'flex', gap: '.3rem' }}>
                  <button type="button" className="mini" disabled={enviando} onClick={() => guardarUnion(f, p)}>{enviando ? 'Uniendo…' : 'Unir'}</button>
                  <button type="button" className="secundario mini" onClick={() => setPanel(null)}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>) : null) },
    { k: 'acciones', t: '', ver: (f) => (soloLectura ? null : corrigiendo === f.producto_id ? (
      <div className="tarjeta" style={{ display: 'grid', gap: '.4rem', minWidth: 220 }}>
        <label style={{ margin: 0 }}>Presentación
          <input value={b.presentacion} onChange={(e) => setB({ ...b, presentacion: e.target.value })} />
        </label>
        <label style={{ margin: 0 }}>Unidad base
          <select value={b.unidad_base} disabled={f.tiene_kardex || f.tiene_ficha} onChange={(e) => setB({ ...b, unidad_base: e.target.value })}>
            <option value="g">g</option><option value="ml">ml</option><option value="und">und</option>
          </select>
          {(f.tiene_kardex || f.tiene_ficha) && <span className="suave" style={{ fontSize: '.78rem' }}>No se cambia: ya tiene {f.tiene_kardex ? 'kardex' : 'ficha técnica'}.</span>}
        </label>
        <label style={{ margin: 0 }}>Unidad de compra (BOT, PAQ, KG…)
          <input value={b.unidad_compra} onChange={(e) => setB({ ...b, unidad_compra: e.target.value })} />
        </label>
        <label style={{ margin: 0, display: 'flex', gap: '.4rem', alignItems: 'center', fontWeight: 400 }}>
          <input type="checkbox" checked={b.variable} style={{ width: 20, minHeight: 20 }} onChange={(e) => setB({ ...b, variable: e.target.checked })} />
          Se pesa al recibir (contenido variable)
        </label>
        {!b.variable && (
          <label style={{ margin: 0 }}>Cuánto trae 1 {b.unidad_compra || 'unidad'} ({b.unidad_base})
            <input inputMode="decimal" value={b.contenido} onChange={(e) => setB({ ...b, contenido: e.target.value })} />
          </label>
        )}
        <div style={{ display: 'flex', gap: '.4rem' }}>
          <button type="button" disabled={enviando} onClick={() => guardar(f)}>{enviando ? 'Guardando…' : 'Guardar y verificar'}</button>
          <button type="button" className="secundario" disabled={enviando} onClick={() => setCorrigiendo(null)}>Cancelar</button>
        </div>
      </div>
    ) : (
      <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
        {f.verificado_en
          ? <button type="button" className="secundario mini" disabled={enviando} onClick={() => correr(() => verificar([f.producto_id], false), `${f.generico}: vuelve a pendiente.`)}>Quitar ✓</button>
          : <button type="button" className="mini" disabled={enviando} onClick={() => correr(() => verificar([f.producto_id]), `${f.generico}: verificado.`)}>Verificado</button>}
        <button type="button" className="secundario mini" disabled={enviando} onClick={() => abrir(f)}>Corregir</button>
        {f.tipo === 'MPe' && !f.tiene_kardex && (
          <button type="button" className="secundario mini" disabled={enviando}
                  onClick={() => setPanel({ tipo: 'precio', id: f.producto_id, valor: '', otras: true,
                                            por: !f.contenido_variable && f.contenido_base ? 'COMPRA' : f.unidad_base === 'und' ? 'BASE' : 'KILO' })}>
            {f.costo_base == null ? 'Poner precio' : 'Cambiar precio'}
          </button>
        )}
        {panel?.tipo === 'precio' && panel.id === f.producto_id && (() => {
          const cu = costoEscrito(f, panel.valor, panel.por);
          const opciones: { v: 'COMPRA' | 'KILO' | 'BASE'; t: string }[] = [
            ...(!f.contenido_variable && f.contenido_base ? [{ v: 'COMPRA' as const, t: `1 ${f.unidad_compra} (${cant(f.contenido_base)} ${f.unidad_base})` }] : []),
            ...(f.unidad_base !== 'und' ? [{ v: 'KILO' as const, t: f.unidad_base === 'g' ? '1 kg' : '1 litro' }] : []),
            { v: 'BASE' as const, t: `1 ${f.unidad_base}` },
          ];
          return (
            <div className="tarjeta" style={{ display: 'grid', gap: '.4rem', minWidth: 220, width: '100%' }}>
              <label style={{ margin: 0 }}>Precio en pesos
                <input inputMode="decimal" autoFocus placeholder="Ej.: 20.000" value={panel.valor} onChange={(e) => setPanel({ ...panel, valor: e.target.value })} />
              </label>
              <label style={{ margin: 0 }}>Por
                <select value={panel.por} onChange={(e) => setPanel({ ...panel, por: e.target.value as 'COMPRA' | 'KILO' | 'BASE' })}>
                  {opciones.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
                </select>
              </label>
              {cu != null && <span className="suave">= {pesos(cu)} por {f.unidad_base}</span>}
              {f.hermanos.length > 0 && (
                <label style={{ margin: 0, display: 'flex', gap: '.4rem', alignItems: 'center', fontWeight: 400 }}>
                  <input type="checkbox" checked={panel.otras} style={{ width: 20, minHeight: 20 }} onChange={(e) => setPanel({ ...panel, otras: e.target.checked })} />
                  También a sus otras presentaciones sin precio propio
                </label>
              )}
              <div style={{ display: 'flex', gap: '.4rem' }}>
                <button type="button" disabled={enviando} onClick={() => guardarPrecio(f)}>{enviando ? 'Guardando…' : 'Guardar precio'}</button>
                <button type="button" className="secundario" onClick={() => setPanel(null)}>Cancelar</button>
              </div>
            </div>
          );
        })()}
      </div>)) },
  ];

  return (
    <>
      <p className="pagina-ancha" style={{ margin: '0 0 .4rem' }}>
        <strong>{abHechos} de {ab.length}</strong> insumos A/B verificados
        <span className="suave"> · {ab.filter((f) => !f.verificado_en && f.alertas.some((a) => GRAVES.includes(a))).length} pendientes con alerta grave
          · {ab.filter((f) => f.alertas.includes('SIN_PRECIO')).length} sin precio</span>
      </p>
      {mensaje && <div className={mensaje.ok ? 'exito' : 'aviso'} role="status">{mensaje.texto}</div>}
      <VistaFiltrable clave="verificar-ab" filas={filas} id={(f) => f.producto_id}
                      buscar={(f) => `${f.generico} ${f.marca} ${f.presentacion} ${f.codigo} ${f.ult_nombre ?? ''} ${f.ult_proveedor ?? ''}`}
                      grupos={grupos} columnas={columnas} agrupar={agrupar}
                      filtrosIniciales={{ estado: ['Pendiente'], clase: ['A', 'B'], tipo: ['MPe'] }}
                      seleccionable={soloLectura ? undefined : (f) => !f.verificado_en}
                      vacio="Nada pendiente con estos filtros. ✔"
                      acciones={(elegidas, limpiar) => (
                        <div className="barra-bloque">
                          <div className="linea" style={{ flexWrap: 'wrap' }}>
                            <strong>{elegidas.length} seleccionado(s)</strong>
                            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                              <button type="button" disabled={enviando}
                                      onClick={() => correr(() => verificar(elegidas.map((f) => f.producto_id)), `${elegidas.length} verificado(s).`, limpiar)}>
                                Marcar {elegidas.length} como verificados
                              </button>
                              <button type="button" className="secundario" disabled={enviando} onClick={limpiar}>Quitar selección</button>
                            </div>
                          </div>
                        </div>
                      )} />
    </>
  );
}
