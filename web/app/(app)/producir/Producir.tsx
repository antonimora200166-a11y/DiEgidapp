'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { fmtCantidad } from '@/lib/catalogo';
import { calcularLote, rendimientoFicha, vence as calcularVence } from '@/lib/produccion';
import { cant, textoPresentacion, tipoPunto, type Almacenamiento, type Presentacion, type Punto } from '@/lib/fichas';
import type { Area } from '@/lib/roles';
import { registrarLote, type ResultadoLote } from './acciones';
import { confirmar } from '@/components/Dialogo';
import { Revisiones } from '@/components/RechazoConMotivo';
import { useEnvio } from '@/lib/envio';
import Escaner from '@/components/Escaner';
import Icono from '@/components/Icono';
import { leerCodigo } from '@/lib/escaneo';
import { fecha as fmtFecha } from '@/lib/formato';
import { avisar } from '@/components/Avisos';
import { Insignia } from '@/components/Insignia';

type UB = 'g' | 'ml' | 'und';
export type Mpi = {
  producto_id: string; codigo: string; generico_id: string; generico: string; marca: string; presentacion: string; unidad_base: UB;
  costo_promedio: number | null; factor_g: number | null; densidad: number | null; ficha_id: string | null; ficha_codigo: string | null; ultimo_lote: string | null;
};
type FichaLinea = { linea: number; generico_id: string; generico: string; tipo: string; unidad_base: UB; producto_id?: string | null; cantidad: number | null; unidad: string; nota: string | null; base: number | null };
type Ficha = {
  id: string; codigo: string; version: number; neto_esperado: number | null; nota: string | null; alergenos: string[]; empaque: string | null;
  tiempo_min: number | null; puntos: Punto[]; almacenamientos: Almacenamiento[]; lineas: FichaLinea[];
  presentaciones?: Presentacion[];   // cómo se porciona y empaca lo que sale
};
type Insumo = {
  producto_id: string; codigo: string; generico_id: string; generico: string; marca: string; presentacion: string; tipo: string; unidad_base: UB;
  costo_promedio: number | null; factor_g: number | null; densidad: number | null;
};
export type DatosProduccion = {
  umbral_pp: number; mpis: Mpi[]; fichas: Ficha[]; insumos: Insumo[];
  saldos: { producto_id: string; ubicacion: string; cantidad: number }[];
  responsables: { id: string; nombre: string; rol: string }[];
};
// Un ingrediente: lo que se teclea va como texto para no perder lo escrito
type Consumo = {
  clave: string; generico_id: string; generico: string; unidad_base: UB; producto_id: string | null; zona: string;
  gramos: string; unidades: string; factor: string; esperado_g: number | null; esperado_und: number | null; linea_ficha: number | null; nota: string;
  lote_origen?: string | null;   // lote escaneado: sale primero de ese lote (trazabilidad)
};
type Zona = { codigo: string; nombre: string };

const hoyCali = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const num = (s: string) => { const n = Number(s.replace(',', '.')); return s.trim() === '' || !Number.isFinite(n) ? null : n; };
const pesos = (n: number | null, dec?: number) => n === null ? '—' : '$' + n.toLocaleString('es-CO', { maximumFractionDigits: dec ?? (n < 100 ? 2 : 0), minimumFractionDigits: dec ?? (n < 100 ? 2 : 0) });
const g = (n: number | null) => (n === null ? '—' : `${fmtCantidad(Math.round(n))} g`);
const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const r2 = (n: number) => Math.round(n * 100) / 100;
const fechaCorta = (d: string) => fmtFecha(d);
const PASOS = ['MPI y tanda', 'Indicaciones', 'Pesos reales', 'Neto y responsable'];
const conservacionDeZona = (nombre: string): Almacenamiento['conservacion'] | null =>
  /congel/i.test(nombre) ? 'Congelado' : /(nevera|refri|fr[ií]o|cuarto)/i.test(nombre) ? 'Refrigerado' : null;

