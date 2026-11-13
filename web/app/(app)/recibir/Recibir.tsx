'use client';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { supabaseNavegador } from '@/lib/supabase/navegador';
import { fmtCantidad, type Resultado } from '@/lib/catalogo';
import { costoUnitarioBase, desvioPct, promedioTrasEntrada } from '@/lib/costo';
import { aUnidadesCompra, origenLinea } from '@/lib/recepcion';
import type { Area } from '@/lib/roles';
import { copiarFoto, crearProductoRapido, crearProveedor, leerFactura, registrarRecepcion, type Candidato } from './acciones';
import { confirmar, pedirTexto } from '@/components/Dialogo';
import Escaner from '@/components/Escaner';
import Icono from '@/components/Icono';
import { asociarCodigo, leerCodigo } from '@/lib/escaneo';
import { Revisiones } from '@/components/RechazoConMotivo';
import { useEnvio } from '@/lib/envio';
import { Insignia } from '@/components/Insignia';
import { pesos as fmtPesos } from '@/lib/formato';

export type ProductoRecepcion = {
  producto_id: string; codigo: string; generico: string; marca: string; presentacion: string; categoria: string;
  unidad_base: 'g' | 'ml' | 'und'; unidad_compra: string; contenido_base: number | null; contenido_variable: boolean;
  exige_sello: boolean; es_perecedero: boolean; conservacion: string | null; temp_max: number | null;
  costo_promedio: number | null; saldo: number; estado: string;
  area?: Area;   // la pantalla lo pone: productos de la recepción y de la otra área
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
  pesar?: boolean;   // llegó por pieza y se lleva en g o ml: el peso total es obligatorio
  // lo que propuso la IA por significado cuando el nombre no coincidía (cimarrón → cilantro cimarrón)
  ia_sugerido?: { producto_id: string | null; confianza: 'alta' | 'media' | 'baja'; razon: string } | null;
  zona?: string;   // a qué zona entra este artículo; vacío = la zona por defecto de su área
};
type Encabezado = { ubicacion: string; proveedor_id: string; fecha: string; tipo_soporte: string; documento: string; obs: string;
                    ubicacion_otra?: string };   // zona de la otra área, si la factura trae productos de las dos
type Foto = { ruta: string; tipo: string };

const hoyCali = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const num = (s: string) => { const n = Number(s.replace(/\$|\s/g, '').replace(',', '.')); return s.trim() === '' || !Number.isFinite(n) ? null : n; };
const pesos = (n: number, dec = 0) => fmtPesos(n, dec);
// zona por defecto que se usó la última vez en cada área, recordada en este equipo
const zonaGuardada = (a: Area) => { try { return localStorage.getItem(`sgi-recibir-zona:${a}`) ?? ''; } catch { return ''; } };
const guardarZona = (a: Area, z: string) => { try { if (z) localStorage.setItem(`sgi-recibir-zona:${a}`, z); } catch { /* nada */ } };
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
  const val = num(l.valor), ped = num(l.pedida), tb = num(l.total_base);
  let rec = num(l.recibida);
  // pesado a granel (contenido fijo de 1 g / 1 ml): lo que llegó es el peso, en unidades de compra
  if (p && l.pesar && !p.contenido_variable && p.contenido_base && tb !== null && tb > 0) rec = Math.round((tb / p.contenido_base) * 1e4) / 1e4;
  const contenido = p ? (p.contenido_variable ? (tb !== null && rec ? tb / rec : null) : p.contenido_base) : null;
  // sin el peso de lo que llegó por pieza todavía no hay costo por gramo
  const cu = p && l.pesar && !(tb !== null && tb > 0) ? null : costoUnitarioBase(val, rec, contenido);
  const base = rec !== null && contenido ? rec * contenido : null;
  const nuevoProm = p && cu !== null && base ? promedioTrasEntrada(p.saldo, p.costo_promedio, base, cu) : null;
  const temp = num(l.temperatura);
  const frio = !!p && (p.conservacion === 'Refrigerado' || p.conservacion === 'Congelado');
  return { p, rec, val, ped, contenido, cu, base, nuevoProm, frio, faltaPeso: !!p && !!l.pesar && !(tb !== null && tb > 0),
           desvio: cu !== null && p ? desvioPct(cu, p.costo_promedio) : null,
           caliente: frio && temp !== null && p!.temp_max !== null && temp > p!.temp_max,
           diferencia: ped !== null && rec !== null && ped !== rec ? rec - ped : null };
}

type Otra = { area: Area; productos: ProductoRecepcion[]; zonas: { codigo: string; nombre: string }[] };
const nombreArea = (a: Area) => (a === 'BAR' ? 'bar' : 'cocina');

