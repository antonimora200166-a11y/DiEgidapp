'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { fmtCantidad } from '@/lib/catalogo';
import { costoLote } from '@/lib/costo';
import type { Area } from '@/lib/roles';
import { registrarLote, type ResultadoLote } from './acciones';
import { confirmar } from '@/components/Dialogo';
import Escaner from '@/components/Escaner';
import Icono from '@/components/Icono';
import { leerCodigo } from '@/lib/escaneo';

type UnidadBase = 'g' | 'ml' | 'und';
export type Mpi = {
  producto_id: string; codigo: string; generico_id: string; generico: string; marca: string; presentacion: string;
  unidad_base: UnidadBase; costo_promedio: number | null; ficha_id: string | null; ficha_codigo: string | null; ultimo_lote: string | null;
};
type FichaLinea = {
  linea: number; generico_id: string; generico: string; tipo: string; unidad_base: UnidadBase;
  cantidad: number | null; unidad: string; nota: string | null; factor: number | null;
};
type Ficha = { id: string; codigo: string; version: number; neto_esperado: number | null; nota: string | null; lineas: FichaLinea[] };
type Insumo = {
  producto_id: string; codigo: string; generico_id: string; generico: string; marca: string; presentacion: string;
  tipo: string; unidad_base: UnidadBase; costo_promedio: number | null;
};
export type DatosProduccion = { mpis: Mpi[]; fichas: Ficha[]; insumos: Insumo[]; saldos: { producto_id: string; ubicacion: string; cantidad: number }[] };

// Una línea de consumo. La cantidad va como texto para no perder lo que la persona teclea.
type Consumo = {
  clave: string; generico_id: string; generico: string; unidad_base: UnidadBase; producto_id: string | null;
  cantidad: string; unidad: string; unidad_ficha: string | null; factor_ficha: number | null;
  linea_ficha: number | null; editada: boolean; nota: string;
  merma?: string;   // lo que se botó de esa cantidad (cáscara, semillas, colado), en la misma unidad
  zona?: string;    // de dónde se cogió (código de ubicación); lo SIN_COSTO no la necesita
};

const hoyCali = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const num = (s: string) => { const n = Number(s.replace(',', '.')); return s.trim() === '' || !Number.isFinite(n) ? null : n; };
const pesos = (n: number, dec = 0) => n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: dec, minimumFractionDigits: dec });
const pesosU = (n: number) => pesos(n, n < 100 ? 2 : 0);
const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

// Factor de la unidad elegida a la unidad base del genérico (null = falta la conversión)
function factor(c: Consumo, u: string): number | null {
  if (u === c.unidad_ficha) return c.factor_ficha;
  if (u === c.unidad_base) return 1;
  if ((u === 'kg' && c.unidad_base === 'g') || (u === 'l' && c.unidad_base === 'ml')) return 1000;
  return null;
}
const unidadesDe = (c: Consumo) => [...new Set([c.unidad_ficha, c.unidad_base, c.unidad_base === 'g' ? 'kg' : c.unidad_base === 'ml' ? 'l' : null]
  .filter((u): u is string => !!u))];