export default function Producir({ area, datos, zonas, zonaDe, generico, perfilId, vePesos }: {
  area: Area; datos: DatosProduccion; zonas: Zona[];
  vePesos: boolean;                 // costo del lote: solo administración
  zonaDe: Record<string, string>;   // la zona asignada a cada producto en el mapa del área
  generico?: string;                // «Producir esta ficha»: llega con la MPI elegida
  perfilId: string;
}) {
  const insumoPorId = useMemo(() => new Map(datos.insumos.map((i) => [i.producto_id, i])), [datos.insumos]);
  const fichaPorId = useMemo(() => new Map(datos.fichas.map((f) => [f.id, f])), [datos.fichas]);
  const saldo = (producto: string, zona: string) =>
    datos.saldos.filter((s) => s.producto_id === producto && s.ubicacion === zona).reduce((t, s) => t + Number(s.cantidad), 0);
  const saldoTotal = (producto: string) => datos.saldos.filter((s) => s.producto_id === producto).reduce((t, s) => t + Number(s.cantidad), 0);
  const nombreZona = (c: string) => zonas.find((z) => z.codigo === c)?.nombre ?? c;
  // zona propuesta: la que más tiene de ese producto; si no hay, su lugar en el mapa
  const proponerZona = (producto: string | null) => {
    if (!producto) return '';
    const con = zonas.map((z) => ({ z: z.codigo, q: saldo(producto, z.codigo) })).filter((x) => x.q > 0).sort((a, b) => b.q - a.q);
    return con[0]?.z ?? zonaDe[producto] ?? (zonas.length === 1 ? zonas[0].codigo : '');
  };

  const [paso, setPaso] = useState(1);
  const [mpiId, setMpiId] = useState<string | null>(null);
  const [fecha, setFecha] = useState(hoyCali());
  const [tandas, setTandas] = useState('1');
  const [consumos, setConsumos] = useState<Consumo[]>([]);
  const [neto, setNeto] = useState('');
  const [unidades, setUnidades] = useState('');
  const [netoFactor, setNetoFactor] = useState('');
  const [responsable, setResponsable] = useState(perfilId);
  const [destino, setDestino] = useState('');
  const [conservacion, setConservacion] = useState<Almacenamiento['conservacion'] | ''>('');
  const [tiempo, setTiempo] = useState('');
  const [obs, setObs] = useState('');
  const [empacadas, setEmpacadas] = useState<Record<number, string>>({});   // solo para repartir el neto: no se guarda
  const [motivo, setMotivo] = useState('');
  const [buscarMpi, setBuscarMpi] = useState('');
  const [buscarInsumo, setBuscarInsumo] = useState('');
  const [resultado, setResultado] = useState<ResultadoLote | null>(null);
  const [enviando, iniciar] = useTransition();
  const envio = useEnvio();
  const [escaneando, setEscaneando] = useState(false);
  const [leido, setLeido] = useState<{ ok: boolean; texto: string } | null>(null);

  const mpi = mpiId ? datos.mpis.find((m) => m.producto_id === mpiId) ?? null : null;
  const ficha = mpi?.ficha_id ? fichaPorId.get(mpi.ficha_id) ?? null : null;
  const k = num(tandas) ?? 1;

  // ---------------------------------------------------------------- borrador en este equipo
  const clave = `sgi-producir2:${area}`;
  const [cargado, setCargado] = useState(false);
  const [retomado, setRetomado] = useState<string | null>(null);   // día en que se empezó un borrador viejo
  // el día en que se empezó el borrador; al retomar uno viejo y seguir, pasa a ser hoy
  const diaBorrador = retomado ?? hoyCali();
  const [llenado, setLlenado] = useState<string | null>(null);
  const [cambiarDestino, setCambiarDestino] = useState(false);   // la zona y conservación propuestas se ven como tarjeta     // ingrediente que se acaba de llenar con «Pesé»
  useEffect(() => {
    try {
      const b = JSON.parse(localStorage.getItem(clave) || 'null');
      if (b?.mpiId && datos.mpis.some((m) => m.producto_id === b.mpiId)) {
        // un lote empezado otro día no se guarda con aquella fecha sin que la persona lo decida:
        // se pone la de hoy y se avisa que es un borrador viejo
        const dia = b.dia ?? b.fecha;
        const deOtroDia = !!dia && dia !== hoyCali();
        if (deOtroDia) setRetomado(dia);
        setMpiId(b.mpiId); setPaso(b.paso ?? 1); setFecha(deOtroDia ? hoyCali() : b.fecha ?? hoyCali()); setTandas(b.tandas ?? '1'); setConsumos(b.consumos ?? []);
        setNeto(b.neto ?? ''); setUnidades(b.unidades ?? ''); setNetoFactor(b.netoFactor ?? ''); setResponsable(b.responsable ?? perfilId);
        setDestino(b.destino ?? ''); setConservacion(b.conservacion ?? ''); setTiempo(b.tiempo ?? ''); setObs(b.obs ?? '');
      }
    } catch { /* borrador dañado: se empieza de cero */ }
    setCargado(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);
  useEffect(() => {
    if (!cargado || resultado?.ok) return;
    try {
      if (mpiId) localStorage.setItem(clave, JSON.stringify({ dia: diaBorrador, mpiId, paso, fecha, tandas, consumos, neto, unidades, netoFactor, responsable, destino, conservacion, tiempo, obs }));
    } catch { /* sin almacenamiento */ }
  }, [clave, cargado, resultado, diaBorrador, mpiId, paso, fecha, tandas, consumos, neto, unidades, netoFactor, responsable, destino, conservacion, tiempo, obs]);

  // ---------------------------------------------------------------- elegir MPI y escalar la ficha
  // la marca que pide la ficha; si no pide ninguna, la que más hay
  function proponerProducto(generico_id: string, marca?: string | null): Insumo | null {
    const pedida = marca ? datos.insumos.find((i) => i.producto_id === marca && i.generico_id === generico_id) : undefined;
    if (pedida) return pedida;
    const lista = datos.insumos.filter((i) => i.generico_id === generico_id);
    return lista.length ? [...lista].sort((a, b) => saldoTotal(b.producto_id) - saldoTotal(a.producto_id))[0] : null;
  }
  // lo que la ficha espera de una línea, en gramos (o unidades si se cuenta)
  function esperado(l: FichaLinea, f: number): { g: number | null; und: number | null } {
    if (l.base === null) return { g: null, und: null };
    if (l.unidad_base === 'und') return { g: null, und: r2(l.base * f) };
    if (l.unidad_base === 'ml') { const i = datos.insumos.find((x) => x.generico_id === l.generico_id); return { g: r2(l.base * f * (l.tipo === 'SIN_COSTO' ? 1 : i?.densidad ?? 1)), und: null }; }
    return { g: r2(l.base * f), und: null };
  }
  function desdeFicha(f: Ficha, factorTanda: number): Consumo[] {
    return f.lineas.map((l) => {
      const p = proponerProducto(l.generico_id, l.producto_id);
      const e = esperado(l, factorTanda);
      return { clave: crypto.randomUUID(), generico_id: l.generico_id, generico: l.generico, unidad_base: l.unidad_base, producto_id: p?.producto_id ?? null,
               zona: p && p.tipo !== 'SIN_COSTO' ? proponerZona(p.producto_id) : '', gramos: '', unidades: '',
               factor: p && p.unidad_base === 'ml' && p.tipo !== 'SIN_COSTO' && p.factor_g === null && p.densidad ? String(Math.round(1000 / p.densidad) / 1000) : '',
               esperado_g: e.g, esperado_und: e.und, linea_ficha: l.linea, nota: l.nota ?? '' };
    });
  }
  function elegirMpi(m: Mpi) {
    setMpiId(m.producto_id); setBuscarMpi(''); setResultado(null); setTandas('1'); setPaso(1);
    const z = zonaDe[m.producto_id] ?? (zonas.length === 1 ? zonas[0].codigo : '');
    setDestino(z);
    const f = m.ficha_id ? fichaPorId.get(m.ficha_id) : null;
    const desdeZona = z ? conservacionDeZona(nombreZona(z)) : null;
    setConservacion(f?.almacenamientos.find((a) => a.conservacion === desdeZona)?.conservacion ?? (f?.almacenamientos.length === 1 ? f.almacenamientos[0].conservacion : ''));
    setConsumos(f ? desdeFicha(f, 1) : []);
    setNeto(''); setUnidades(''); setNetoFactor(m.unidad_base === 'ml' && m.factor_g === null && m.densidad ? String(Math.round(1000 / m.densidad) / 1000) : '');
  }
  useEffect(() => {
    if (!cargado || !generico) return;
    const m = datos.mpis.find((x) => x.generico_id === generico);
    if (m && datos.mpis.find((x) => x.producto_id === mpiId)?.generico_id !== generico) elegirMpi(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargado, generico]);

  function cambiarTandas(t: string) {
    setTandas(t);
    const f = num(t);
    if (!ficha || f === null || f <= 0) return;
    setConsumos((cs) => cs.map((c) => {
      const l = c.linea_ficha !== null ? ficha.lineas.find((x) => x.linea === c.linea_ficha) : undefined;
      if (!l) return c;
      const e = esperado(l, f);
      return { ...c, esperado_g: e.g, esperado_und: e.und };
    }));
  }
  const principal = ficha ? [...ficha.lineas].filter((l) => l.base !== null && l.unidad_base !== 'und' && l.tipo !== 'SIN_COSTO').sort((a, b) => b.base! - a.base!)[0] : undefined;

  const poner = (k2: string, cambio: Partial<Consumo>) => setConsumos((cs) => cs.map((c) => (c.clave === k2 ? { ...c, ...cambio } : c)));
  function agregarInsumo(i: Insumo, nota = '', loteOrigen: string | null = null) {
    setConsumos((cs) => [...cs, { clave: crypto.randomUUID(), generico_id: i.generico_id, generico: i.generico, unidad_base: i.unidad_base, producto_id: i.producto_id,
      zona: i.tipo === 'SIN_COSTO' ? '' : proponerZona(i.producto_id), gramos: '', unidades: '',
      factor: i.unidad_base === 'ml' && i.tipo !== 'SIN_COSTO' && i.factor_g === null && i.densidad ? String(Math.round(1000 / i.densidad) / 1000) : '',
      esperado_g: null, esperado_und: null, linea_ficha: null, nota, lote_origen: loteOrigen }]);
    setBuscarInsumo('');
  }
  async function escaneado(texto: string) {
    setEscaneando(false);
    const r = await leerCodigo(texto);
    const id = r.tipo === 'lote' ? r.lote.producto_id : r.tipo === 'producto' ? r.producto.producto_id : null;
    const ins = id ? insumoPorId.get(id) : undefined;
    if (r.tipo === 'lote' && r.lote.anulado) { setLeido({ ok: false, texto: `El lote ${r.lote.codigo} está anulado: no lo uses.` }); return; }
    if (r.tipo === 'lote' && r.lote.vence && r.lote.vence < hoyCali()) { setLeido({ ok: false, texto: `El lote ${r.lote.codigo} de ${r.lote.mpi} venció: no lo uses.` }); return; }
    if (!ins) { setLeido({ ok: false, texto: r.tipo === 'desconocido' ? 'No conozco ese código. Busque el ingrediente por nombre.' : 'Eso no es un ingrediente de esta área.' }); return; }
    const ya = consumos.find((c) => c.generico_id === ins.generico_id);
    if (ya) { poner(ya.clave, { producto_id: ins.producto_id, zona: proponerZona(ins.producto_id), nota: r.tipo === 'lote' ? `lote ${r.lote.codigo}` : ya.nota, lote_origen: r.tipo === 'lote' ? r.lote.id : ya.lote_origen });
              setLeido({ ok: true, texto: `✔ ${ins.generico}: se usa ${r.tipo === 'lote' ? `el lote ${r.lote.codigo}` : 'ese producto'}.` }); return; }
    agregarInsumo(ins, r.tipo === 'lote' ? `lote ${r.lote.codigo}` : '', r.tipo === 'lote' ? r.lote.id : null);
    setLeido({ ok: true, texto: `✔ ${ins.generico} agregado: péselo.` });
  }

  // ---------------------------------------------------------------- cálculos en vivo
  const filas = consumos.map((c) => {
    const ins = c.producto_id ? insumoPorId.get(c.producto_id) : undefined;
    const gr = num(c.gramos), und = num(c.unidades), fac = num(c.factor);
    const sinCosto = ins?.tipo === 'SIN_COSTO';
    const factorG = !ins ? null : ins.unidad_base === 'g' || sinCosto ? 1 : ins.unidad_base === 'ml' ? ins.factor_g ?? (fac && fac > 0 ? fac : null) : null;
    const base = !ins || gr === null || gr <= 0 ? null : ins.unidad_base === 'und' && !sinCosto ? und : factorG !== null ? gr * factorG : null;
    const hay = ins && !sinCosto && c.zona ? saldo(ins.producto_id, c.zona) : 0;
    const falta = !!ins && !sinCosto && base !== null && base > hay + 1e-9;
    const pidefactor = !!ins && !sinCosto && ins.unidad_base === 'ml' && ins.factor_g === null;
    const listo = !!ins && gr !== null && gr > 0 && base !== null && (sinCosto || !!c.zona) && !falta;
    return { c, ins, gr, base, hay, falta, sinCosto, pidefactor, listo };
  });
  const netoG = num(neto);
  const rendFicha = ficha ? rendimientoFicha(ficha.neto_esperado, ficha.lineas.map((l) => l.base)) : null;
  const calc = calcularLote(filas.filter((x) => x.gr && x.base !== null && x.ins).map((x) => ({ gramos: x.gr!, base: x.base!, costoBase: x.ins!.costo_promedio, sinCosto: x.sinCosto })),
                            netoG, rendFicha, datos.umbral_pp);
  const vida = ficha?.almacenamientos.find((a) => a.conservacion === conservacion)?.vida_util_dias ?? null;
  const venceEl = calcularVence(fecha, vida);
  const bloqueados = filas.filter((x) => x.falta).length;
  const pendientesPeso = filas.filter((x) => !x.listo && !x.falta).length;
  const netoBaseFalta = mpi && netoG ? (mpi.unidad_base === 'und' ? !(num(unidades)! > 0) : mpi.unidad_base === 'ml' && mpi.factor_g === null && !(num(netoFactor)! > 0)) : false;
  const listo4 = !!netoG && netoG > 0 && !!responsable && !!destino && !netoBaseFalta;

  // ---------------------------------------------------------------- guardar
  function guardar() {
    if (!mpi) return;
    setResultado(null);
    iniciar(async () => {
      const r = await registrarLote({
        area, fecha, producto_id: mpi.producto_id, ficha_id: ficha?.id ?? null, responsable_id: responsable,
        ubicacion_destino: destino, conservacion: conservacion || null, tandas: k, neto_g: netoG,
        unidades: num(unidades), neto_factor: num(netoFactor), tiempo_min: num(tiempo), observaciones: obs, motivo_forzado: motivo || null, confirmados: envio.confirmados,
        consumos: filas.map(({ c, ins, sinCosto }) => ({ producto_id: c.producto_id, gramos: num(c.gramos), unidades: num(c.unidades),
          factor: ins?.factor_g === null ? num(c.factor) : null, ubicacion: sinCosto ? null : c.zona || null, nota: c.nota || null, lote_origen: c.lote_origen ?? null })),
      }, envio.clave);
      setResultado(r);
      if (r.ok) { avisar({ texto: `Lote guardado · ${r.codigo}`, ver: { href: `/produccion/lotes/${encodeURIComponent(r.codigo ?? '')}`, t: 'Ver lote' } }); try { localStorage.removeItem(clave); } catch { /* nada */ } setPaso(5); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    });
  }
  function empezarDeNuevo() {
    envio.nuevo();
    setMpiId(null); setPaso(1); setTandas('1'); setConsumos([]); setNeto(''); setUnidades(''); setNetoFactor(''); setResponsable(perfilId);
    setDestino(''); setConservacion(''); setTiempo(''); setObs(''); setMotivo(''); setResultado(null); setFecha(hoyCali());
    try { localStorage.removeItem(clave); } catch { /* nada */ }
  }

  // Con ficha sin puntos críticos ni alérgenos (o sin ficha) el paso «Indicaciones» sobra: su aviso
  // sale como banda en el paso de pesos y se ahorra un toque.
  const conIndicaciones = !!ficha && (ficha.puntos.length > 0 || ficha.alergenos.length > 0);
  const pasos = PASOS.map((t, i) => ({ n: i + 1, t })).filter((x) => conIndicaciones || x.n !== 2);
  const pasoVisible = !conIndicaciones && paso === 2 ? 3 : paso;
  const actual = Math.max(0, pasos.findIndex((x) => x.n === pasoVisible));
  const despuesDe1 = conIndicaciones ? 2 : 3;
  // barra fina de avance: cada tramo hecho se toca para volver a ese paso
  const barra = (
    <div className="avance-prod">
      <div className="avance-txt"><strong>{pasos[actual]?.t}</strong><span className="suave">Paso {actual + 1} de {pasos.length}</span></div>
      <ol aria-label="Pasos">
        {pasos.map((x, i) => (
          <li key={x.n} className={i === actual ? 'on' : i < actual ? 'ya' : ''}>
            <button type="button" disabled={!mpi || i >= actual || paso === 5} onClick={() => setPaso(x.n)}
                    aria-label={`Paso ${i + 1}: ${x.t}${i < actual ? ' (hecho, volver)' : i === actual ? ' (actual)' : ''}`} />
          </li>
        ))}
      </ol>
    </div>
  );
  // aviso de borrador de otro día: se decide antes de seguir
  const avisoRetomado = retomado && (
    <div className="aviso retomado" role="alert">
      <span>Retomó un lote empezado el <strong>{fechaCorta(retomado)}</strong>. Quedó con la fecha de hoy, {fechaCorta(hoyCali())}.</span>
      <div className="acciones mt-2">
        <button type="button" onClick={() => setRetomado(null)}>Seguir con este</button>
        <button type="button" className="secundario" onClick={() => { setRetomado(null); empezarDeNuevo(); }}>Empezar de nuevo</button>
      </div>
    </div>
  );

  // ---------------------------------------------------------------- 5. guardado
  if (paso === 5 && resultado?.ok && mpi) {
    const r = resultado;
    return (
      <div className="dos-col pagina-ancha">
        <div className="pila">
          <div className="exito m-0" role="status">
            <strong style={{ fontSize: '1.15rem' }}>Lote {r.codigo} guardado</strong><br />
            {mpi.generico} · {g(r.neto_g ?? netoG)} en {nombreZona(destino)} · {datos.responsables.find((x) => x.id === responsable)?.nombre}
          </div>
          <div className="cifras m-0">
            <div className="cifra"><span>Entrada</span><b>{g(r.entrada_g ?? null)}</b></div>
            <div className="cifra"><span>Merma</span><b>{g(r.merma_g ?? null)}</b></div>
            <div className="cifra"><span>Rendimiento</span><b>{r.rendimiento != null ? `${r2(r.rendimiento * 100)} %` : '—'}</b>
              {r.desvio_pp != null && <small>{r.desvio_pp > 0 ? '+' : ''}{r.desvio_pp} pp vs ficha</small>}</div>
            {vePesos && <div className="cifra"><span>Costo</span><b>{pesos(r.costo_total ?? null)}</b><small>{r.estado_costo === 'PARCIAL' ? 'parcial' : `${pesos(r.costo_gramo ?? null, 2)}/g`}</small></div>}
            <div className="cifra"><span>Vence</span><b>{r.vence ? fechaCorta(r.vence) : '—'}</b>{r.conservacion && <small>{r.conservacion.toLowerCase()}</small>}</div>
          </div>
          {r.avisos.length > 0 && <div className="aviso m-0"><ul className="m-0">{r.avisos.map((m) => <li key={m}>{m}</li>)}</ul></div>}
          <section className="tarjeta">
            <h2 className="sec-tit">Lo que quedó en el kardex</h2>
            <ul className="renglones">
              {filas.map(({ c, ins, base, sinCosto }) => (
                <li key={c.clave}><span><span className={`pill ${sinCosto ? 'gris' : 'error'}`}>{sinCosto ? 'Sin costo' : 'Consumo de producción'}</span> {ins?.generico}{!sinCosto && c.zona ? ` · ${nombreZona(c.zona)}` : ''}</span>
                  <strong className="n">{sinCosto ? <span className="suave">no mueve kardex</span> : `−${fmtCantidad(r2(base ?? 0))} ${ins?.unidad_base}`}</strong></li>
              ))}
              <li><span><span className="pill ok">Entrada de producción</span> {mpi.generico} · {nombreZona(destino)}</span>
                <strong className="n">+{mpi.unidad_base === 'und' ? `${num(unidades)} und` : g(r.neto_g ?? netoG)}</strong></li>
            </ul>
          </section>
        </div>
        <div className="pila">
          <Link className="boton" style={{ minHeight: 60, fontSize: '1.1rem' }} href={`/l/${encodeURIComponent(r.codigo ?? '')}/etiqueta`}><Icono nombre="qr" /> Imprimir etiqueta</Link>
          <button type="button" className="secundario" style={{ minHeight: 56 }} onClick={empezarDeNuevo}>Producir otro</button>
          <Link className="boton secundario" href={`/produccion/lotes/${encodeURIComponent(r.codigo ?? '')}`}>Ver el lote y su trazabilidad</Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- 1. MPI y tanda
  if (!mpi) {
    const ps = sinTildes(buscarMpi.trim()).split(/\s+/).filter(Boolean);
    // lo más reciente primero: lo que se produce seguido queda arriba
    const opciones = datos.mpis.filter((m) => !ps.length || ps.every((w) => sinTildes(`${m.generico} ${m.codigo} ${m.ficha_codigo ?? ''}`).includes(w)))
      .sort((a, b) => (b.ultimo_lote ?? '').localeCompare(a.ultimo_lote ?? '') || a.generico.localeCompare(b.generico, 'es'));
    const deSiempre = ps.length ? [] : opciones.filter((m) => m.ultimo_lote).slice(0, 6);
    const resto = opciones.filter((m) => !deSiempre.includes(m));
    const boton = (m: Mpi) => (
      <button key={m.producto_id} type="button" className="secundario" onClick={() => elegirMpi(m)}>
        <strong>{m.generico}</strong>
        <span>{m.ficha_codigo ? `Ficha ${m.ficha_codigo}` : 'Sin ficha'}{m.ultimo_lote ? ` · último ${fechaCorta(m.ultimo_lote)}` : ''}</span>
      </button>
    );
    return (
      <>
        <input className="buscar-grande" aria-label="Buscar MPI" placeholder="¿Qué va a producir? Sirope, zumo, #5…" value={buscarMpi} onChange={(e) => setBuscarMpi(e.target.value)} />
        {deSiempre.length > 0 && (
          <>
            <h2 className="sec-tit">Lo de siempre</h2>
            <div className="rejilla-mpi mb-3">{deSiempre.map(boton)}</div>
            <h2 className="sec-tit">Todas</h2>
          </>
        )}
        <div className="rejilla-mpi">{resto.slice(0, 40).map(boton)}</div>
        {!opciones.length && <p className="suave">Nada coincide.</p>}
        {resto.length > 40 && <p className="suave">Hay {opciones.length}: escriba para buscar.</p>}
      </>
    );
  }

  const cabecera = (
    // una sola línea con lo que se produce; marca la pantalla para ocultar pestañas y título (CSS :has)
    <div className="cab-mpi producir-con-mpi">
      <div className="min-0">
        <strong>{mpi.generico}</strong>
        <span className="suave">{ficha ? `Ficha ${ficha.codigo} v${ficha.version}` : 'Sin ficha técnica'} · ×{fmtCantidad(k)}</span>
      </div>
      <button type="button" className="discreto chico" onClick={async () => {
        if (consumos.some((c) => c.gramos) && !(await confirmar('¿Cambiar de producto? Se pierden los pesos escritos.', { aceptar: 'Cambiar' }))) return;
        empezarDeNuevo();
      }}>Cambiar</button>
    </div>
  );

  if (paso === 1) {
    return (
      <>
        {cabecera}{barra}{avisoRetomado}
        <div className="dos-col pagina-ancha">
          <section className="tarjeta">
            <h2 className="sec-tit">¿Cuánto va a hacer?</h2>
            <div className="tandas">
              {[0.5, 1, 1.5, 2].map((t) => (
                <button key={t} type="button" aria-pressed={k === t} onClick={() => cambiarTandas(String(t))}>×{fmtCantidad(t)}</button>
              ))}
            </div>
            <div className="fila mt-1">
              <div>
                <label htmlFor="tandas">Tandas de la ficha</label>
                <input id="tandas" inputMode="decimal" value={tandas} onChange={(e) => cambiarTandas(e.target.value)} />
              </div>
              {principal && ficha && (
                <div>
                  <label htmlFor="principal">o según el {principal.generico.toLowerCase()} que tiene (g)</label>
                  <input id="principal" inputMode="decimal" placeholder={fmtCantidad(principal.base!)}
                         onChange={(e) => { const v = num(e.target.value); if (v && v > 0) cambiarTandas(String(Math.round((v / principal.base!) * 1000) / 1000)); }} />
                </div>
              )}
            </div>
            <label htmlFor="fecha">Fecha</label>
            <input id="fecha" type="date" max={hoyCali()} value={fecha} onChange={(e) => setFecha(e.target.value)} style={{ maxWidth: 220 }} />
          </section>
          <section className="tarjeta">
            <h2 className="sec-tit">Esperado para ×{fmtCantidad(k)}</h2>
            {ficha ? (
              <ul className="renglones">
                {consumos.filter((c) => c.linea_ficha !== null).map((c) => (
                  <li key={c.clave}><span>{c.generico}</span><strong className="n">{c.esperado_und !== null ? `${fmtCantidad(c.esperado_und)} und` : g(c.esperado_g)}</strong></li>
                ))}
                {ficha.neto_esperado && <li><span>Neto esperado</span><strong className="n">{mpi.unidad_base === 'g' ? g(ficha.neto_esperado * k) : `${fmtCantidad(r2(ficha.neto_esperado * k))} ${mpi.unidad_base}`}</strong></li>}
              </ul>
            ) : <div className="vacio">{mpi.generico} no tiene ficha técnica: en el paso de pesos agregas los ingredientes a mano. <Link href={`/fichas/${mpi.generico_id}`}>Ver o crear la ficha</Link></div>}
          </section>
        </div>
        <div className="barra-accion">
          <button type="button" className="principal" disabled={!(k > 0) || !!retomado} onClick={() => setPaso(despuesDe1)}>Seguir</button>
        </div>
      </>
    );
  }

  // ---------------------------------------------------------------- 2. indicaciones
  if (paso === 2 && conIndicaciones) {
    return (
      <>
        {cabecera}{barra}{avisoRetomado}
        <section className="tarjeta" style={{ maxWidth: 760 }}>
          <h2 className="mt-0">Indicaciones importantes</h2>
          {!ficha ? (
            <div className="aviso m-0"><strong>Sin ficha técnica</strong><div>No hay indicaciones registradas para {mpi.generico}.</div></div>
          ) : ficha.puntos.length === 0 ? (
            <div className="aviso" style={{ margin: 0, fontSize: '1.05rem' }}><strong>Ficha sin puntos críticos</strong>
              <div>Esta ficha no tiene temperaturas, tiempos ni cuidados de higiene registrados. Avísele al {area === 'BAR' ? 'jefe de barra' : 'chef'} para que los complete.</div></div>
          ) : (
            <div>{ficha.puntos.map((p, i) => (
              <div key={i} className="punto" style={{ fontSize: '1.08rem' }}><span className={`pill ${tipoPunto(p.tipo).c}`}>{tipoPunto(p.tipo).t}</span><span>{p.texto}</span></div>
            ))}</div>
          )}
          {ficha && (
            <div className="punto" style={{ fontSize: '1.05rem' }}><span className="pill aviso">Alérgenos</span>
              <span>{ficha.alergenos.length ? ficha.alergenos.join(', ') : <span className="suave">Ninguno declarado</span>}</span></div>
          )}
        </section>
        <div className="barra-accion">
          <button type="button" className="secundario" onClick={() => setPaso(1)}>Atrás</button>
          <button type="button" className="principal" disabled={!!retomado} onClick={() => setPaso(3)}>Entendido, empezar</button>
        </div>
      </>
    );
  }

  // ---------------------------------------------------------------- 3. pesos reales
  if (paso === 3 || paso === 2) {
    const ps = sinTildes(buscarInsumo.trim()).split(/\s+/).filter(Boolean);
    const opcionesInsumo = buscarInsumo.trim().length < 2 ? [] : datos.insumos.filter((i) => i.producto_id !== mpiId && ps.every((w) => sinTildes(`${i.generico} ${i.marca} ${i.presentacion} ${i.codigo}`).includes(w))).slice(0, 8);
    return (
      <>
        {cabecera}{barra}{avisoRetomado}
        {!conIndicaciones && (
          <p className="aviso banda-prod">
            <strong>{ficha ? 'Ficha sin puntos críticos.' : 'Sin ficha técnica.'}</strong>{' '}
            {ficha ? `No tiene temperaturas, tiempos ni cuidados de higiene registrados. Avísele al ${area === 'BAR' ? 'jefe de barra' : 'chef'} para que los complete.`
              : `No hay indicaciones registradas para ${mpi.generico}.`}
          </p>
        )}
        <section className="tarjeta pagina-ancha">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '.6rem', flexWrap: 'wrap' }}>
            <h2 className="m-0">Pese cada ingrediente</h2>
            <span className="suave">Entrada: <strong style={{ color: 'var(--texto)', fontSize: '1.25rem' }}>{g(calc.entrada)}</strong></span>
          </div>
          {filas.map(({ c, ins, gr, hay, falta, sinCosto, pidefactor, base }) => {
            const opciones = datos.insumos.filter((i) => i.generico_id === c.generico_id);
            const otrasZonas = ins && falta ? zonas.filter((z) => z.codigo !== c.zona && saldo(ins.producto_id, z.codigo) >= (base ?? 0)) : [];
            const otrosProductos = falta ? opciones.filter((o) => o.producto_id !== c.producto_id && saldoTotal(o.producto_id) >= (base ?? 0)) : [];
            return (
              <div key={c.clave} className={`ing-prod${falta ? ' mal' : ''}`}>
                <div className="min-0">
                  <strong style={{ fontSize: '1.08rem' }}>{c.generico}</strong>
                  <div className="suave texto-nota">
                    {c.linea_ficha !== null ? <>Ficha: {c.esperado_und !== null ? `${fmtCantidad(c.esperado_und)} und` : g(c.esperado_g)}</> : 'Agregado'}
                    {c.nota && <> · {c.nota}</>}
                  </div>
                  <details className="menu-mas">
                    <summary aria-label={`Más opciones de ${c.generico}`}>⋯</summary>
                    <button type="button" className="secundario peligro chico" onClick={async () => {
                      if (await confirmar(`¿Quitar ${c.generico} de este lote?`, { aceptar: 'Quitar', peligro: true })) setConsumos((cs) => cs.filter((x) => x.clave !== c.clave));
                    }}>Quitar ingrediente</button>
                  </details>
                </div>
                <div style={{ display: 'grid', gap: '.35rem', minWidth: 0 }}>
                  {opciones.length > 1 ? (
                    <select aria-label={`Producto de ${c.generico}`} value={c.producto_id ?? ''} onChange={(e) => poner(c.clave, { producto_id: e.target.value, zona: proponerZona(e.target.value) })}>
                      {opciones.map((o) => <option key={o.producto_id} value={o.producto_id}>{[o.marca, o.presentacion].filter(Boolean).join(' · ') || o.codigo} — hay {fmtCantidad(r2(saldoTotal(o.producto_id)))} {o.unidad_base}</option>)}
                    </select>
                  ) : !opciones.length ? <span className="error" style={{ margin: 0, padding: '.3rem .5rem' }}>No tiene producto en el catálogo.</span>
                    : <span className="suave texto-nota">{[opciones[0].marca, opciones[0].presentacion].filter(Boolean).join(' · ') || opciones[0].codigo}</span>}
                  {ins && !sinCosto && (
                    <select aria-label={`Zona de ${c.generico}`} value={c.zona} onChange={(e) => poner(c.clave, { zona: e.target.value })}>
                      <option value="">— ¿De dónde lo coges? —</option>
                      {zonas.map((z) => { const q = saldo(ins.producto_id, z.codigo); return <option key={z.codigo} value={z.codigo}>{z.nombre}{q ? ` — hay ${fmtCantidad(r2(q))} ${ins.unidad_base}` : ''}</option>; })}
                    </select>
                  )}
                  {ins && <span className="suave texto-nota">
                    {sinCosto ? 'Sin costo: no mueve kardex' : <>Hay <strong>{fmtCantidad(r2(hay))} {ins.unidad_base}</strong>{c.zona ? ` en ${nombreZona(c.zona)}` : ''}{ins.costo_promedio !== null ? ` · ${pesos(ins.costo_promedio)}/${ins.unidad_base}` : ' · sin costo en el kardex'}</>}
                  </span>}
                </div>
                <div style={{ display: 'grid', gap: '.35rem' }}>
                  {/* vacío se ve vacío: lo esperado va pequeño y tenue, para no confundirlo con un peso escrito */}
                  <label className={`peso-grande${llenado === c.clave ? ' recien' : ''}`}>
                    <input inputMode="decimal" value={c.gramos} aria-label={`Peso real de ${c.generico} en gramos`}
                           placeholder={c.esperado_g !== null ? `esperado ${fmtCantidad(Math.round(c.esperado_g))}` : 'pese aquí'}
                           onChange={(e) => poner(c.clave, { gramos: e.target.value })} />
                    <span>g</span>
                  </label>
                  {c.esperado_g !== null && !gr && <button type="button" className="secundario mini" onClick={() => {
                    poner(c.clave, { gramos: String(Math.round(c.esperado_g!)) });
                    setLlenado(c.clave); setTimeout(() => setLlenado((x) => (x === c.clave ? null : x)), 900);
                  }}>Pesé {fmtCantidad(Math.round(c.esperado_g))} g</button>}
                  {ins?.unidad_base === 'und' && !sinCosto && (
                    <label className="campo">¿Cuántas unidades?
                      <input inputMode="decimal" value={c.unidades} onChange={(e) => poner(c.clave, { unidades: e.target.value })} placeholder={c.esperado_und !== null ? String(c.esperado_und) : ''} />
                    </label>
                  )}
                  {pidefactor && (
                    <label style={{ margin: 0, fontWeight: 400, fontSize: '.82rem' }}>1 g = ¿cuántos ml? <span className="suave">(se guarda una vez)</span>
                      <input inputMode="decimal" value={c.factor} onChange={(e) => poner(c.clave, { factor: e.target.value })} />
                    </label>
                  )}
                </div>
                {falta && ins && (
                  <div className="error bloqueo-prod" role="alert">
                    <strong>No alcanza: {c.zona ? `en ${nombreZona(c.zona)} ` : ''}hay {fmtCantidad(r2(hay))} {ins.unidad_base} y necesita {fmtCantidad(r2(base ?? 0))}.</strong>{' '}
                    {otrasZonas.length > 0 && <>Hay suficiente en {otrasZonas.map((z) => <button key={z.codigo} type="button" className="secundario mini" onClick={() => poner(c.clave, { zona: z.codigo })}>{z.nombre}</button>)} </>}
                    {otrosProductos.length > 0 && <>O use {otrosProductos.map((o) => <button key={o.producto_id} type="button" className="secundario mini" onClick={() => poner(c.clave, { producto_id: o.producto_id, zona: proponerZona(o.producto_id) })}>{[o.marca, o.presentacion].filter(Boolean).join(' · ') || o.codigo}</button>)} </>}
                    {!otrasZonas.length && !otrosProductos.length && <>Registre primero la <Link href="/recibir">recepción</Link> o el <Link href="/trasladar">traslado</Link>.</>}
                  </div>
                )}
              </div>
            );
          })}
          {!consumos.length && <div className="vacio">Agregue los ingredientes que va a usar.</div>}
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginTop: '1rem', flexWrap: 'wrap' }}>
            <input placeholder="Agregar otro ingrediente…" value={buscarInsumo} onChange={(e) => setBuscarInsumo(e.target.value)} style={{ flex: '1 1 240px' }} aria-label="Buscar ingrediente" />
            <button type="button" className="secundario" onClick={() => { setLeido(null); setEscaneando(true); }}><Icono nombre="escanear" /> Escanear lote</button>
          </div>
          {leido && <p className={leido.ok ? 'exito' : 'aviso'} style={{ margin: '.4rem 0', padding: '.4rem .6rem' }}>{leido.texto}</p>}
          {escaneando && <Escaner titulo="Escanear lote o producto" onCerrar={() => setEscaneando(false)} onCodigo={escaneado} />}
          {opcionesInsumo.length > 0 && (
            <ul className="lista mt-1">
              {opcionesInsumo.map((i) => (
                <li className="p-0" key={i.producto_id}>
                  <button type="button" className="secundario opcion-lista" onClick={() => agregarInsumo(i)}>
                    <strong>{i.generico}</strong>&nbsp;<span className="suave">· {[i.marca, i.presentacion].filter(Boolean).join(' · ')} · hay {fmtCantidad(r2(saldoTotal(i.producto_id)))} {i.unidad_base}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="barra-accion">
          <div className="resumen-vivo" role="status">
            Entrada <b>{g(calc.entrada)}</b>{consumos.reduce((t, c) => t + (c.esperado_g ?? 0), 0) > 0 && <> de <b>{g(consumos.reduce((t, c) => t + (c.esperado_g ?? 0), 0))}</b> en la ficha</>}
            {pendientesPeso > 0 && <> · faltan {pendientesPeso}</>}
          </div>
          <button type="button" className="secundario" onClick={() => setPaso(conIndicaciones ? 2 : 1)}>Atrás</button>
          <button type="button" className="principal" disabled={!consumos.length || bloqueados > 0 || pendientesPeso > 0 || !!retomado} onClick={() => setPaso(4)}>
            {bloqueados ? `Resuelva ${bloqueados} ingrediente(s) en rojo` : pendientesPeso ? `Falta pesar ${pendientesPeso}` : 'Seguir al neto'}
          </button>
        </div>
      </>
    );
  }

  // ---------------------------------------------------------------- 4. neto y responsable
  const resultadoMalo = resultado && !resultado.ok;
  const pideMotivo = resultadoMalo && !resultado.fatales.length && resultado.bloqueos.length > 0;
  return (
    <>
      {cabecera}{barra}{avisoRetomado}
      <div className="dos-col pagina-ancha">
        <div className="pila">
          <section className="tarjeta">
            <h2 className="sec-tit">Neto obtenido · pesado al final, sin recipiente</h2>
            <label className="peso-grande" style={{ maxWidth: 320 }}>
              <input inputMode="decimal" value={neto} onChange={(e) => setNeto(e.target.value)} aria-label="Neto obtenido en gramos"
                     placeholder={ficha?.neto_esperado && mpi.unidad_base === 'g' ? `esperado ${fmtCantidad(Math.round(ficha.neto_esperado * k))}` : 'pese aquí'} />
              <span>g</span>
            </label>
            {mpi.unidad_base === 'und' && (
              <label>¿Cuántas unidades salieron?<input inputMode="decimal" value={unidades} onChange={(e) => setUnidades(e.target.value)} style={{ maxWidth: 200 }} /></label>
            )}
            {mpi.unidad_base === 'ml' && mpi.factor_g === null && (
              <label>{mpi.generico} se lleva en ml: 1 g = ¿cuántos ml?<input inputMode="decimal" value={netoFactor} onChange={(e) => setNetoFactor(e.target.value)} style={{ maxWidth: 200 }} /></label>
            )}
          </section>
          {ficha && (ficha.presentaciones?.length ?? 0) > 0 && (() => {
            const ps = ficha.presentaciones!;
            const ubm = mpi.unidad_base;
            const enGramos = ubm === 'g';
            const usado = ps.reduce((t, p, i) => t + (p.contenido ?? 0) * (num(empacadas[i] ?? '') ?? 0), 0);
            const hayConteo = ps.some((p, i) => p.contenido && num(empacadas[i] ?? ''));
            return (
              <section className="tarjeta">
                <h2 className="sec-tit">Cómo se empaca{ficha.empaque ? ` · ${ficha.empaque}` : ''}</h2>
                <ul className="renglones">
                  {ps.map((p, i) => (
                    <li key={i}>
                      <span className="min-0">
                        <strong>{textoPresentacion(p, ubm)}</strong>
                        <span className="suave bloque texto-mini">
                          {p.por_tanda ? `${cant(p.por_tanda * k)} por ${k === 1 ? 'tanda' : `${cant(k)} tandas`}` : 'las que convengan'}
                          {p.empaque ? ` · ${p.empaque}` : ''}
                          {enGramos && p.contenido && netoG ? ` · el neto alcanza para ${Math.floor(netoG / p.contenido)}` : ''}
                        </span>
                      </span>
                      {enGramos && p.contenido !== null && (
                        <input inputMode="numeric" value={empacadas[i] ?? ''} placeholder="cuántas" aria-label={`Cuántas de ${textoPresentacion(p, ubm)}`}
                               onChange={(e) => setEmpacadas((x) => ({ ...x, [i]: e.target.value }))} style={{ maxWidth: 90 }} />
                      )}
                    </li>
                  ))}
                </ul>
                {hayConteo && enGramos && (
                  <p className={netoG && usado > netoG ? 'aviso' : 'suave'} style={{ fontSize: '.85rem', margin: '.4rem 0 0' }}>
                    Empacado: {fmtCantidad(usado)} g{netoG ? ` de ${fmtCantidad(netoG)} g · ${usado > netoG ? `faltan ${fmtCantidad(usado - netoG)} g` : `sobran ${fmtCantidad(netoG - usado)} g`}` : ''}
                  </p>
                )}
                {enGramos && ps.some((p) => p.contenido !== null) && (
                  <p className="ayuda" style={{ margin: '.3rem 0 0' }}>Anote cuántas de cada una para repartir el neto; no se guarda con el lote.</p>
                )}
              </section>
            );
          })()}
          <section className="tarjeta">
            <h2 className="sec-tit">Responsable</h2>
            <div className="resp-prod">
              {datos.responsables.map((p) => (
                <button key={p.id} type="button" aria-pressed={responsable === p.id} onClick={() => setResponsable(p.id)}>{p.nombre}</button>
              ))}
            </div>
          </section>
          <section className="tarjeta">
            <h2 className="sec-tit">Dónde queda guardado</h2>
            {destino && !cambiarDestino && (conservacion || !ficha?.almacenamientos.length) ? (
              <div className="destino-propuesto">
                <span>
                  <strong>Queda en {nombreZona(destino)}</strong>
                  <small className="suave bloque">{conservacion ? `${conservacion}${vida ? ` · ${vida} d` : ''}` : 'Sin vida útil en la ficha'}{venceEl ? ` · vence ${fechaCorta(venceEl)}` : ''}</small>
                </span>
                <button type="button" className="discreto chico" onClick={() => setCambiarDestino(true)}>Cambiar</button>
              </div>
            ) : (<>
            <select aria-label="Zona donde queda" value={destino} onChange={(e) => {
              setDestino(e.target.value);
              const c = conservacionDeZona(nombreZona(e.target.value));
              if (c && ficha?.almacenamientos.some((a) => a.conservacion === c)) setConservacion(c);
            }}>
              <option value="">— Zona —</option>
              {zonas.map((z) => <option key={z.codigo} value={z.codigo}>{z.nombre}{zonaDe[mpi.producto_id] === z.codigo ? ' · su lugar' : ''}</option>)}
            </select>
            {ficha && ficha.almacenamientos.length > 0 ? (
              <div className="chips-sel mt-2">
                {ficha.almacenamientos.map((a) => (
                  <button key={a.conservacion} type="button" aria-pressed={conservacion === a.conservacion} onClick={() => setConservacion(a.conservacion)}>
                    {a.conservacion} · {a.vida_util_dias} d{a.nota ? ` · ${a.nota}` : ''}</button>
                ))}
              </div>
            ) : <p className="suave" style={{ fontSize: '.85rem', marginBottom: 0 }}>La ficha no tiene vida útil: el lote quedará sin fecha de vencimiento.</p>}
            </>)}
          </section>
          <details className="tarjeta">
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Tiempo y observaciones (opcional)</summary>
            <label htmlFor="min">Tiempo (min)</label>
            <input id="min" inputMode="decimal" value={tiempo} onChange={(e) => setTiempo(e.target.value)} style={{ maxWidth: 160 }} />
            <label htmlFor="obs">Observaciones</label>
            <textarea id="obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
          </details>
        </div>
        <div className="pila">
          <div className="cifras m-0">
            <div className="cifra"><span>Entrada</span><b>{g(calc.entrada)}</b></div>
            <div className="cifra"><span>Merma proceso</span><b>{g(calc.merma)}</b></div>
            <div className="cifra"><span>Rendimiento</span><b>{calc.rendimiento !== null ? `${r2(calc.rendimiento * 100)} %` : '—'}</b>{rendFicha && <small>ficha {r2(rendFicha * 100)} %</small>}</div>
            <div className={`cifra${calc.alerta ? ' alerta' : ''}`}><span>Desvío</span><b>{calc.desvioPp !== null ? `${calc.desvioPp > 0 ? '+' : ''}${calc.desvioPp} pp` : '—'}</b>
              {calc.desvioPp !== null && <small>{calc.alerta ? `más de ±${datos.umbral_pp} pp` : `dentro de ±${datos.umbral_pp} pp`}</small>}</div>
            {vePesos && <div className="cifra"><span>Costo lote</span><b>{pesos(calc.costo)}</b>{calc.estado === 'PARCIAL' && <small>parcial</small>}</div>}
            {vePesos && <div className="cifra"><span>$/g</span><b>{pesos(calc.costoGramo, 2)}</b></div>}
            <div className="cifra"><span>Vence</span><b>{venceEl ? fechaCorta(venceEl) : '—'}</b>{vida && <small>+{vida} d {conservacion.toLowerCase()}</small>}</div>
          </div>
          {calc.alerta && <div className="aviso m-0"><strong>Rendimiento fuera de lo esperado.</strong> Revise los pesos; si están bien, guarde y anote qué pasó en observaciones.</div>}
          {vePesos && calc.estado === 'PARCIAL' && <div className="aviso m-0">Algún insumo no tiene costo en el kardex: el lote quedará con costo parcial.</div>}
          {resultadoMalo && !!resultado.revisar?.length && (
            <Revisiones resultado={resultado} confirmados={envio.confirmados} setConfirmados={envio.setConfirmados} />
          )}
          {resultadoMalo && !resultado.revisar?.length && (
            <div className="error m-0" role="alert"><strong>No se guardó:</strong>
              <ul className="m-0">{[...resultado.fatales, ...resultado.bloqueos].map((m) => <li key={m}>{m}</li>)}</ul></div>
          )}
          {pideMotivo && (
            <label className="m-0">Motivo para guardar igual
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Qué pasó (mínimo 15 letras)" />
            </label>
          )}
        </div>
      </div>
      <div className="barra-accion">
        <div className="resumen-vivo" role="status">
          Rendimiento <b>{calc.rendimiento !== null ? `${r2(calc.rendimiento * 100)} %` : '—'}</b>{rendFicha && <> · ficha {r2(rendFicha * 100)} %</>}
          {calc.desvioPp !== null && (calc.alerta ? <Insignia tono="aviso">Fuera de rango</Insignia> : <Insignia tono="ok">En rango</Insignia>)}
        </div>
        <button type="button" className="secundario" onClick={() => setPaso(3)}>Atrás</button>
        <button aria-busy={enviando} type="button" className="principal" disabled={!listo4 || enviando || !!retomado} onClick={guardar}>
          {enviando ? 'Guardando…' : !netoG ? 'Falta el neto' : !destino ? 'Falta dónde queda' : netoBaseFalta ? 'Complete el neto' : 'Guardar lote'}
        </button>
      </div>
    </>
  );
}
