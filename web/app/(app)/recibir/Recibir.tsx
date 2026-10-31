'use client';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { supabaseNavegador } from '@/lib/supabase/navegador';
import { fmtCantidad, type Resultado } from '@/lib/catalogo';
import { costoUnitarioBase, desvioPct, promedioTrasEntrada } from '@/lib/costo';
import { aUnidadesCompra, origenLinea } from '@/lib/recepcion';
import type { Area } from '@/lib/roles';
import { leerFactura, registrarRecepcion, type Candidato } from './acciones';
import { confirmar } from '@/components/Dialogo';
import Escaner from '@/components/Escaner';
import Icono from '@/components/Icono';
import { asociarCodigo, leerCodigo } from '@/lib/escaneo';

export type ProductoRecepcion = {
  producto_id: string; codigo: string; generico: string; marca: string; presentacion: string; categoria: string;
  unidad_base: 'g' | 'ml' | 'und'; unidad_compra: string; contenido_base: number | null; contenido_variable: boolean;
  exige_sello: boolean; es_perecedero: boolean; conservacion: string | null; temp_max: number | null;
  costo_promedio: number | null; saldo: number; estado: string;
};
type Condicion = 'OK' | 'DANADO' | 'INCOMPLETO' | 'NO_LLEGO';
type Propuesto = { producto_id: string | null; cantidad: number | null; valor_total: number | null };
// Lo que la persona escribe va como texto para no perder lo que teclea
type Linea = {
  clave: string; producto_id: string | null; nombre_factura: string | null; cantidad_factura: number | null;
  unidad_factura: string | null; nota: string | null;
  ia: Propuesto | null; confirmada: boolean; candidatos: Candidato[];
  pedida: string; recibida: string; total_base: string; valor: string;
  condicion: Condicion; sello: '' | 'SI' | 'NO' | 'NA'; temperatura: string; vencimiento: string; lote: string; obs: string;
};
type Encabezado = { ubicacion: string; proveedor_id: string; fecha: string; tipo_soporte: string; documento: string; obs: string };
type Foto = { ruta: string; tipo: string };

const hoyCali = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const num = (s: string) => { const n = Number(s.replace(/\$|\s/g, '').replace(',', '.')); return s.trim() === '' || !Number.isFinite(n) ? null : n; };
const pesos = (n: number, dec = 0) => n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: dec, minimumFractionDigits: dec });
const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const nombreDe = (p: ProductoRecepcion) => `${p.generico}${p.marca ? ` · ${p.marca}` : ''}`;
const CONDICIONES: { v: Condicion; t: string }[] = [
  { v: 'OK', t: 'Bien' }, { v: 'DANADO', t: 'Dañado' }, { v: 'INCOMPLETO', t: 'Incompleto' }, { v: 'NO_LLEGO', t: 'No llegó' }];
const nueva = (): Linea => ({
  clave: crypto.randomUUID(), producto_id: null, nombre_factura: null, cantidad_factura: null, unidad_factura: null, nota: null, ia: null, confirmada: true,
  candidatos: [], pedida: '', recibida: '', total_base: '', valor: '', condicion: 'OK', sello: '', temperatura: '',
  vencimiento: '', lote: '', obs: '' });

// Foto liviana para subir y para la IA: lado mayor de 2.000 px en JPEG.
async function reducir(archivo: File): Promise<{ blob: Blob; tipo: string; ext: string }> {
  if (archivo.type === 'application/pdf') return { blob: archivo, tipo: 'application/pdf', ext: 'pdf' };
  try {
    const img = await createImageBitmap(archivo);
    const k = Math.min(1, 2000 / Math.max(img.width, img.height));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(img.width * k);
    lienzo.height = Math.round(img.height * k);
    lienzo.getContext('2d')!.drawImage(img, 0, 0, lienzo.width, lienzo.height);
    const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, 'image/jpeg', 0.85));
    if (blob) return { blob, tipo: 'image/jpeg', ext: 'jpg' };
  } catch { /* formato que el navegador no decodifica (HEIC en algunos equipos): se sube tal cual */ }
  const ext = archivo.type === 'image/png' ? 'png' : archivo.type === 'image/webp' ? 'webp' : 'jpg';
  return { blob: archivo, tipo: archivo.type || 'image/jpeg', ext };
}