export default function Producir({ area, datos, zonas, zonaDe, generico }: {
  area: Area; datos: DatosProduccion; zonas: { codigo: string; nombre: string }[];
  zonaDe: Record<string, string>;   // la zona asignada a cada producto en el mapa del área
  generico?: string;                // «Producir esta ficha»: llega con la MPI elegida
}) {
  const insumoPorId = useMemo(() => new Map(datos.insumos.map((i) => [i.producto_id, i])), [datos.insumos]);
  const fichaPorId = useMemo(() => new Map(datos.fichas.map((f) => [f.id, f])), [datos.fichas]);
  const saldo = (producto: string, zona: string) =>
    datos.saldos.filter((s) => s.producto_id === producto && s.ubicacion === zona).reduce((t, s) => t + Number(s.cantidad), 0);
  const saldoTotal = (producto: string) => datos.saldos.filter((s) => s.producto_id === producto).reduce((t, s) => t + Number(s.cantidad), 0);
  const nombreZona = (z: string) => zonas.find((x) => x.codigo === z)?.nombre ?? z;
  // De dónde se propone coger un producto: la zona donde el kardex tiene más; si en ninguna hay, la del mapa
  function proponerZona(producto: string | null): string {
    if (!producto) return '';
    const conSaldo = zonas.map((z) => ({ z: z.codigo, q: saldo(producto, z.codigo) })).filter((x) => x.q > 0).sort((a, b) => b.q - a.q);
    return conSaldo[0]?.z ?? zonaDe[producto] ?? (zonas.length === 1 ? zonas[0].codigo : '');
  }

  const [mpiId, setMpiId] = useState<string | null>(null);
  const [destino, setDestino] = useState('');      // dónde queda guardado lo producido
  const [guardado, setGuardado] = useState(false);  // la persona confirma que lo dejó ahí
  const [fecha, setFecha] = useState(hoyCali());
  const [tandas, setTandas] = useState('1');
  const [consumos, setConsumos] = useState<Consumo[]>([]);
  const [neto, setNeto] = useState('');
  const [unidades, setUnidades] = useState('');
  const [tiempo, setTiempo] = useState('');
  const [obs, setObs] = useState('');
  const [motivo, setMotivo] = useState('');
  const [buscarMpi, setBuscarMpi] = useState('');
  const [buscarInsumo, setBuscarInsumo] = useState('');
  const [resultado, setResultado] = useState<ResultadoLote | null>(null);
  const [enviando, iniciar] = useTransition();
  const [escaneando, setEscaneando] = useState(false);
  const [leido, setLeido] = useState<{ ok: boolean; texto: string } | null>(null);

  const mpi = mpiId ? datos.mpis.find((m) => m.producto_id === mpiId) ?? null : null;
  const ficha = mpi?.ficha_id ? fichaPorId.get(mpi.ficha_id) ?? null : null;

  // borrador en este equipo, por área
  const clave = `sgi-producir:${area}`;
  const [cargado, setCargado] = useState(false);
  useEffect(() => {
    try {
      const b = JSON.parse(localStorage.getItem(clave) || 'null');
      if (b) {
        const valida = (z?: string) => (z && zonas.some((x) => x.codigo === z) ? z : '');
        setMpiId(b.mpiId); setTandas(b.tandas); setNeto(b.neto); setUnidades(b.unidades); setTiempo(b.tiempo); setObs(b.obs);
        // un borrador de antes traía una sola zona para todo: pasa a cada ingrediente
        setConsumos((b.consumos ?? []).map((c: Consumo) => ({ ...c, zona: valida(c.zona) || valida(b.zona) })));
        setDestino(valida(b.destino) || (b.mpiId ? valida(zonaDe[b.mpiId]) : ''));
      }
    } catch { /* borrador dañado: se empieza de cero */ }
    setCargado(true);
  }, [clave, zonas, zonaDe]);
  useEffect(() => {
    if (!cargado) return;
    try {
      if (mpiId) localStorage.setItem(clave, JSON.stringify({ mpiId, destino, tandas, consumos, neto, unidades, tiempo, obs }));
    } catch { /* sin almacenamiento */ }
  }, [clave, cargado, mpiId, destino, tandas, consumos, neto, unidades, tiempo, obs]);

  // El producto que se propone para un genérico: el que tiene más saldo en el área
  function proponer(generico_id: string): string | null {
    const lista = datos.insumos.filter((i) => i.generico_id === generico_id);
    if (!lista.length) return null;
    return [...lista].sort((a, b) => saldoTotal(b.producto_id) - saldoTotal(a.producto_id))[0].producto_id;
  }

  function desdeFicha(f: Ficha, k: number): Consumo[] {
    return f.lineas.map((l) => {
      const producto_id = proponer(l.generico_id);
      return {
        clave: crypto.randomUUID(), generico_id: l.generico_id, generico: l.generico, unidad_base: l.unidad_base,
        producto_id, cantidad: l.cantidad === null ? '' : String(r4(l.cantidad * k)), zona: proponerZona(producto_id),
        unidad: l.unidad, unidad_ficha: l.unidad, factor_ficha: l.factor, linea_ficha: l.linea, editada: false, nota: l.nota ?? '',
      };
    });
  }

  function elegirMpi(m: Mpi) {
    setMpiId(m.producto_id);
    setBuscarMpi('');
    setResultado(null);
    setTandas('1');
    setDestino(zonaDe[m.producto_id] ?? (zonas.length === 1 ? zonas[0].codigo : ''));
    setGuardado(false);
    const f = m.ficha_id ? fichaPorId.get(m.ficha_id) : null;
    setConsumos(f ? desdeFicha(f, 1) : []);
  }

  // «Producir esta ficha»: elige la MPI que llegó, salvo que el borrador ya sea de esa misma
  useEffect(() => {
    if (!cargado || !generico) return;
    const m = datos.mpis.find((x) => x.generico_id === generico);
    if (m && (!mpiId || datos.mpis.find((x) => x.producto_id === mpiId)?.generico_id !== generico)) elegirMpi(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargado, generico]);

  // cambiar las tandas reescala las líneas de la ficha que nadie ha tocado
  function cambiarTandas(t: string) {
    setTandas(t);
    const k = num(t);
    if (!ficha || k === null || k <= 0) return;
    setConsumos((cs) => cs.map((c) => {
      if (c.editada || c.linea_ficha === null) return c;
      const l = ficha.lineas.find((x) => x.linea === c.linea_ficha);
      return l && l.cantidad !== null ? { ...c, cantidad: String(r4(l.cantidad * k)) } : c;
    }));
  }

  const poner = (k: string, cambio: Partial<Consumo>) => setConsumos((cs) => cs.map((c) => (c.clave === k ? { ...c, ...cambio } : c)));

  function agregarInsumo(i: Insumo) {
    setConsumos((cs) => [...cs, {
      clave: crypto.randomUUID(), generico_id: i.generico_id, generico: i.generico, unidad_base: i.unidad_base, producto_id: i.producto_id,
      zona: proponerZona(i.producto_id), cantidad: '', unidad: i.unidad_base, unidad_ficha: null, factor_ficha: null, linea_ficha: null, editada: true, nota: '' }]);
    setBuscarInsumo('');
  }

  // ---------------------------------------------------------------- cálculos
  const filas = consumos.map((c) => {
    const ins = c.producto_id ? insumoPorId.get(c.producto_id) : undefined;
    const q = num(c.cantidad), f = factor(c, c.unidad);
    const base = q !== null && f !== null ? q * f : null;
    const m = num(c.merma ?? '');
    const mermaBase = m !== null && f !== null ? m * f : null;
    const mermaMala = m !== null && (m < 0 || (q !== null && m > q));
    const sinCosto = ins?.tipo === 'SIN_COSTO';
    const hay = c.producto_id && c.zona ? saldo(c.producto_id, c.zona) : 0;
    return { c, ins, q, f, base, mermaBase, mermaMala, hay, sinCosto, sinZona: !!ins && !sinCosto && !c.zona,
             falta: !!c.zona && !sinCosto && base !== null && base > hay };
  });
  const netoN = num(neto);
  const k = num(tandas) ?? 1;
  const listas = filas.filter((x) => x.base !== null && x.base > 0 && x.ins);
  const costo = costoLote(listas.map((x) => ({ base: x.base!, costoPromedio: x.ins!.costo_promedio, sinCosto: x.sinCosto })), netoN);
  const fichaBase = ficha && ficha.lineas.every((l) => l.cantidad !== null && l.factor !== null)
    ? ficha.lineas.reduce((t, l) => t + l.cantidad! * l.factor!, 0) : null;
  const rendFicha = ficha?.neto_esperado && fichaBase ? ficha.neto_esperado / fichaBase : null;
  const incompletas = filas.filter((x) => !x.c.producto_id || x.q === null || x.q <= 0).length;
  const sinConversion = filas.filter((x) => x.q !== null && x.f === null).length;
  const mermasMalas = filas.filter((x) => x.mermaMala).length;
  const sinZona = filas.filter((x) => x.sinZona).length;
  const mermaTotal = filas.reduce((t, x) => t + (x.mermaBase && x.mermaBase > 0 ? x.mermaBase : 0), 0);
  const desvio = costo.rendimiento !== null && rendFicha ? Math.abs(costo.rendimiento - rendFicha) / rendFicha * 100 : null;

  // El QR de una etiqueta de lote (o el código de barras de un insumo) agrega ese producto como ingrediente.
  async function escaneado(texto: string) {
    setEscaneando(false);
    const r = await leerCodigo(texto);
    const id = r.tipo === 'lote' ? r.lote.producto_id : r.tipo === 'producto' ? r.producto.producto_id : null;
    const ins = id ? insumoPorId.get(id) : undefined;
    if (r.tipo === 'lote' && r.lote.anulado) { setLeido({ ok: false, texto: `El lote ${r.lote.codigo} está anulado: no lo uses.` }); return; }
    if (r.tipo === 'lote' && r.lote.vence && r.lote.vence < hoyCali()) { setLeido({ ok: false, texto: `El lote ${r.lote.codigo} de ${r.lote.mpi} venció: no lo uses.` }); return; }
    if (!ins) { setLeido({ ok: false, texto: r.tipo === 'desconocido' ? 'No conozco ese código. Busca el ingrediente por nombre.' : 'Eso no es un ingrediente de esta área.' }); return; }
    if (consumos.some((c) => c.producto_id === ins.producto_id)) { setLeido({ ok: true, texto: `${ins.generico} ya está en los ingredientes.` }); return; }
    agregarInsumo(ins);
    setLeido({ ok: true, texto: `✔ ${ins.generico}${r.tipo === 'lote' ? ` (lote ${r.lote.codigo})` : ''} agregado: escribe la cantidad.` });
  }

  function guardar(conMotivo: boolean) {
    if (!mpi) return;
    setResultado(null);
    iniciar(async () => {
      const r = await registrarLote({
        area, ubicacion: destino, ubicacion_destino: destino, fecha, producto_id: mpi.producto_id,
        ficha_id: ficha && consumos.some((c) => c.linea_ficha !== null) ? ficha.id : null,
        neto: netoN, unidades: num(unidades), tiempo_min: num(tiempo), observaciones: obs,
        motivo_forzado: conMotivo ? motivo : null,
        consumos: consumos.map((c) => ({
          producto_id: c.producto_id, cantidad: num(c.cantidad), unidad: c.unidad, merma: num(c.merma ?? ''), nota: c.nota || null,
          ubicacion: insumoPorId.get(c.producto_id ?? '')?.tipo === 'SIN_COSTO' ? null : c.zona || null,
        })),
      });
      setResultado(r);
      if (r.ok) {
        try { localStorage.removeItem(clave); } catch { /* nada */ }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  function empezarDeNuevo() {
    setMpiId(null); setTandas('1'); setConsumos([]); setNeto(''); setUnidades(''); setTiempo(''); setObs('');
    setMotivo(''); setResultado(null); setFecha(hoyCali()); setDestino(''); setGuardado(false);
    try { localStorage.removeItem(clave); } catch { /* nada */ }
  }

  if (resultado?.ok && mpi) {
    return (
      <div className="tarjeta">
        <p className="exito" role="status" style={{ marginTop: 0 }}>
          <strong>Lote guardado: {resultado.codigo}</strong><br />
          {mpi.generico}: {fmtCantidad(netoN ?? 0)} {mpi.unidad_base} cargados en <strong>{nombreZona(destino)}</strong>
          {resultado.costo_unitario != null
            ? <> a {pesosU(Number(resultado.costo_unitario))} por {mpi.unidad_base} (lote de {pesos(Number(resultado.costo_total))}).</>
            : <>. Quedó sin costo completo: algún insumo no tenía costo en el kardex.</>}
        </p>
        {resultado.avisos.length > 0 && <div className="aviso"><ul style={{ margin: 0 }}>{resultado.avisos.map((m) => <li key={m}>{m}</li>)}</ul></div>}
        <div className="acciones">
          <Link className="boton" href={`/l/${encodeURIComponent(resultado.codigo ?? '')}/etiqueta`}><Icono nombre="qr" /> Imprimir etiquetas</Link>
          <button type="button" className="secundario" onClick={empezarDeNuevo}>Producir otro</button>
          <Link className="boton secundario" href="/existencias">Ver existencias</Link>
        </div>
      </div>
    );
  }

  const bloqueado = resultado && !resultado.ok && !resultado.fatales.length && resultado.bloqueos.length > 0;
  const opcionesMpi = (() => {
    const f = sinTildes(buscarMpi.trim());
    const ps = f.split(/\s+/).filter(Boolean);
    return datos.mpis.filter((m) => !ps.length || ps.every((w) => sinTildes(`${m.generico} ${m.marca} ${m.codigo} ${m.ficha_codigo ?? ''}`).includes(w))).slice(0, 12);
  })();
  const opcionesInsumo = (() => {
    const f = sinTildes(buscarInsumo.trim());
    if (f.length < 2) return [];
    const ps = f.split(/\s+/);
    return datos.insumos.filter((i) => i.producto_id !== mpiId && ps.every((w) => sinTildes(`${i.generico} ${i.marca} ${i.presentacion} ${i.codigo}`).includes(w))).slice(0, 8);
  })();

  return (
    <>
      {/* ------------------------------------------------ qué se produce */}
      <section className="tarjeta">
        <strong>1. ¿Qué vas a producir?</strong>
        {mpi ? (
          <div className="linea" style={{ marginTop: '.5rem', alignItems: 'flex-start' }}>
            <div>
              <strong>{mpi.generico}</strong>{mpi.marca && mpi.marca !== 'Di Égida' && ` · ${mpi.marca}`}
              <div className="suave" style={{ fontSize: '.85rem' }}>
                {ficha ? `Ficha ${ficha.codigo}${ficha.version > 1 ? ` v${ficha.version}` : ''}` : 'Sin ficha técnica: agrega los ingredientes a mano'}
                {mpi.costo_promedio !== null && ` · hoy cuesta ${pesosU(mpi.costo_promedio)}/${mpi.unidad_base}`}
              </div>
            </div>
            <button type="button" className="secundario chico"
                    onClick={async () => { if (!consumos.length || await confirmar('¿Cambiar de producto? Se pierden los ingredientes escritos.', { aceptar: 'Cambiar' })) { setMpiId(null); setConsumos([]); } }}>
              Cambiar
            </button>
          </div>
        ) : (
          <>
            <input aria-label="Buscar MPI" placeholder="Buscar: sirope, zumo, #5…" value={buscarMpi} onChange={(e) => setBuscarMpi(e.target.value)} style={{ marginTop: '.5rem' }} />
            <ul className="lista" style={{ marginTop: '.5rem' }}>
              {opcionesMpi.map((m) => (
                <li key={m.producto_id} style={{ padding: 0 }}>
                  <button type="button" className="secundario" style={{ width: '100%', textAlign: 'left', border: 0, color: 'inherit', minHeight: 52 }} onClick={() => elegirMpi(m)}>
                    <strong>{m.generico}</strong>
                    <span className="suave" style={{ display: 'block', fontSize: '.82rem', fontWeight: 400 }}>
                      {m.ficha_codigo ? `Ficha ${m.ficha_codigo}` : 'Sin ficha'}
                      {m.ultimo_lote && ` · último lote ${new Date(m.ultimo_lote + 'T12:00:00').toLocaleDateString('es-CO')}`}
                    </span>
                  </button>
                </li>
              ))}
              {!opcionesMpi.length && <li className="suave">Nada coincide.</li>}
            </ul>
          </>
        )}
        <label htmlFor="fecha">Fecha</label>
        <input id="fecha" type="date" max={hoyCali()} value={fecha} onChange={(e) => setFecha(e.target.value)} style={{ maxWidth: 220 }} />
        {ficha && (
          <>
            <label htmlFor="tandas">Tandas de la ficha <span className="ayuda">1 = la receta completa; 0,5 = media</span></label>
            <input id="tandas" inputMode="decimal" value={tandas} onChange={(e) => cambiarTandas(e.target.value)} style={{ maxWidth: 140 }} />
            {ficha.neto_esperado && <span className="ayuda">La ficha espera unos {fmtCantidad(r4(ficha.neto_esperado * k))} {mpi?.unidad_base} netos.</span>}
            {ficha.nota && <span className="ayuda">{ficha.nota}</span>}
          </>
        )}
      </section>

      {mpi && (
        <>
          {/* ------------------------------------------------ ingredientes */}
          <h2>2. Ingredientes {consumos.length > 0 && <span className="suave" style={{ fontWeight: 400 }}>({consumos.length})</span>}</h2>
          <ul className="lista">
            {filas.map(({ c, ins, q, f, base, mermaMala, hay, sinCosto, sinZona: faltaZona, falta }) => {
              const opciones = datos.insumos.filter((i) => i.generico_id === c.generico_id);
              return (
                <li key={c.clave} style={!c.producto_id || q === null || faltaZona ? { borderColor: 'var(--aviso)', borderWidth: 2 } : undefined}>
                  <div className="linea" style={{ alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <strong>{c.generico}</strong>
                      {c.linea_ficha !== null && <span className="suave" style={{ fontSize: '.8rem' }}> · línea {c.linea_ficha} de la ficha</span>}
                      {c.nota && <div className="suave" style={{ fontSize: '.82rem' }}>{c.nota}</div>}
                    </div>
                    <button type="button" className="secundario chico" aria-label={`Quitar ${c.generico}`}
                            onClick={() => setConsumos((cs) => cs.filter((x) => x.clave !== c.clave))}>Quitar</button>
                  </div>
                  {opciones.length > 1 ? (
                    <label style={{ margin: '.4rem 0 0', fontWeight: 400, fontSize: '.85rem' }}>Producto que se usa
                      <select value={c.producto_id ?? ''} onChange={(e) => poner(c.clave, { producto_id: e.target.value || null, zona: proponerZona(e.target.value || null) })}>
                        {opciones.map((o) => (
                          <option key={o.producto_id} value={o.producto_id}>
                            {[o.marca, o.presentacion].filter(Boolean).join(' · ') || o.codigo} — hay {fmtCantidad(saldoTotal(o.producto_id))} {o.unidad_base}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : !opciones.length ? (
                    <p className="error" style={{ margin: '.4rem 0 0', padding: '.4rem .6rem', fontSize: '.85rem' }}>
                      {c.generico} no tiene producto en el catálogo de {area === 'BAR' ? 'bar' : 'cocina'}. Créalo o quita la línea.
                    </p>
                  ) : null}
                  {ins && !sinCosto && (
                    <label style={{ margin: '.4rem 0 0', fontWeight: 400, fontSize: '.85rem' }}>¿De dónde lo cogiste?
                      <select value={c.zona ?? ''} onChange={(e) => poner(c.clave, { zona: e.target.value })}
                              aria-invalid={faltaZona || undefined} style={faltaZona ? { borderColor: 'var(--aviso)' } : undefined}>
                        <option value="">— Zona —</option>
                        {zonas.map((z) => {
                          const q2 = saldo(ins.producto_id, z.codigo);
                          return <option key={z.codigo} value={z.codigo}>{z.nombre}{q2 ? ` — hay ${fmtCantidad(r4(q2))} ${ins.unidad_base}` : ''}{zonaDe[ins.producto_id] === z.codigo ? ' · su lugar' : ''}</option>;
                        })}
                      </select>
                    </label>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '.5rem', marginTop: '.5rem' }}>
                    <label style={{ margin: 0, fontWeight: 400, fontSize: '.85rem' }}>Cantidad usada
                      <input inputMode="decimal" value={c.cantidad} onChange={(e) => poner(c.clave, { cantidad: e.target.value, editada: true })} />
                    </label>
                    <label style={{ margin: 0, fontWeight: 400, fontSize: '.85rem' }}>Merma <span className="ayuda">opcional</span>
                      <input inputMode="decimal" value={c.merma ?? ''} aria-invalid={mermaMala || undefined} placeholder="lo que se botó"
                             onChange={(e) => poner(c.clave, { merma: e.target.value })} style={mermaMala ? { borderColor: 'var(--error)' } : undefined} />
                    </label>
                    <label style={{ margin: 0, fontWeight: 400, fontSize: '.85rem' }}>Unidad
                      <select value={c.unidad} onChange={(e) => poner(c.clave, { unidad: e.target.value, editada: true })} style={{ minWidth: 80 }}>
                        {unidadesDe(c).map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </label>
                  </div>
                  {q !== null && f === null && (
                    <div className="aviso" style={{ margin: '.5rem 0 0', padding: '.4rem .6rem', fontSize: '.85rem' }}>
                      No hay conversión de {c.unidad} a {c.unidad_base} para {c.generico}. Pesa o mide lo que usaste y escríbelo en {c.unidad_base}.
                    </div>
                  )}
                  <div className="suave" style={{ fontSize: '.82rem', marginTop: '.3rem' }}>
                    {base !== null && c.unidad !== c.unidad_base && <>= {fmtCantidad(r4(base))} {c.unidad_base} · </>}
                    {sinCosto ? 'sin costo' : ins && base !== null
                      ? ins.costo_promedio !== null ? `${pesos(base * ins.costo_promedio)} (${pesosU(ins.costo_promedio)}/${c.unidad_base})` : 'aún sin costo (falta el conteo inicial o una compra)'
                      : null}
                    {c.zona && ins && !sinCosto && <> · allí hay {fmtCantidad(r4(hay))} {c.unidad_base}</>}
                  </div>
                  {mermaMala && <div className="error" style={{ margin: '.5rem 0 0', padding: '.4rem .6rem', fontSize: '.85rem' }}>La merma no puede ser mayor que la cantidad usada.</div>}
                  {falta && (
                    <div className="aviso" style={{ margin: '.5rem 0 0', padding: '.4rem .6rem', fontSize: '.85rem' }}>
                      El kardex no tiene tanto en {nombreZona(c.zona ?? '')}. Revisa de dónde lo cogiste; si de verdad salió de ahí, al guardar te pedirá un motivo.
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '.5rem', marginTop: '.9rem' }}>
            <label htmlFor="otro" style={{ margin: 0 }}>Agregar ingrediente</label>
            <button type="button" className="secundario chico" onClick={() => { setLeido(null); setEscaneando(true); }}><Icono nombre="escanear" /> Escanear</button>
          </div>
          {leido && <p className={leido.ok ? 'exito' : 'aviso'} style={{ margin: '.4rem 0', padding: '.4rem .6rem' }}>{leido.texto}</p>}
          {escaneando && <Escaner titulo="Escanear lote o producto" onCerrar={() => setEscaneando(false)} onCodigo={escaneado} />}
          <input id="otro" placeholder="Buscar en el catálogo…" value={buscarInsumo} onChange={(e) => setBuscarInsumo(e.target.value)} />
          {opcionesInsumo.length > 0 && (
            <ul className="lista" style={{ marginTop: '.4rem' }}>
              {opcionesInsumo.map((i) => (
                <li key={i.producto_id} style={{ padding: 0 }}>
                  <button type="button" className="secundario" style={{ width: '100%', textAlign: 'left', border: 0, color: 'inherit' }} onClick={() => agregarInsumo(i)}>
                    <strong>{i.generico}</strong> <span className="suave">· {[i.marca, i.presentacion].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* ------------------------------------------------ resultado */}
          <h2>3. Lo que salió</h2>
          <section className="tarjeta">
            <label htmlFor="neto" style={{ marginTop: 0 }}>Peso neto final ({mpi.unidad_base})</label>
            <input id="neto" inputMode="decimal" value={neto} onChange={(e) => setNeto(e.target.value)} />
            <span className="ayuda">Pésalo ya terminado, sin el recipiente.</span>
            <div className="fila">
              <div>
                <label htmlFor="und">Envases <span className="ayuda">opcional</span></label>
                <input id="und" inputMode="decimal" value={unidades} onChange={(e) => setUnidades(e.target.value)} />
              </div>
              <div>
                <label htmlFor="min">Tiempo (min) <span className="ayuda">opcional</span></label>
                <input id="min" inputMode="decimal" value={tiempo} onChange={(e) => setTiempo(e.target.value)} />
              </div>
            </div>
            {listas.length > 0 && (
              <p className="suave" style={{ fontSize: '.9rem', marginBottom: 0 }}>
                Ingredientes: {fmtCantidad(r4(costo.entrada))} g/ml en total · costo <strong>{pesos(costo.total)}</strong>
                {costo.unitario !== null && <> · <strong>{pesosU(costo.unitario)} por {mpi.unidad_base}</strong></>}
                {costo.estado === 'PARCIAL' && <> · algún insumo no tiene costo: el lote quedará sin costo completo</>}
                {mermaTotal > 0 && <><br />Merma: {fmtCantidad(r4(mermaTotal))} g/ml ({Math.round((mermaTotal / costo.entrada) * 1000) / 10} % de lo usado)</>}
                {costo.rendimiento !== null && <><br />Rendimiento {Math.round(costo.rendimiento * 1000) / 10} %{rendFicha !== null && ` (ficha ${Math.round(rendFicha * 1000) / 10} %)`}</>}
              </p>
            )}
            {desvio !== null && desvio > 15 && (
              <p className="aviso" style={{ marginBottom: 0 }}>
                El rendimiento se aparta {Math.round(desvio)} % de la ficha (más del 15 %). Revisa el neto y las cantidades antes de guardar; si está bien, anótalo en observaciones.
              </p>
            )}
          </section>

          <label htmlFor="obs">Observaciones <span className="ayuda">opcional</span></label>
          <textarea id="obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />

          {/* ------------------------------------------------ dónde queda */}
          <h2>4. Dónde lo guardas</h2>
          <section className="tarjeta">
            {destino && zonaDe[mpi.producto_id] === destino
              ? <p style={{ marginTop: 0 }}>Guárdalo en <strong>{nombreZona(destino)}</strong>: es su lugar en el mapa del {area === 'BAR' ? 'bar' : 'cocina'}.</p>
              : !zonaDe[mpi.producto_id] && <p className="suave" style={{ marginTop: 0 }}>{mpi.generico} todavía no tiene un lugar asignado en el mapa: elige dónde lo dejas.</p>}
            <label htmlFor="destino" style={{ marginTop: 0 }}>Zona donde queda</label>
            <select id="destino" value={destino} onChange={(e) => { setDestino(e.target.value); setGuardado(false); }}>
              <option value="">— Zona —</option>
              {zonas.map((z) => <option key={z.codigo} value={z.codigo}>{z.nombre}{zonaDe[mpi.producto_id] === z.codigo ? ' · su lugar' : ''}</option>)}
            </select>
            <label style={{ display: 'flex', gap: '.6rem', alignItems: 'center', fontWeight: 400, marginBottom: 0 }}>
              <input type="checkbox" checked={guardado} disabled={!destino} onChange={(e) => setGuardado(e.target.checked)} style={{ width: 22, height: 22, minHeight: 0 }} />
              {destino ? <>Ya lo dejé en {nombreZona(destino)}</> : 'Elige primero la zona'}
            </label>
          </section>

          {resultado && !resultado.ok && (
            <div className={bloqueado ? 'aviso' : 'error'} role="alert">
              <strong>{bloqueado ? 'Para guardar así hace falta un motivo:' : 'No se guardó:'}</strong>
              <ul>{[...resultado.fatales, ...resultado.bloqueos].map((m) => <li key={m}>{m}</li>)}</ul>
              {resultado.avisos.length > 0 && <><strong>Avisos:</strong><ul>{resultado.avisos.map((m) => <li key={m}>{m}</li>)}</ul></>}
              {bloqueado && (
                <>
                  <label htmlFor="motivo">Corrige lo de arriba, o escribe por qué se produce así</label>
                  <textarea id="motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                            placeholder="Ej.: el azúcar llegó hoy y la recepción se registra en la tarde" />
                </>
              )}
            </div>
          )}

          <div className="acciones barra-guardar">
            {bloqueado ? (
              <button type="button" disabled={enviando || motivo.trim().length < 15 || !guardado} onClick={() => guardar(true)}>
                {enviando ? 'Guardando…' : 'Guardar con este motivo'}
              </button>
            ) : (
              <button type="button" disabled={enviando || !destino || !guardado || !consumos.length || incompletas > 0 || sinZona > 0 || sinConversion > 0 || mermasMalas > 0 || !(netoN && netoN > 0)}
                      onClick={() => guardar(false)}>
                {enviando ? 'Guardando…' : destino ? `Cargar el lote en ${nombreZona(destino)}` : 'Guardar lote'}
              </button>
            )}
            <button type="button" className="secundario" disabled={enviando}
                    onClick={async () => { if (await confirmar('¿Descartar este lote? Nada se ha guardado todavía.', { aceptar: 'Descartar', peligro: true })) empezarDeNuevo(); }}>
              Descartar
            </button>
          </div>
          {(!destino || !guardado || incompletas > 0 || sinZona > 0 || sinConversion > 0 || !(netoN && netoN > 0)) && (
            <p className="suave" style={{ fontSize: '.85rem' }}>
              {incompletas > 0 ? `Falta la cantidad o el producto en ${incompletas} ingrediente(s); quita los que no usaste. ` : ''}
              {sinZona > 0 ? `Di de dónde cogiste ${sinZona} ingrediente(s). ` : ''}
              {!destino ? 'Elige dónde queda guardado. ' : !guardado ? `Confirma que lo dejaste en ${nombreZona(destino)}. ` : ''}
              {sinConversion > 0 ? `${sinConversion} ingrediente(s) en una unidad sin conversión. ` : ''}
              {!(netoN && netoN > 0) ? 'Falta el peso neto final.' : ''}
            </p>
          )}
        </>
      )}
    </>
  );
}
