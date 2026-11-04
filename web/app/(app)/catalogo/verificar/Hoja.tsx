'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import VistaFiltrable, { type Agrupar, type Columna, type Grupo } from '@/components/VistaFiltrable';
import { corregirYVerificar, marcarParecido, verificar, type Correccion } from './acciones';

type Parecido = { generico_id: string; nombre: string; unidad_base: string; parecido: number };
export type Fila = {
  producto_id: string; codigo: string; generico_id: string; generico: string; marca: string; presentacion: string;
  area: 'BAR' | 'COCINA'; tipo: 'MPe' | 'MPI'; categoria: string | null; clase_abc: 'A' | 'B' | 'C' | null;
  unidad_base: 'g' | 'ml' | 'und'; unidad_compra: string; contenido_base: number | null; contenido_variable: boolean;
  valor_compras: number | null; n_compras: number; ult_fecha: string | null; ult_proveedor: string | null; ult_nombre: string | null;
  ult_valor: number | null; ult_cantidad_base: number | null; costo_base: number | null; costo_fuente: string | null;
  costo_min: number | null; costo_max: number | null; tiene_ficha: boolean; tiene_kardex: boolean;
  parecidos: Parecido[]; alertas: string[]; verificado_en: string | null; verificado_por: string | null;
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
};
const GRAVES = ['PRESENTACION', 'CONTENIDO', 'PRECIO_RARO', 'UNIDAD_TEXTO'];

const pesos = (n: number | null | undefined) => (n == null ? '—' : `$${Number(n).toLocaleString('es-CO', { maximumFractionDigits: Math.abs(Number(n)) < 10 ? 2 : 0 })}`);
const cant = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: 3 }));
const fecha = (s: string | null) => (s ? new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' }) : '');

export default function Hoja({ filas, soloLectura }: { filas: Fila[]; soloLectura: boolean }) {
  const router = useRouter();
  const [enviando, iniciar] = useTransition();
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [corrigiendo, setCorrigiendo] = useState<string | null>(null);
  const [b, setB] = useState<{ unidad_base: string; unidad_compra: string; contenido: string; variable: boolean; presentacion: string }>(
    { unidad_base: 'g', unidad_compra: '', contenido: '', variable: false, presentacion: '' });

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
                        onClick={() => correr(() => marcarParecido(f.generico_id, p.generico_id, 'REVISAR'), `«${f.generico}» y «${p.nombre}» quedaron en Revisar duplicados.`)}>Es el mismo</button>
                <button type="button" className="secundario mini" disabled={enviando}
                        onClick={() => correr(() => marcarParecido(f.generico_id, p.generico_id, 'SEPARAR'), `«${p.nombre}» ya no sale como parecido de «${f.generico}».`)}>No es</button>
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