// Costo por unidad base, promedio que queda, desvío, temperatura y diferencia de una línea
function calcular(l: Linea, porId: Map<string, ProductoRecepcion>) {
  const p = l.producto_id ? porId.get(l.producto_id) : undefined;
  const rec = num(l.recibida), val = num(l.valor), ped = num(l.pedida), tb = num(l.total_base);
  const contenido = p ? (p.contenido_variable ? (tb !== null && rec ? tb / rec : null) : p.contenido_base) : null;
  const cu = costoUnitarioBase(val, rec, contenido);
  const base = rec !== null && contenido ? rec * contenido : null;
  const nuevoProm = p && cu !== null && base ? promedioTrasEntrada(p.saldo, p.costo_promedio, base, cu) : null;
  const temp = num(l.temperatura);
  const frio = !!p && (p.conservacion === 'Refrigerado' || p.conservacion === 'Congelado');
  return { p, rec, val, ped, contenido, cu, base, nuevoProm, frio,
           desvio: cu !== null && p ? desvioPct(cu, p.costo_promedio) : null,
           caliente: frio && temp !== null && p!.temp_max !== null && temp > p!.temp_max,
           diferencia: ped !== null && rec !== null && ped !== rec ? rec - ped : null };
}

export default function Recibir({ area, proveedores, zonas, productos }: {
  area: Area; proveedores: { id: string; nombre: string }[]; zonas: { codigo: string; nombre: string }[]; productos: ProductoRecepcion[];
}) {
  const porId = useMemo(() => new Map(productos.map((p) => [p.producto_id, p])), [productos]);
  const vacio: Encabezado = { ubicacion: zonas.length === 1 ? zonas[0].codigo : '', proveedor_id: '', fecha: hoyCali(),
                              tipo_soporte: 'FACTURA', documento: '', obs: '' };
  const [enc, setEnc] = useState<Encabezado>(vacio);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [foto, setFoto] = useState<Foto | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [propuesta, setPropuesta] = useState<Record<string, unknown> | null>(null);
  const [totalFactura, setTotalFactura] = useState<number | null>(null);
  const [notaIA, setNotaIA] = useState<string | null>(null);
  // los que la lectura de una factura creó en esta pantalla, hasta que la página se recargue
  const [creados, setCreados] = useState<{ id: string; nombre: string }[]>([]);
  const [notaProveedor, setNotaProveedor] = useState<string | null>(null);
  const listaProv = useMemo(() => [...proveedores, ...creados.filter((c) => !proveedores.some((p) => p.id === c.id))]
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')), [proveedores, creados]);
  const [estadoFoto, setEstadoFoto] = useState<'' | 'subiendo' | 'leyendo'>('');
  const [errorFoto, setErrorFoto] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [enviando, iniciar] = useTransition();
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);

  // borrador en este equipo: bloquear el celular o recargar no borra la recepción a medias
  const clave = `sgi-recibir:${area}`;
  const [cargado, setCargado] = useState(false);
  useEffect(() => {
    try {
      const b = JSON.parse(localStorage.getItem(clave) || 'null');
      if (b) { setEnc(b.enc); setLineas(b.lineas); setFoto(b.foto); setPropuesta(b.propuesta); setTotalFactura(b.totalFactura); setNotaIA(b.notaIA); }
    } catch { /* borrador dañado: se empieza de cero */ }
    setCargado(true);
  }, [clave]);
  useEffect(() => {
    if (!cargado) return;
    try { localStorage.setItem(clave, JSON.stringify({ enc, lineas, foto, propuesta, totalFactura, notaIA })); } catch { /* sin almacenamiento */ }
  }, [clave, cargado, enc, lineas, foto, propuesta, totalFactura, notaIA]);

  const poner = (k: string, cambio: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.clave === k ? { ...l, ...cambio } : l)));
  const [escaneando, setEscaneando] = useState(false);
  const [porAsociar, setPorAsociar] = useState<string | null>(null);
  const [buscarAsociar, setBuscarAsociar] = useState('');
  const [leido, setLeido] = useState<{ ok: boolean; texto: string } | null>(null);

  // Cada código escaneado suma una unidad de compra a la línea de ese producto (o la crea).
  function sumarUna(id: string) {
    const p = porId.get(id);
    if (!p) return;
    setLineas((ls) => {
      const l = ls.find((x) => x.producto_id === id);
      if (l) return ls.map((x) => (x === l ? { ...x, recibida: String((num(x.recibida) ?? 0) + 1) } : x));
      return [...ls, { ...nueva(), producto_id: id, recibida: '1' }];
    });
    setLeido({ ok: true, texto: `✔ ${nombreDe(p)} +1` });
  }
  async function escaneado(texto: string) {
    const r = await leerCodigo(texto);
    if (r.tipo === 'desconocido') { setEscaneando(false); setPorAsociar(r.codigo); setBuscarAsociar(''); return; }
    const id = r.tipo === 'producto' ? r.producto.producto_id : r.lote.producto_id;
    if (!porId.has(id)) { setLeido({ ok: false, texto: 'Ese producto no se recibe en esta área.' }); return; }
    sumarUna(id);
  }
  async function asociar(p: ProductoRecepcion) {
    if (!porAsociar) return;
    const r = await asociarCodigo(porAsociar, p.producto_id);
    setPorAsociar(null);
    if (!r.ok) { setLeido({ ok: false, texto: r.error ?? 'No se pudo guardar el código.' }); return; }
    sumarUna(p.producto_id);
  }
  const ponerEnc = (cambio: Partial<Encabezado>) => setEnc((e) => ({ ...e, ...cambio }));

  // ---------------------------------------------------------------- foto y lectura con IA
  async function tomarFoto(archivo: File | undefined) {
    if (!archivo) return;
    setErrorFoto(null);
    setEstadoFoto('subiendo');
    try {
      const { blob, tipo, ext } = await reducir(archivo);
      const ruta = `${area}/${enc.fecha.slice(0, 4) || new Date().getFullYear()}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabaseNavegador().storage.from('facturas').upload(ruta, blob, { contentType: tipo, upsert: false });
      if (error) throw new Error(`No se pudo subir la foto: ${error.message}`);
      setFoto({ ruta, tipo });
      setVista(tipo === 'application/pdf' ? null : URL.createObjectURL(blob));
      setEstadoFoto('leyendo');
      const r = await leerFactura(ruta, area);
      if (!r.ok) { setErrorFoto(r.error); return; }
      const p = r.propuesta;
      setPropuesta(p as unknown as Record<string, unknown>);
      setTotalFactura(p.total_factura);
      setNotaIA(p.legible ? p.notas : 'La IA no reconoció una factura en la foto. Revisa la imagen o registra las líneas a mano.');
      const n = r.proveedor_nuevo;
      if (n?.creado) setCreados((cs) => [...cs, { id: n.id, nombre: n.nombre }]);
      setNotaProveedor(!n ? null
        : n.creado ? `Proveedor nuevo creado desde la factura: «${n.nombre}». Si el nombre quedó mal, administración lo corrige.`
        : !n.activo ? `«${n.nombre}» está inactivo en la lista de proveedores. Pídele a administración que lo reactive.` : null);
      setEnc((e) => ({
        ...e,
        proveedor_id: e.proveedor_id || r.proveedor_id || '',
        documento: e.documento || p.documento || '',
        fecha: p.fecha && /^\d{4}-\d{2}-\d{2}$/.test(p.fecha) && p.fecha <= hoyCali() ? p.fecha : e.fecha,
      }));
      const leidas = r.lineas.map((l): Linea => {
        const mejor = l.candidatos.find((c) => porId.has(c.producto_id) && c.parecido >= 0.45);
        const prod = mejor ? porId.get(mejor.producto_id)! : null;
        const conv = prod ? aUnidadesCompra(l.cantidad, l.unidad, prod) : { cantidad: l.cantidad, total_base: null, nota: null };
        return {
          ...nueva(), producto_id: prod?.producto_id ?? null, nombre_factura: l.descripcion, cantidad_factura: l.cantidad, unidad_factura: l.unidad,
          nota: conv.nota, confirmada: false, candidatos: l.candidatos.filter((c) => porId.has(c.producto_id)),
          ia: { producto_id: prod?.producto_id ?? null, cantidad: conv.cantidad, valor_total: l.valor_total },
          recibida: conv.cantidad === null ? '' : String(conv.cantidad),
          total_base: conv.total_base === null ? '' : String(conv.total_base),
          valor: l.valor_total === null ? '' : String(l.valor_total),
        };
      });
      // lo que ya estaba digitado a mano se conserva; lo que leyó la IA antes se reemplaza
      setLineas((ls) => [...ls.filter((l) => !l.ia), ...leidas]);
    } catch (e) {
      setErrorFoto(e instanceof Error ? e.message : 'No se pudo leer la factura.');
    } finally {
      setEstadoFoto('');
    }
  }

  const calculo = (l: Linea) => calcular(l, porId);

  const sinConfirmar = lineas.filter((l) => !l.confirmada).length;
  const sinProducto = lineas.filter((l) => !l.producto_id).length;
  const sumaLineas = lineas.reduce((t, l) => t + (num(l.valor) ?? 0), 0);
  const descuadre = totalFactura && sumaLineas ? Math.abs(sumaLineas - totalFactura) / totalFactura > 0.01 : false;

  function payload(conMotivo: boolean) {
    return {
      area, ubicacion: enc.ubicacion, fecha: enc.fecha, proveedor_id: enc.proveedor_id, tipo_soporte: enc.tipo_soporte,
      documento: enc.documento, observaciones: enc.obs, soporte_ruta: foto?.ruta ?? null, propuesta_ia: propuesta,
      motivo_forzado: conMotivo ? motivo : null,
      lineas: lineas.map((l) => {
        const c = calculo(l);
        return {
          producto_id: l.producto_id, cantidad_pedida: c.ped, cantidad_recibida: c.rec, valor_total: c.val,
          contenido_base: c.p?.contenido_variable ? c.contenido : undefined,
          condicion: l.condicion, sello: l.sello || null, temperatura: num(l.temperatura), vencimiento: l.vencimiento || null,
          lote_proveedor: l.lote || null, observaciones: l.obs, nombre_factura: l.nombre_factura,
          origen: origenLinea(l.ia, { producto_id: l.producto_id, cantidad: c.rec, valor_total: c.val }),
        };
      }),
    };
  }

  function guardar(conMotivo: boolean) {
    setResultado(null);
    iniciar(async () => {
      const r = await registrarRecepcion(payload(conMotivo));
      setResultado(r);
      if (r.ok) {
        try { localStorage.removeItem(clave); } catch { /* nada */ }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  function empezarDeNuevo() {
    setEnc(vacio); setLineas([]); setFoto(null); setVista(null); setPropuesta(null); setTotalFactura(null);
    setNotaIA(null); setNotaProveedor(null); setMotivo(''); setResultado(null); setErrorFoto(null);
  }

  if (resultado?.ok) {
    return (
      <div className="tarjeta">
        <p className="exito" role="status" style={{ marginTop: 0 }}>
          <strong>Recepción guardada: {resultado.codigo}</strong><br />
          Las existencias y el costo promedio de cada producto ya se actualizaron.
        </p>
        {resultado.avisos.length > 0 && <div className="aviso"><ul style={{ margin: 0 }}>{resultado.avisos.map((m) => <li key={m}>{m}</li>)}</ul></div>}
        <div className="acciones">
          <button type="button" onClick={empezarDeNuevo}>Recibir otra</button>
          <Link className="boton secundario" href="/existencias">Ver existencias</Link>
        </div>
      </div>
    );
  }

  const bloqueado = resultado && !resultado.ok && !resultado.fatales.length && resultado.bloqueos.length > 0;

  return (
    <>
      {/* ------------------------------------------------ factura */}
      <section className="tarjeta">
        <strong>1. Foto de la factura</strong>
        <p className="suave" style={{ margin: '.3rem 0 .6rem', fontSize: '.9rem' }}>
          La IA la lee y propone proveedor, documento y líneas. Tú confirmas o corriges cada una antes de guardar.
        </p>
        <input ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void tomarFoto(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={galeria} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { void tomarFoto(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="acciones" style={{ marginTop: 0 }}>
          <button type="button" disabled={!!estadoFoto} onClick={() => camara.current?.click()}>
            {estadoFoto === 'subiendo' ? 'Subiendo foto…' : estadoFoto === 'leyendo' ? 'Leyendo factura…' : foto ? 'Tomar otra foto' : 'Tomar foto'}
          </button>
          <button type="button" className="secundario" disabled={!!estadoFoto} onClick={() => galeria.current?.click()}>Elegir archivo</button>
        </div>
        {estadoFoto === 'leyendo' && <p className="suave" role="status" style={{ fontSize: '.88rem' }}>Esto toma entre 10 y 40 segundos. No cierres la pantalla.</p>}
        {errorFoto && <p className="error" role="alert">{errorFoto}</p>}
        {foto && !estadoFoto && (
          <p className="suave" style={{ fontSize: '.85rem', marginBottom: 0 }}>
            ✓ Foto guardada{vista && <> · <a href={vista} target="_blank" rel="noreferrer">verla</a></>}
          </p>
        )}
        {notaIA && <p className="aviso" style={{ marginBottom: 0 }}><strong>Revisa:</strong> {notaIA}</p>}
      </section>

      {/* ------------------------------------------------ encabezado */}
      <section className="tarjeta" style={{ marginTop: '.75rem' }}>
        <strong>2. Proveedor y documento</strong>
        <label htmlFor="prov">Proveedor</label>
        <select id="prov" value={enc.proveedor_id} onChange={(e) => ponerEnc({ proveedor_id: e.target.value })}>
          <option value="">— Elige de la lista —</option>
          {listaProv.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        {notaProveedor && <span className="ayuda" role="status">{notaProveedor}</span>}
        {!enc.proveedor_id && !notaProveedor && typeof propuesta?.proveedor === 'string' && (
          <span className="ayuda">La factura dice «{propuesta.proveedor}», pero no se pudo crear. Elígelo de la lista.</span>
        )}
        <div className="fila">
          <div>
            <label htmlFor="soporte">Soporte</label>
            <select id="soporte" value={enc.tipo_soporte} onChange={(e) => ponerEnc({ tipo_soporte: e.target.value })}>
              <option value="FACTURA">Factura</option>
              <option value="REMISION">Remisión</option>
              <option value="SIN_SOPORTE">Sin soporte</option>
            </select>
          </div>
          <div>
            <label htmlFor="doc">N° de documento</label>
            <input id="doc" value={enc.documento} onChange={(e) => ponerEnc({ documento: e.target.value })} autoCapitalize="characters" />
          </div>
        </div>
        <div className="fila">
          <div>
            <label htmlFor="fecha">Fecha</label>
            <input id="fecha" type="date" max={hoyCali()} value={enc.fecha} onChange={(e) => ponerEnc({ fecha: e.target.value })} />
          </div>
          <div>
            <label htmlFor="zona">Entra a</label>
            <select id="zona" value={enc.ubicacion} onChange={(e) => ponerEnc({ ubicacion: e.target.value })}>
              <option value="">— Zona —</option>
              {zonas.map((z) => <option key={z.codigo} value={z.codigo}>{z.nombre}</option>)}
            </select>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ líneas */}
      <h2>3. Productos {lineas.length > 0 && <span className="suave" style={{ fontWeight: 400 }}>({lineas.length})</span>}</h2>
      {sinConfirmar > 0 && (
        <p className="aviso">La IA propuso {sinConfirmar === 1 ? '1 línea' : `${sinConfirmar} líneas`} sin confirmar. Revisa producto, cantidad y valor contra la factura y toca «Confirmar».</p>
      )}
      <ul className="lista">
        {lineas.map((l, i) => (
          <TarjetaLinea key={l.clave} n={i + 1} l={l} c={calculo(l)} productos={productos} porId={porId}
                        poner={(cambio) => poner(l.clave, cambio)}
                        quitar={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))} />
        ))}
      </ul>
      <div className="acciones" style={{ marginTop: '.6rem' }}>
        <button type="button" className="secundario" onClick={() => setLineas((ls) => [...ls, nueva()])}>+ Agregar producto</button>
        <button type="button" className="secundario" onClick={() => { setLeido(null); setEscaneando(true); }}><Icono nombre="escanear" /> Escanear</button>
      </div>
      {leido && <p className={leido.ok ? 'exito' : 'aviso'} style={{ margin: '.5rem 0', padding: '.4rem .6rem' }}>{leido.texto}</p>}
      {escaneando && <Escaner continuo titulo="Escanear: cada unidad suma una" onCerrar={() => setEscaneando(false)} onCodigo={escaneado} />}
      {porAsociar && (
        <div className="tarjeta" style={{ marginTop: '.6rem', padding: '.7rem' }}>
          <strong>Código nuevo <span className="cod">{porAsociar}</span>: ¿qué producto es?</strong>
          <div className="suave" style={{ fontSize: '.82rem' }}>Elígelo una vez y la app lo reconoce en adelante.</div>
          <input autoFocus value={buscarAsociar} onChange={(e) => setBuscarAsociar(e.target.value)} placeholder="Buscar en el catálogo…" style={{ marginTop: '.4rem' }} />
          <div style={{ display: 'grid', gap: '.3rem', marginTop: '.4rem', maxHeight: 220, overflowY: 'auto' }}>
            {buscarAsociar.trim().length >= 2 && productos.filter((x) => {
              const t = sinTildes(`${x.generico} ${x.marca} ${x.presentacion} ${x.codigo}`);
              return sinTildes(buscarAsociar).split(/\s+/).every((w) => t.includes(w));
            }).slice(0, 8).map((x) => (
              <button key={x.producto_id} type="button" className="secundario chico" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => asociar(x)}>
                {nombreDe(x)} <span className="suave">· {x.presentacion}</span>
              </button>
            ))}
          </div>
          <button type="button" className="discreto mini" style={{ marginTop: '.4rem' }} onClick={() => setPorAsociar(null)}>Cancelar</button>
        </div>
      )}
      {lineas.length > 0 && (
        <p className="suave" style={{ fontSize: '.9rem' }}>
          Suma de las líneas: <strong>{pesos(sumaLineas)}</strong>
          {totalFactura !== null && <> · total de la factura: <strong>{pesos(totalFactura)}</strong></>}
        </p>
      )}
      {descuadre && <p className="aviso">La suma de las líneas no cuadra con el total de la factura. Revisa IVA, descuentos o una línea que falte.</p>}

      <label htmlFor="obs">Observaciones <span className="ayuda">opcional</span></label>
      <textarea id="obs" rows={2} value={enc.obs} onChange={(e) => ponerEnc({ obs: e.target.value })} />

      {resultado && !resultado.ok && (
        <div className={bloqueado ? 'aviso' : 'error'} role="alert">
          <strong>{bloqueado ? 'Para guardar así hace falta un motivo:' : 'No se guardó:'}</strong>
          <ul>{[...resultado.fatales, ...resultado.bloqueos].map((m) => <li key={m}>{m}</li>)}</ul>
          {resultado.avisos.length > 0 && <><strong>Avisos:</strong><ul>{resultado.avisos.map((m) => <li key={m}>{m}</li>)}</ul></>}
          {bloqueado && (
            <>
              <label htmlFor="motivo">Corrige lo de arriba, o escribe por qué se recibe así</label>
              <textarea id="motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                        placeholder="Ej.: el proveedor subió el precio, confirmado con administración" />
            </>
          )}
        </div>
      )}

      <div className="acciones barra-guardar">
        {bloqueado ? (
          <button type="button" disabled={enviando || motivo.trim().length < 15} onClick={() => guardar(true)}>
            {enviando ? 'Guardando…' : 'Guardar con este motivo'}
          </button>
        ) : (
          <button type="button" disabled={enviando || !!estadoFoto || !lineas.length || sinConfirmar > 0 || sinProducto > 0}
                  onClick={() => guardar(false)}>
            {enviando ? 'Guardando…' : `Guardar recepción (${lineas.length})`}
          </button>
        )}
        {(lineas.length > 0 || foto) && (
          <button type="button" className="secundario" disabled={enviando}
                  onClick={async () => { if (await confirmar('¿Descartar esta recepción? Nada se ha guardado todavía.', { aceptar: 'Descartar', peligro: true })) empezarDeNuevo(); }}>
            Descartar
          </button>
        )}
      </div>
      {(sinProducto > 0 || sinConfirmar > 0) && lineas.length > 0 && (
        <p className="suave" style={{ fontSize: '.85rem' }}>
          {sinProducto > 0 ? `Falta elegir el producto en ${sinProducto} línea(s), o quitarla si no es un insumo. ` : ''}
          {sinConfirmar > 0 ? `Falta confirmar ${sinConfirmar} línea(s) propuesta(s) por la IA.` : ''}
        </p>
      )}
    </>
  );
}

// ==================================================================== una línea
type Calculo = ReturnType<typeof calcular>;

function TarjetaLinea({ n, l, c, productos, porId, poner, quitar }: {
  n: number; l: Linea; c: Calculo; productos: ProductoRecepcion[]; porId: Map<string, ProductoRecepcion>;
  poner: (cambio: Partial<Linea>) => void; quitar: () => void;
}) {
  const [buscar, setBuscar] = useState('');
  const [eligiendo, setEligiendo] = useState(!l.producto_id);
  const p = c.p;
  const opciones = useMemo(() => {
    const f = sinTildes(buscar.trim());
    if (f.length < 2) return [];
    const palabras = f.split(/\s+/);
    return productos.filter((x) => { const t = sinTildes(`${x.generico} ${x.marca} ${x.presentacion} ${x.codigo}`); return palabras.every((w) => t.includes(w)); }).slice(0, 8);
  }, [buscar, productos]);
  const sugeridos = l.candidatos.map((x) => porId.get(x.producto_id)!).filter((x) => x && x.producto_id !== l.producto_id).slice(0, 3);

  function elegir(x: ProductoRecepcion) {
    // la cantidad de la factura se vuelve a convertir a la presentación elegida
    const cambio: Partial<Linea> = { producto_id: x.producto_id, sello: '', temperatura: '' };
    if (l.cantidad_factura !== null) {
      const conv = aUnidadesCompra(l.cantidad_factura, l.unidad_factura, x);
      Object.assign(cambio, { recibida: conv.cantidad === null ? '' : String(conv.cantidad), nota: conv.nota,
                              total_base: conv.total_base === null ? '' : String(conv.total_base) });
    }
    poner(cambio);
    setBuscar('');
    setEligiendo(false);
  }

  const borde = !l.confirmada ? 'var(--aviso)' : !l.producto_id ? 'var(--error)' : undefined;
  const campo = { margin: 0, fontWeight: 400, fontSize: '.85rem' } as const;

  return (
    <li style={borde ? { borderColor: borde, borderWidth: 2 } : undefined}>
      <div className="linea" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <span className="suave" style={{ fontSize: '.8rem' }}>Línea {n}{l.ia ? ' · leída por la IA' : ''}</span>
          {l.nombre_factura && <div className="suave" style={{ fontSize: '.85rem' }}>Factura: «{l.nombre_factura}»</div>}
          {p && !eligiendo && (
            <div>
              <strong>{nombreDe(p)}</strong>
              <div className="suave" style={{ fontSize: '.85rem' }}>{p.presentacion}{p.estado === 'PROVISIONAL' && ' · provisional'}</div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '.4rem' }}>
          {p && !eligiendo && <button type="button" className="secundario chico" onClick={() => setEligiendo(true)}>Cambiar</button>}
          <button type="button" className="secundario chico" aria-label={`Quitar línea ${n}`}
                  onClick={async () => { if (!l.ia || await confirmar('¿Quitar esta línea? Úsalo para lo que no es insumo (domicilio, bolsas).', { aceptar: 'Quitar' })) quitar(); }}>Quitar</button>
        </div>
      </div>

      {(eligiendo || !p) && (
        <div style={{ marginTop: '.5rem' }}>
          {sugeridos.length > 0 && (
            <div className="segmentos" style={{ marginBottom: '.4rem' }}>
              {sugeridos.map((x) => (
                <button key={x.producto_id} type="button" className="secundario chico" style={{ textAlign: 'left' }} onClick={() => elegir(x)}>
                  {nombreDe(x)} <span className="suave">· {x.presentacion}</span>
                </button>
              ))}
            </div>
          )}
          <input aria-label={`Buscar producto de la línea ${n}`} placeholder="Buscar en el catálogo…" value={buscar} onChange={(e) => setBuscar(e.target.value)} autoFocus={!l.ia} />
          {opciones.length > 0 && (
            <ul className="lista" style={{ marginTop: '.4rem' }}>
              {opciones.map((x) => (
                <li key={x.producto_id} style={{ padding: 0 }}>
                  <button type="button" className="secundario" style={{ width: '100%', textAlign: 'left', border: 0, color: 'inherit' }} onClick={() => elegir(x)}>
                    <strong>{nombreDe(x)}</strong> <span className="suave">· {x.presentacion}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {buscar.trim().length >= 2 && !opciones.length && (
            <p className="suave" style={{ fontSize: '.85rem' }}>No está en el catálogo. <Link href="/catalogo/nuevo">Créalo como provisional</Link> y vuelve: esta recepción queda guardada en el equipo.</p>
          )}
          {p && <button type="button" className="secundario" style={{ marginTop: '.4rem', minHeight: 36 }} onClick={() => setEligiendo(false)}>Dejar {nombreDe(p)}</button>}
        </div>
      )}

      {p && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '.5rem', marginTop: '.6rem' }}>
            <label style={campo}>Pedido ({p.unidad_compra.toLowerCase() || p.unidad_base})
              <input inputMode="decimal" value={l.pedida} onChange={(e) => poner({ pedida: e.target.value })} />
            </label>
            <label style={campo}>Llegó ({p.unidad_compra.toLowerCase() || p.unidad_base})
              <input inputMode="decimal" value={l.recibida} onChange={(e) => poner({ recibida: e.target.value })} />
            </label>
            <label style={campo}>Valor línea ($)
              <input inputMode="decimal" value={l.valor} onChange={(e) => poner({ valor: e.target.value })} />
            </label>
          </div>
          {p.contenido_variable && (
            <label style={{ ...campo, marginTop: '.5rem' }}>Peso o volumen total que llegó ({p.unidad_base})
              <input inputMode="decimal" value={l.total_base} onChange={(e) => poner({ total_base: e.target.value })} />
            </label>
          )}
          {l.nota && <div className="suave" style={{ fontSize: '.8rem', marginTop: '.3rem' }}>{l.nota}</div>}
          {c.diferencia !== null && !l.obs.trim() && (
            <div className="aviso" style={{ margin: '.5rem 0 0', padding: '.4rem .6rem', fontSize: '.85rem' }}>
              Diferencia de {c.diferencia > 0 ? '+' : ''}{fmtCantidad(c.diferencia)} frente a lo pedido. Escribe qué pasó en observaciones.
            </div>
          )}

          <div className="segmentos" role="radiogroup" aria-label={`Estado de la línea ${n}`} style={{ marginTop: '.6rem' }}>
            {CONDICIONES.map((x) => (
              <label key={x.v}>
                <input type="radio" name={`cond-${l.clave}`} checked={l.condicion === x.v}
                       onChange={() => poner(x.v === 'NO_LLEGO' ? { condicion: x.v, recibida: '0' } : { condicion: x.v })} />
                <span>{x.t}</span>
              </label>
            ))}
          </div>

          {p.exige_sello && (
            <div className="segmentos" role="radiogroup" aria-label={`Sello de la línea ${n}`} style={{ marginTop: '.5rem' }}>
              <span className="suave" style={{ border: 0, background: 'none', padding: '.5rem .2rem', minHeight: 0 }}>Sello:</span>
              {([['SI', 'Intacto'], ['NO', 'Roto'], ['NA', 'No aplica']] as const).map(([v, t]) => (
                <label key={v}><input type="radio" name={`sello-${l.clave}`} checked={l.sello === v} onChange={() => poner({ sello: v })} /><span>{t}</span></label>
              ))}
            </div>
          )}

          {(c.frio || p.es_perecedero) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '.5rem', marginTop: '.5rem' }}>
              {c.frio && (
                <label style={campo}>Temperatura al llegar (°C){p.temp_max !== null && ` · máx. ${p.temp_max}`}
                  <input inputMode="decimal" value={l.temperatura} onChange={(e) => poner({ temperatura: e.target.value })}
                         style={c.caliente ? { borderColor: 'var(--aviso)', borderWidth: 2 } : undefined} />
                </label>
              )}
              <label style={campo}>Vence
                <input type="date" value={l.vencimiento} onChange={(e) => poner({ vencimiento: e.target.value })} />
              </label>
              {c.frio && (
                <label style={campo}>Lote del proveedor
                  <input value={l.lote} onChange={(e) => poner({ lote: e.target.value })} />
                </label>
              )}
            </div>
          )}
          {c.caliente && <div className="aviso" style={{ margin: '.5rem 0 0', padding: '.4rem .6rem', fontSize: '.85rem' }}>Llegó por encima de {p.temp_max} °C. Queda anotado; no impide guardar.</div>}

          <label style={{ ...campo, marginTop: '.5rem' }}>Observaciones
            <input value={l.obs} onChange={(e) => poner({ obs: e.target.value })} />
          </label>

          {c.cu !== null && (
            <div className="suave" style={{ fontSize: '.82rem', marginTop: '.4rem' }}>
              {pesos(c.cu, c.cu < 100 ? 2 : 0)} por {p.unidad_base}
              {c.desvio !== null && <> · {c.desvio > 0 ? '+' : ''}{c.desvio} % frente al promedio actual ({pesos(p.costo_promedio!, p.costo_promedio! < 100 ? 2 : 0)})</>}
              {c.nuevoProm !== null && p.costo_promedio !== null && c.nuevoProm !== p.costo_promedio && <> → queda en {pesos(c.nuevoProm, c.nuevoProm < 100 ? 2 : 0)}</>}
              {p.costo_promedio === null && <> · primera compra: fija el costo del producto</>}
            </div>
          )}
        </>
      )}

      {!l.confirmada && (
        <div className="acciones" style={{ marginTop: '.6rem' }}>
          <button type="button" disabled={!l.producto_id} onClick={() => poner({ confirmada: true })}>
            {l.producto_id ? 'Confirmar línea' : 'Elige el producto para confirmar'}
          </button>
        </div>
      )}
    </li>
  );
}