export default function Recibir({ area, proveedores, zonas, productos, otra, zonaDe, vePesos }: {
  vePesos: boolean;
  area: Area; proveedores: { id: string; nombre: string }[]; zonas: { codigo: string; nombre: string }[]; productos: ProductoRecepcion[];
  otra: Otra | null; zonaDe: Record<string, string>;
}) {
  // líneas marcadas para mandarlas juntas a una zona
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [zonaGrupo, setZonaGrupo] = useState('');
  // los creados desde una línea de la factura se suman a la lista sin recargar la página
  const [extras, setExtras] = useState<ProductoRecepcion[]>([]);
  const todos = useMemo(() => {
    const base = [...productos.map((p) => ({ ...p, area })), ...(otra?.productos ?? []).map((p) => ({ ...p, area: otra!.area }))];
    return [...base, ...extras.filter((e) => !base.some((p) => p.producto_id === e.producto_id))];
  }, [productos, otra, extras, area]);
  const porId = useMemo(() => new Map(todos.map((p) => [p.producto_id, p])), [todos]);
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
  // proveedor leído que se parece a otros de la lista: la persona elige o lo crea
  const [provLeido, setProvLeido] = useState<{ nombre: string; nit: string | null; sugeridos: { id: string; nombre: string }[] } | null>(null);
  const [creandoProv, setCreandoProv] = useState(false);
  const listaProv = useMemo(() => [...proveedores, ...creados.filter((c) => !proveedores.some((p) => p.id === c.id))]
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')), [proveedores, creados]);
  const [estadoFoto, setEstadoFoto] = useState<'' | 'subiendo' | 'leyendo'>('');
  const [errorFoto, setErrorFoto] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [enviando, iniciar] = useTransition();
  // una clave de envío por área: una factura de las dos áreas son dos recepciones
  const envio = useEnvio();
  const [claveOtra, setClaveOtra] = useState(() => crypto.randomUUID());
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);

  // borrador en este equipo: bloquear el celular o recargar no borra la recepción a medias
  const clave = `sgi-recibir:${area}`;
  const [cargado, setCargado] = useState(false);
  useEffect(() => {
    try {
      const b = JSON.parse(localStorage.getItem(clave) || 'null');
      if (b) { setEnc({ ...b.enc, ...(b.enc?.ubicacion ? {} : zonasRecordadas()) }); setLineas(b.lineas); setFoto(b.foto); setPropuesta(b.propuesta); setTotalFactura(b.totalFactura); setNotaIA(b.notaIA); }
      else setEnc((e) => ({ ...e, ...zonasRecordadas() }));
    } catch { /* borrador dañado: se empieza de cero */ }
    setCargado(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);
  // la zona elegida queda para la próxima factura del área
  useEffect(() => { guardarZona(area, enc.ubicacion); }, [area, enc.ubicacion]);
  useEffect(() => { if (otra && enc.ubicacion_otra) guardarZona(otra.area, enc.ubicacion_otra); }, [otra, enc.ubicacion_otra]);
  function zonasRecordadas(): Partial<Encabezado> {
    const z = zonaGuardada(area), zo = otra ? zonaGuardada(otra.area) : '';
    return {
      ...(zonas.some((x) => x.codigo === z) ? { ubicacion: z } : {}),
      ...(otra && otra.zonas.some((x) => x.codigo === zo) ? { ubicacion_otra: zo } : {}),
    };
  }
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
      return [...ls, { ...nueva(), producto_id: id, recibida: '1', zona: zonaDe[id] ?? '' }];
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

  async function nuevoProveedor(nombre: string | null, nit: string | null) {
    const n = nombre ?? await pedirTexto('Nombre del proveedor, como aparece en la factura.', { titulo: 'Proveedor nuevo', aceptar: 'Crear', min: 3 });
    if (!n) return;
    setCreandoProv(true);
    const r = await crearProveedor(area, n, nit);
    setCreandoProv(false);
    if (!r.ok) { setNotaProveedor(r.error); return; }
    const pr = r.proveedor;
    if (!pr.activo) { setNotaProveedor(`«${pr.nombre}» está inactivo en la lista de proveedores. Pídale a administración que lo reactive.`); return; }
    setCreados((cs) => (cs.some((c) => c.id === pr.id) ? cs : [...cs, { id: pr.id, nombre: pr.nombre }]));
    ponerEnc({ proveedor_id: pr.id });
    setProvLeido(null);
    setNotaProveedor(pr.creado ? `Proveedor nuevo: «${pr.nombre}». Si el nombre quedó mal, administración lo corrige.` : `Ya existía: «${pr.nombre}».`);
  }

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
      setNotaIA(p.legible ? p.notas : 'La IA no reconoció una factura en la foto. Revise la imagen o registre las líneas a mano.');
      setProvLeido(p.proveedor && !r.proveedor_id ? { nombre: p.proveedor, nit: p.nit, sugeridos: r.proveedor_sugeridos } : null);
      const n = r.proveedor_nuevo;
      if (n?.creado) setCreados((cs) => [...cs, { id: n.id, nombre: n.nombre }]);
      setNotaProveedor(!n ? null
        : n.creado ? `Proveedor nuevo creado desde la factura: «${n.nombre}». Si el nombre quedó mal, administración lo corrige.`
        : !n.activo ? `«${n.nombre}» está inactivo en la lista de proveedores. Pídale a administración que lo reactive.` : null);
      setEnc((e) => ({
        ...e,
        proveedor_id: e.proveedor_id || r.proveedor_id || '',
        documento: e.documento || p.documento || '',
        fecha: p.fecha && /^\d{4}-\d{2}-\d{2}$/.test(p.fecha) && p.fecha <= hoyCali() ? p.fecha : e.fecha,
      }));
      const leidas = r.lineas.map((l): Linea => {
        // solo se elige solo si el parecido es alto (emparejar_factura: 1 = mismo nombre o alias aprendido)
        const mejor = l.candidatos.find((c) => porId.has(c.producto_id) && c.parecido >= 0.75);
        // si el nombre no coincide, la IA puede reconocer el producto por significado: con confianza alta
        // queda elegido (la persona igual confirma la línea); si no, queda como primera sugerencia
        const ia = l.sugerencia_ia && l.sugerencia_ia.producto_id && porId.has(l.sugerencia_ia.producto_id) ? l.sugerencia_ia : null;
        const prod = mejor ? porId.get(mejor.producto_id)! : ia && ia.confianza === 'alta' ? porId.get(ia.producto_id!)! : null;
        const candidatos: Candidato[] = [...(ia ? [{ producto_id: ia.producto_id!, parecido: 1, area: porId.get(ia.producto_id!)?.area ?? area }] : []),
                            ...l.candidatos.filter((c) => porId.has(c.producto_id) && c.producto_id !== ia?.producto_id)];
        const conv = prod ? aUnidadesCompra(l.cantidad, l.unidad, prod, l.descripcion) : { cantidad: l.cantidad, total_base: null, nota: null, pesar: false };
        return {
          ...nueva(), producto_id: prod?.producto_id ?? null, nombre_factura: l.descripcion, cantidad_factura: l.cantidad, unidad_factura: l.unidad,
          nota: conv.nota, pesar: !!conv.pesar, confirmada: false, candidatos, ia_sugerido: mejor ? null : l.sugerencia_ia,
          zona: prod ? zonaDe[prod.producto_id] ?? '' : '',
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
  // el área de una línea es la de su producto; sin producto todavía, la de la pantalla
  const areaDe = (l: Linea): Area => (l.producto_id ? porId.get(l.producto_id)?.area : undefined) ?? area;
  const deLaOtra = otra ? lineas.filter((l) => l.producto_id && areaDe(l) === otra.area).length : 0;
  // falta la zona por defecto de un área si alguno de sus artículos no tiene zona propia
  const faltaZona = lineas.some((l) => !l.zona && areaDe(l) === area) && !enc.ubicacion;
  const faltaZonaOtra = !!otra && lineas.some((l) => l.producto_id && !l.zona && areaDe(l) === otra.area) && !enc.ubicacion_otra;

  const sinConfirmar = lineas.filter((l) => !l.confirmada).length;
  const sinProducto = lineas.filter((l) => !l.producto_id).length;
  const sinPeso = lineas.filter((l) => calculo(l).faltaPeso).length;
  const sumaLineas = lineas.reduce((t, l) => t + (num(l.valor) ?? 0), 0);
  const descuadre = totalFactura && sumaLineas ? Math.abs(sumaLineas - totalFactura) / totalFactura > 0.01 : false;
  // Líneas de la IA que cuadran solas: producto reconocido por su nombre (no adivinado por la IA), cantidad y
  // valor escritos, sin peso pendiente, sin diferencia con lo pedido y con un precio parecido al de siempre.
  // La persona las confirma de una vez con un toque; las dudosas se revisan una por una.
  const cuadran = lineas.filter((l) => {
    if (l.confirmada || !l.producto_id) return false;
    const c = calculo(l);
    return (c.rec ?? 0) > 0 && (c.val ?? 0) > 0 && !c.faltaPeso && c.diferencia === null && !c.caliente
      && l.ia_sugerido?.producto_id !== l.producto_id && (c.desvio === null || Math.abs(c.desvio) <= 25);
  });

  function payload(conMotivo: boolean, g: Area, ruta: string | null) {
    return {
      // el encabezado lleva la zona por defecto; si no la hay, la del primer artículo del grupo
      area: g, ubicacion: (g === area ? enc.ubicacion : enc.ubicacion_otra) || lineas.find((l) => areaDe(l) === g && l.zona)?.zona || '',
      fecha: enc.fecha, proveedor_id: enc.proveedor_id,
      tipo_soporte: enc.tipo_soporte, documento: enc.documento, observaciones: enc.obs, soporte_ruta: ruta, propuesta_ia: propuesta,
      motivo_forzado: conMotivo || motivo.trim().length >= 15 ? motivo : null, confirmados: envio.confirmados,
      lineas: lineas.filter((l) => areaDe(l) === g).map((l) => {
        const c = calculo(l);
        return {
          producto_id: l.producto_id, ubicacion: l.zona || undefined, cantidad_pedida: c.ped, cantidad_recibida: c.rec, valor_total: c.val,
          contenido_base: c.p?.contenido_variable ? c.contenido : undefined,
          condicion: l.condicion, sello: l.sello || null, temperatura: num(l.temperatura), vencimiento: l.vencimiento || null,
          lote_proveedor: l.lote || null, observaciones: l.obs, nombre_factura: l.nombre_factura,
          origen: origenLinea(l.ia, { producto_id: l.producto_id, cantidad: c.rec, valor_total: c.val }),
        };
      }),
    };
  }

  // Una factura con productos de las dos áreas se guarda como dos recepciones (mismo número y foto).
  // Primero la del área de la pantalla; las líneas que ya quedaron guardadas salen de la lista.
  function guardar(conMotivo: boolean) {
    setResultado(null);
    iniciar(async () => {
      const grupos = [...new Set(lineas.map(areaDe))].sort((a, b) => Number(b === area) - Number(a === area));
      const codigos: string[] = [];
      const avisos: string[] = [];
      for (const g of grupos) {
        let ruta = foto?.ruta ?? null;
        if (ruta && g !== area) {
          const c = await copiarFoto(ruta, g);
          if (!c.ok) { setResultado({ ok: false, id: null, codigo: null, fatales: [c.error], bloqueos: [], avisos: [] }); return; }
          ruta = c.ruta;
        }
        const r = await registrarRecepcion(payload(conMotivo, g, ruta), g === area ? envio.clave : claveOtra);
        if (!r.ok) {
          setResultado({ ...r, avisos: [...(codigos.length ? [`Ya quedó guardada: ${codigos.join(', ')}. Falta la de ${nombreArea(g)}.`] : []), ...r.avisos] });
          return;
        }
        codigos.push(r.codigo!);
        avisos.push(...r.avisos);
        setLineas((ls) => ls.filter((l) => areaDe(l) !== g));
      }
      try { localStorage.removeItem(clave); } catch { /* nada */ }
      setResultado({ ok: true, id: null, codigo: codigos.join(' y '), fatales: [], bloqueos: [], avisos });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  function empezarDeNuevo() {
    envio.nuevo(); setClaveOtra(crypto.randomUUID());
    setEnc({ ...vacio, ...zonasRecordadas() }); setLineas([]); setFoto(null); setVista(null); setPropuesta(null); setTotalFactura(null);
    setNotaIA(null); setNotaProveedor(null); setProvLeido(null); setMotivo(''); setResultado(null); setErrorFoto(null);
  }

  if (resultado?.ok) {
    return (
      <div className="tarjeta">
        <p className="exito" role="status" style={{ marginTop: 0 }}>
          <strong>{resultado.codigo?.includes(' y ') ? 'Recepciones guardadas' : 'Recepción guardada'}: {resultado.codigo}</strong><br />
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
        {estadoFoto === 'leyendo' && <p className="suave" role="status" style={{ fontSize: '.88rem' }}>Esto toma entre 10 y 40 segundos. No cierre la pantalla.</p>}
        {errorFoto && <p className="error" role="alert">{errorFoto}</p>}
        {foto && !estadoFoto && (
          <p className="suave" style={{ fontSize: '.85rem', marginBottom: 0 }}>
            ✓ Foto guardada{vista && <> · <a href={vista} target="_blank" rel="noreferrer">verla</a></>}
          </p>
        )}
        {notaIA && <p className="aviso" style={{ marginBottom: 0 }}><strong>Revise:</strong> {notaIA}</p>}
      </section>

      {/* ------------------------------------------------ encabezado */}
      <section className="tarjeta" style={{ marginTop: '.75rem' }}>
        <strong>2. Proveedor y documento</strong>
        <label htmlFor="prov">Proveedor</label>
        <select id="prov" value={enc.proveedor_id} onChange={(e) => ponerEnc({ proveedor_id: e.target.value })}>
          <option value="">— Elija de la lista —</option>
          {listaProv.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        {notaProveedor && <span className="ayuda" role="status">{notaProveedor}</span>}
        {!enc.proveedor_id && provLeido && (
          <div className="aviso" style={{ margin: '.5rem 0 0' }}>
            La factura dice <strong>«{provLeido.nombre}»</strong> y no está en la lista.
            {provLeido.sugeridos.length > 0 && <> ¿Es alguno de estos?</>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', marginTop: '.5rem' }}>
              {provLeido.sugeridos.map((x) => (
                <button key={x.id} type="button" className="secundario chico" onClick={() => { ponerEnc({ proveedor_id: x.id }); setProvLeido(null); }}>{x.nombre}</button>
              ))}
              <button type="button" className="chico" disabled={creandoProv} onClick={() => nuevoProveedor(provLeido.nombre, provLeido.nit)}>
                {creandoProv ? 'Creando…' : `Crear «${provLeido.nombre}»`}
              </button>
            </div>
          </div>
        )}
        {!enc.proveedor_id && !provLeido && (
          <button type="button" className="discreto mini" style={{ marginTop: '.3rem' }} disabled={creandoProv} onClick={() => nuevoProveedor(null, null)}>+ Proveedor nuevo</button>
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
            <label htmlFor="zona">Zona por defecto <span className="ayuda">cada artículo puede ir a otra</span></label>
            <select id="zona" value={enc.ubicacion} onChange={(e) => ponerEnc({ ubicacion: e.target.value })}>
              <option value="">— Zona —</option>
              {zonas.map((z) => <option key={z.codigo} value={z.codigo}>{z.nombre}</option>)}
            </select>
          </div>
        </div>
        {otra && deLaOtra > 0 && (
          <div className="aviso" style={{ marginBottom: 0 }}>
            <strong>Esta factura trae {deLaOtra} producto(s) de {nombreArea(otra.area)}.</strong> Al guardar se registran dos recepciones,
            una por área, con la misma foto y el mismo número.
            <label htmlFor="zona-otra" style={{ marginTop: '.5rem' }}>Zona por defecto de lo de {nombreArea(otra.area)}</label>
            <select id="zona-otra" value={enc.ubicacion_otra ?? ''} onChange={(e) => ponerEnc({ ubicacion_otra: e.target.value })}>
              <option value="">— Zona de {nombreArea(otra.area)} —</option>
              {otra.zonas.map((z) => <option key={z.codigo} value={z.codigo}>{z.nombre}</option>)}
            </select>
          </div>
        )}
      </section>

      {/* ------------------------------------------------ líneas */}
      <h2>3. Productos {lineas.length > 0 && <span className="suave" style={{ fontWeight: 400 }}>({lineas.length})</span>}</h2>
      {sinConfirmar > 0 && (
        <div className="aviso confirmar-bloque">
          <span>La IA propuso {sinConfirmar === 1 ? '1 línea' : `${sinConfirmar} líneas`} sin confirmar. Revise producto, cantidad y valor contra la factura.</span>
          {cuadran.length > 0 && (
            <>
              <button type="button" onClick={() => { const ks = new Set(cuadran.map((l) => l.clave)); setLineas((ls) => ls.map((l) => (ks.has(l.clave) ? { ...l, confirmada: true } : l))); }}>
                ✓ Confirmar {cuadran.length === 1 ? 'la que cuadra' : `las ${cuadran.length} que cuadran`}
              </button>
              <span className="ayuda">Producto reconocido, cantidad y valor escritos, y precio parecido al de siempre.
                {sinConfirmar - cuadran.length === 1 && ' La otra revísela a mano.'}
                {sinConfirmar - cuadran.length > 1 && ` Las otras ${sinConfirmar - cuadran.length} revíselas una por una.`}</span>
            </>
          )}
        </div>
      )}
      <ul className="lista">
        {lineas.map((l, i) => (
          <TarjetaLinea key={l.clave} vePesos={vePesos} n={i + 1} l={l} c={calculo(l)} productos={todos} porId={porId} area={area} otraArea={otra?.area ?? null}
                        zonas={areaDe(l) === area ? zonas : otra?.zonas ?? []} zonaDefecto={areaDe(l) === area ? enc.ubicacion : enc.ubicacion_otra ?? ''}
                        zonaDe={zonaDe} elegida={elegidas.has(l.clave)}
                        marcar={() => setElegidas((s) => { const x = new Set(s); if (x.has(l.clave)) x.delete(l.clave); else x.add(l.clave); return x; })}
                        creado={(x) => setExtras((xs) => [...xs, x])}
                        poner={(cambio) => poner(l.clave, cambio)}
                        quitar={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))} />
        ))}
      </ul>
      {elegidas.size > 0 && (
        <div className="barra-bloque" style={{ marginTop: '.6rem' }}>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{elegidas.size} marcado(s) →</strong>
            <select value={zonaGrupo} onChange={(e) => setZonaGrupo(e.target.value)} style={{ flex: '1 1 180px' }} aria-label="Zona para los marcados">
              <option value="">— Guardar en… —</option>
              <optgroup label={`Zonas de ${nombreArea(area)}`}>{zonas.map((z) => <option key={z.codigo} value={z.codigo}>{z.nombre}</option>)}</optgroup>
              {otra && <optgroup label={`Zonas de ${nombreArea(otra.area)}`}>{otra.zonas.map((z) => <option key={z.codigo} value={z.codigo}>{z.nombre}</option>)}</optgroup>}
            </select>
            <button type="button" className="chico" disabled={!zonaGrupo} onClick={() => {
              // la zona solo se aplica a los artículos de su misma área
              const areaZona: Area = zonas.some((z) => z.codigo === zonaGrupo) ? area : otra!.area;
              setLineas((ls) => ls.map((l) => (elegidas.has(l.clave) && areaDe(l) === areaZona ? { ...l, zona: zonaGrupo } : l)));
              setElegidas(new Set()); setZonaGrupo('');
            }}>Aplicar</button>
            <button type="button" className="discreto chico" onClick={() => setElegidas(new Set())}>Quitar marcas</button>
          </div>
          {otra && <span className="ayuda">Una zona de {nombreArea(area)} solo se aplica a lo de {nombreArea(area)}, y una de {nombreArea(otra.area)} a lo suyo.</span>}
        </div>
      )}
      <div className="acciones" style={{ marginTop: '.6rem' }}>
        <button type="button" className="secundario" onClick={() => setLineas((ls) => [...ls, nueva()])}>+ Agregar producto</button>
        <button type="button" className="secundario" onClick={() => { setLeido(null); setEscaneando(true); }}><Icono nombre="escanear" /> Escanear</button>
      </div>
      {leido && <p className={leido.ok ? 'exito' : 'aviso'} style={{ margin: '.5rem 0', padding: '.4rem .6rem' }}>{leido.texto}</p>}
      {escaneando && <Escaner continuo titulo="Escanear: cada unidad suma una" onCerrar={() => setEscaneando(false)} onCodigo={escaneado} />}
      {porAsociar && (
        <div className="tarjeta" style={{ marginTop: '.6rem', padding: '.7rem' }}>
          <strong>Código nuevo <span className="cod">{porAsociar}</span>: ¿qué producto es?</strong>
          <div className="suave" style={{ fontSize: '.82rem' }}>Elíjalo una vez y la app lo reconoce en adelante.</div>
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
      {descuadre && <p className="aviso">La suma de las líneas no cuadra con el total de la factura. Revise IVA, descuentos o una línea que falte.</p>}

      <label htmlFor="obs">Observaciones <span className="ayuda">opcional</span></label>
      <textarea id="obs" rows={2} value={enc.obs} onChange={(e) => ponerEnc({ obs: e.target.value })} />

      {resultado && !resultado.ok && !!resultado.revisar?.length && (
        <Revisiones resultado={resultado} confirmados={envio.confirmados} setConfirmados={envio.setConfirmados} />
      )}
      {resultado && !resultado.ok && !resultado.revisar?.length && (
        <div className={bloqueado ? 'aviso' : 'error'} role="alert">
          <strong>{bloqueado ? 'Para guardar así hace falta un motivo:' : 'No se guardó:'}</strong>
          <ul>{[...resultado.fatales, ...resultado.bloqueos].map((m) => <li key={m}>{m}</li>)}</ul>
          {resultado.avisos.length > 0 && <><strong>Avisos:</strong><ul>{resultado.avisos.map((m) => <li key={m}>{m}</li>)}</ul></>}
          {bloqueado && (
            <>
              <label htmlFor="motivo">Corrija lo de arriba, o escriba por qué se recibe así</label>
              <textarea id="motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                        placeholder="Ej.: el proveedor subió el precio, confirmado con administración" />
            </>
          )}
        </div>
      )}

      <div className="acciones barra-guardar">
        {lineas.length > 0 && (
          // siempre a la vista: la suma de las líneas contra el total que leyó la IA
          <div className="resumen-suma" role="status">
            <span>Suma <b>{pesos(sumaLineas)}</b></span>
            {totalFactura !== null && <>
              <span>Factura <b>{pesos(totalFactura)}</b></span>
              <span>Diferencia <b>{pesos(sumaLineas - totalFactura)}</b></span>
              {descuadre ? <Insignia tono="aviso">No cuadra</Insignia> : <Insignia tono="ok">Cuadra</Insignia>}
            </>}
          </div>
        )}
        {bloqueado ? (
          <button type="button" disabled={enviando || motivo.trim().length < 15} onClick={() => guardar(true)}>
            {enviando ? 'Guardando…' : 'Guardar con este motivo'}
          </button>
        ) : (
          <button type="button" disabled={enviando || !!estadoFoto || !lineas.length || sinConfirmar > 0 || sinProducto > 0 || sinPeso > 0 || faltaZona || faltaZonaOtra}
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
      {(sinProducto > 0 || sinConfirmar > 0 || sinPeso > 0 || faltaZona || faltaZonaOtra) && lineas.length > 0 && (
        <p className="suave" style={{ fontSize: '.85rem' }}>
          {sinProducto > 0 ? `Falta elegir el producto en ${sinProducto} línea(s), o quitarla si no es un insumo. ` : ''}
          {sinConfirmar > 0 ? `Falta confirmar ${sinConfirmar} línea(s) propuesta(s) por la IA. ` : ''}
          {sinPeso > 0 ? `Falta pesar ${sinPeso} línea(s) que llegaron por unidad. ` : ''}
          {faltaZona ? 'Falta la zona por defecto (o la zona de cada artículo). ' : ''}
          {otra && faltaZonaOtra ? `Falta la zona de lo de ${nombreArea(otra.area)}.` : ''}
        </p>
      )}
    </>
  );
}

// ==================================================================== una línea
type Calculo = ReturnType<typeof calcular>;

function TarjetaLinea({ n, l, c, productos, porId, area, otraArea, zonas, zonaDefecto, zonaDe, elegida, marcar, creado, poner, quitar, vePesos }: {
  vePesos: boolean;   // costo promedio y referencia: solo administración; el valor de la factura lo ven todos
  n: number; l: Linea; c: Calculo; productos: ProductoRecepcion[]; porId: Map<string, ProductoRecepcion>; area: Area; otraArea: Area | null;
  zonas: { codigo: string; nombre: string }[]; zonaDefecto: string; zonaDe: Record<string, string>; elegida: boolean; marcar: () => void;
  creado: (p: ProductoRecepcion) => void; poner: (cambio: Partial<Linea>) => void; quitar: () => void;
}) {
  const [creando, setCreando] = useState(false);
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
    const cambio: Partial<Linea> = { producto_id: x.producto_id, sello: '', temperatura: '', zona: zonaDe[x.producto_id] ?? '' };
    if (l.cantidad_factura !== null) {
      const conv = aUnidadesCompra(l.cantidad_factura, l.unidad_factura, x, l.nombre_factura);
      Object.assign(cambio, { recibida: conv.cantidad === null ? '' : String(conv.cantidad), nota: conv.nota, pesar: !!conv.pesar,
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
          <label style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center', margin: 0, fontWeight: 400 }}>
            <input type="checkbox" checked={elegida} onChange={marcar} aria-label={`Marcar la línea ${n}`} />
            <span className="suave" style={{ fontSize: '.8rem' }}>Línea {n}{l.ia ? ' · leída por la IA' : ''}</span>
          </label>
          {l.nombre_factura && <div className="suave" style={{ fontSize: '.85rem' }}>Factura: «{l.nombre_factura}»</div>}
          {p && !eligiendo && l.ia_sugerido?.producto_id === p.producto_id && (
            <div className="suave" style={{ fontSize: '.82rem', color: 'var(--tinta)' }}>Elegido por la IA: {l.ia_sugerido.razon} Revíselo.</div>
          )}
          {p && !eligiendo && (
            <div>
              <strong>{nombreDe(p)}</strong>
              {p.area && p.area !== area && <span className="etiqueta provisional" style={{ marginLeft: '.4rem' }}>va a {nombreArea(p.area)}</span>}
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
          {!p && l.nombre_factura && !creando && (
            <div className="aviso" style={{ margin: '0 0 .5rem', padding: '.5rem .7rem', fontSize: '.9rem' }}>
              <strong>«{l.nombre_factura}» no está con ese nombre en el catálogo{otraArea ? '' : ` de ${nombreArea(area)}`}.</strong>{' '}
              {l.ia_sugerido?.producto_id && porId.get(l.ia_sugerido.producto_id) ? (
                <span style={{ display: 'block', marginTop: '.3rem' }}>
                  La IA cree que es <strong>{nombreDe(porId.get(l.ia_sugerido.producto_id)!)}</strong>
                  {l.ia_sugerido.confianza !== 'alta' && ' (no está segura)'}: {l.ia_sugerido.razon}{' '}
                  <button type="button" className="chico" style={{ marginTop: '.3rem' }} onClick={() => elegir(porId.get(l.ia_sugerido!.producto_id!)!)}>
                    Sí, es {porId.get(l.ia_sugerido.producto_id)!.generico}
                  </button>
                </span>
              ) : l.ia_sugerido ? (
                <span style={{ display: 'block', marginTop: '.3rem' }}>La IA: {l.ia_sugerido.razon}</span>
              ) : null}
              <span style={{ display: 'block', marginTop: '.3rem' }}>
                {sugeridos.length ? 'Otros parecidos están abajo; si ninguno es, créelo.' : 'No se parece a ningún producto: créelo o búsquelo con otro nombre.'}
              </span>
              <div style={{ marginTop: '.4rem' }}>
                <button type="button" className="chico" onClick={() => setCreando(true)}>+ Crear «{nombreSugerido(l.nombre_factura)}»</button>
              </div>
            </div>
          )}
          {creando && <CrearRapido area={area} otraArea={otraArea} l={l} cancelar={() => setCreando(false)}
                                   listo={(x) => { creado(x); setCreando(false); elegir(x); }} />}
          {sugeridos.length > 0 && (
            <div className="segmentos" style={{ marginBottom: '.4rem' }}>
              {sugeridos.map((x) => (
                <button key={x.producto_id} type="button" className="secundario chico" style={{ textAlign: 'left' }} onClick={() => elegir(x)}>
                  {nombreDe(x)} <span className="suave">· {x.presentacion}{x.area && x.area !== area ? ` · ${nombreArea(x.area)}` : ''}</span>
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
                    <strong>{nombreDe(x)}</strong> <span className="suave">· {x.presentacion}{x.area && x.area !== area ? ` · ${nombreArea(x.area)}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {buscar.trim().length >= 2 && !opciones.length && (
            <p className="suave" style={{ fontSize: '.85rem' }}>No está en el catálogo.{' '}
              <button type="button" className="discreto mini" onClick={() => setCreando(true)}>Crear «{nombreSugerido(buscar)}»</button></p>
          )}
          {p && <button type="button" className="secundario" style={{ marginTop: '.4rem' }} onClick={() => setEligiendo(false)}>Dejar {nombreDe(p)}</button>}
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
          <label style={{ ...campo, marginTop: '.5rem' }}>Se guarda en
            <select value={l.zona ?? ''} onChange={(e) => poner({ zona: e.target.value })}>
              <option value="">{zonaDefecto ? `${zonas.find((z) => z.codigo === zonaDefecto)?.nombre ?? zonaDefecto} (la zona por defecto)` : '— la zona por defecto —'}</option>
              {zonas.map((z) => <option key={z.codigo} value={z.codigo}>{z.nombre}{zonaDe[p.producto_id] === z.codigo ? ' · su lugar habitual' : ''}</option>)}
            </select>
          </label>
          {(p.contenido_variable || l.pesar) && (
            <label style={{ ...campo, marginTop: '.5rem' }}>
              {l.pesar ? <strong style={{ color: c.faltaPeso ? 'var(--aviso)' : undefined }}>Péselo: peso total que llegó ({p.unidad_base}) *</strong>
                : <>Peso o volumen total que llegó ({p.unidad_base})</>}
              <input inputMode="decimal" value={l.total_base} onChange={(e) => poner({ total_base: e.target.value })}
                     style={c.faltaPeso ? { borderColor: 'var(--aviso)', borderWidth: 2 } : undefined}
                     placeholder={l.pesar ? 'en la balanza, sin la bolsa' : undefined} />
              {l.pesar && !p.contenido_variable && c.rec !== null && !c.faltaPeso && <span className="ayuda">= {fmtCantidad(c.rec)} {p.unidad_compra.toLowerCase()}</span>}
            </label>
          )}
          {l.nota && <div className="suave" style={{ fontSize: '.8rem', marginTop: '.3rem' }}>{l.nota}</div>}
          {c.diferencia !== null && !l.obs.trim() && (
            <div className="aviso" style={{ margin: '.5rem 0 0', padding: '.4rem .6rem', fontSize: '.85rem' }}>
              Diferencia de {c.diferencia > 0 ? '+' : ''}{fmtCantidad(c.diferencia)} frente a lo pedido. Escriba qué pasó en observaciones.
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
              {vePesos && p.costo_promedio === null && <> · primera compra: fija el costo del producto</>}
            </div>
          )}
        </>
      )}

      {!l.confirmada && (
        <div className="acciones" style={{ marginTop: '.6rem' }}>
          <button type="button" disabled={!l.producto_id} onClick={() => poner({ confirmada: true })}>
            {l.producto_id ? 'Confirmar línea' : 'Elija el producto para confirmar'}
          </button>
        </div>
      )}
    </li>
  );
}

// «NARANJA COMUN 2,5KG» → «Naranja»: el nombre del producto sin cantidades ni relleno de factura
const RELLENO = new Set(['comun', 'corriente', 'tarrina', 'malla', 'unidad', 'und', 'libra', 'media', 'x', 'bolsa', 'paquete', 'nacional', 'premium', 'extra', 'tipo', 'kilo']);
function nombreSugerido(t: string) {
  const ws = t.replace(/\d+([.,]\d+)?\s*(kg|kgs|g|gr|grs|lb|ml|l|lt|cc|und|oz)\b/gi, ' ').replace(/\d+([.,]\d+)?/g, ' ')
    .split(/\s+/).filter((w) => w && !RELLENO.has(sinTildes(w)));
  const n = ws.join(' ').toLowerCase().trim();
  return n ? n[0].toUpperCase() + n.slice(1) : t.trim();
}

// Alta de un producto que no existe, desde la línea: provisional, a granel en g/ml/und (lo que se pesa
// o se cuenta al recibir). Lo valida después quien edita el área.
function CrearRapido({ area, otraArea, l, listo, cancelar }: { area: Area; otraArea: Area | null; l: Linea; listo: (p: ProductoRecepcion) => void; cancelar: () => void }) {
  const [para, setPara] = useState<Area>(area);
  const u = (l.unidad_factura ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  const ubInicial: 'g' | 'ml' | 'und' = ['L', 'LT', 'LTS', 'LITRO', 'LITROS', 'ML', 'CC'].includes(u) ? 'ml' : 'g';
  const [nombre, setNombre] = useState(nombreSugerido(l.nombre_factura ?? ''));
  const [ub, setUb] = useState<'g' | 'ml' | 'und'>(ubInicial);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<{ fatales: string[]; bloqueos: string[] } | null>(null);
  const [enviando, iniciar] = useTransition();
  const campo = { margin: 0, fontWeight: 400, fontSize: '.85rem' } as const;

  function crear() {
    iniciar(async () => {
      const r = await crearProductoRapido(para, {
        nombre: nombre.trim(), unidad_base: ub, presentacion: 'Granel', unidad_compra: ub === 'g' ? 'GR' : ub === 'ml' ? 'ML' : 'UND',
        contenido_base: 1, contenido_variable: false, categoria: null, motivo: motivo.trim() || null, factura: l.nombre_factura,
      });
      if (r.ok) listo({ ...r.producto, area: para }); else setError({ fatales: r.fatales, bloqueos: r.bloqueos });
    });
  }
  const bloqueado = !!error && !error.fatales.length && error.bloqueos.length > 0;

  return (
    <div className="tarjeta" style={{ padding: '.7rem', margin: '0 0 .5rem' }}>
      <strong>Producto nuevo</strong>
      <span className="ayuda">Queda provisional hasta que lo valide el jefe del área. Se recibe a granel: se cuenta o se pesa al llegar.</span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '.5rem', marginTop: '.5rem' }}>
        <label style={campo}>Nombre
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
        </label>
        <label style={campo}>Se lleva en
          <select value={ub} onChange={(e) => setUb(e.target.value as 'g' | 'ml' | 'und')}>
            <option value="g">gramos</option><option value="ml">mililitros</option><option value="und">unidades</option>
          </select>
        </label>
      </div>
      {otraArea && (
        <div className="segmentos" role="radiogroup" aria-label="Área del producto" style={{ marginTop: '.5rem' }}>
          {[area, otraArea].map((a) => (
            <label key={a}><input type="radio" checked={para === a} onChange={() => setPara(a)} /><span>Para {nombreArea(a)}</span></label>
          ))}
        </div>
      )}
      {error && (
        <div className={bloqueado ? 'aviso' : 'error'} style={{ margin: '.5rem 0 0', padding: '.4rem .6rem', fontSize: '.85rem' }}>
          <ul style={{ margin: 0 }}>{[...error.fatales, ...error.bloqueos].map((m) => <li key={m}>{m}</li>)}</ul>
          {bloqueado && (
            <label style={{ ...campo, marginTop: '.4rem' }}>Si no es ninguno de esos, escriba por qué (mínimo 15 caracteres)
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: es la fruta fresca, no la pulpa" />
            </label>
          )}
        </div>
      )}
      <div className="acciones" style={{ marginTop: '.6rem' }}>
        <button type="button" className="chico" disabled={enviando || nombre.trim().length < 3 || (bloqueado && motivo.trim().length < 15)} onClick={crear}>
          {enviando ? 'Creando…' : bloqueado ? 'Crear con este motivo' : 'Crear y usar'}
        </button>
        <button type="button" className="discreto chico" onClick={cancelar}>Cancelar</button>
      </div>
    </div>
  );
}
