'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Resultado } from '@/lib/catalogo';
import { ALERGENOS, CONSERVACIONES, TIPOS_PUNTO, cant, type Almacenamiento, type Presentacion, type Punto, type TipoPunto } from '@/lib/fichas';
import { guardarFicha, proponerDescripcion } from '../acciones';
import type { PropuestaDescripcion } from '@/lib/descripcion-ia';
import { aprobarReceta } from '../../produccion/validar/acciones';

type UB = 'g' | 'ml' | 'und';
type Ingrediente = { id: string; nombre: string; tipo: string; unidad_base: UB; unidades: string[]; productos?: { id: string; etiqueta: string }[] };
type LoteViejo = { codigo: string; fecha: string; conservacion: string | null; vida_util_dias: number | null; empaque: string | null;
                   tecnica: string | null; tiempo_min: number | null; observaciones: string | null };
export type DatosFicha = {
  resultado: { id: string; codigo: string; nombre: string; tipo: string; unidad_base: UB; area: 'BAR' | 'COCINA' };
  puede_editar: boolean;
  es_vigente: boolean;
  ficha: {
    id: string; codigo: string; version: number; neto_esperado: number | null; nota: string | null; vigente_desde: string; vigente_hasta: string | null;
    procedimiento: string[]; descripcion: string | null; presentacion: string | null; metodo: string | null; tiempo_min: number | null;
    porciones: number | null; empaque: string | null; alergenos: string[]; observaciones: string | null; origen: string;
    motivo_cambio: string | null; creado_en: string; creado_por: string | null; lotes: number;
  } | null;
  lineas: { generico_id: string; generico: string; tipo: string; unidad_base: UB; producto_id: string | null; marca: string | null; cantidad: number | null; unidad: string; nota: string | null;
            factor: number | null; cantidad_base: number | null; costo_unitario: number | null; costo: number | null; falta: string | null; estimado: boolean }[];
  puntos: Punto[];
  almacenamientos: Almacenamiento[];
  presentaciones?: Presentacion[];
  versiones: { id: string; version: number; vigente_desde: string; vigente_hasta: string | null; origen: string; motivo_cambio: string | null;
               creado_en: string; creado_por: string | null; lotes: number }[];
  sugerencias: { generico: { conservacion: string | null; vida_util_dias: number | null }; lotes: LoteViejo[] };
  ingredientes: Ingrediente[];
};
// Una línea: lo que la persona escribe va como texto
// producto_id: la marca que pide la ficha ('' = cualquiera del genérico)
type Linea = { clave: string; generico_id: string; producto_id: string; cantidad: string; unidad: string; nota: string; factor: string };
type Alm = { conservacion: Almacenamiento['conservacion']; dias: string; nota: string };
type Pres = { clave: string; contenido: string; detalle: string; por_tanda: string; empaque: string };
// Propuesta con que abre el editor (receta del recetario): reemplaza lo de la ficha vigente
export type InicialFicha = {
  codigo: string; neto: string; tiempo: string; porciones: string; metodo: string; pasos: string[]; puntos: Punto[]; alergenos: string[];
  descripcion: string; observaciones: string; lineas: { generico_id: string; cantidad: string; unidad: string; nota: string; producto_id?: string }[];
  presentacion?: string;
};

const EXTRA = ['cda', 'cdta', 'taza', 'gota', 'dash', 'pizca', 'und'];
const num = (s: string) => { const n = Number(s.replace(',', '.')); return s.trim() === '' || !Number.isFinite(n) ? null : n; };
const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const TRAZA = ['dash', 'gota', 'gts'];
// «Refrigerado (2-5°C)» de los lotes de SGI-COSTOS → conservación + nota
const leerConservacion = (s: string | null): { c: Almacenamiento['conservacion']; nota: string } | null => {
  if (!s) return null;
  const c = CONSERVACIONES.find((x) => sinTildes(s).startsWith(sinTildes(x)));
  return c ? { c, nota: (s.match(/\(([^)]+)\)/)?.[1] ?? '').trim() } : null;
};

// Unidades que ya se convierten a la unidad base del ingrediente, sin pedir nada
function convierte(i: Ingrediente, u: string) {
  return u === i.unidad_base || (u === 'kg' && i.unidad_base === 'g') || (u === 'l' && i.unidad_base === 'ml')
    || (i.unidad_base === 'und' && ['bot', 'lata', 'unidad'].includes(u)) || i.unidades.includes(u)
    || (i.tipo === 'SIN_COSTO' && ['g', 'ml'].includes(u) && i.unidad_base !== 'und');
}

export default function EditorFicha({ datos, inicial, receta, volverA }: {
  datos: DatosFicha;
  inicial?: InicialFicha;                        // abre con esta propuesta en vez de la ficha vigente
  receta?: { fuente: string; codigo: string };   // al guardar se aprueba esta receta del recetario
  volverA?: string;
}) {
  const router = useRouter();
  const f = datos.ficha;
  const esMpi = datos.resultado.tipo === 'MPI';
  const porId = useMemo(() => new Map(datos.ingredientes.map((i) => [i.id, i])), [datos.ingredientes]);
  const [codigo, setCodigo] = useState(inicial?.codigo ?? f?.codigo ?? '');
  const [neto, setNeto] = useState(inicial ? inicial.neto : f?.neto_esperado != null ? String(f.neto_esperado) : '');
  const [tiempo, setTiempo] = useState(inicial ? inicial.tiempo : f?.tiempo_min != null ? String(f.tiempo_min) : '');
  const [porciones, setPorciones] = useState(inicial ? inicial.porciones : f?.porciones != null ? String(f.porciones) : '');
  const [metodo, setMetodo] = useState(inicial?.metodo ?? f?.metodo ?? '');
  const [pasos, setPasos] = useState<string[]>(inicial?.pasos.length ? inicial.pasos : f?.procedimiento.length ? f.procedimiento : ['']);
  const [puntos, setPuntos] = useState<Punto[]>(inicial?.puntos ?? datos.puntos);
  const [alergenos, setAlergenos] = useState<string[]>(inicial?.alergenos ?? f?.alergenos ?? []);
  const [alm, setAlm] = useState<Alm[]>(datos.almacenamientos.map((a) => ({ conservacion: a.conservacion, dias: String(a.vida_util_dias), nota: a.nota ?? '' })));
  const [empaque, setEmpaque] = useState(f?.empaque ?? '');
  const [pres, setPres] = useState<Pres[]>(() => (datos.presentaciones ?? []).map((p) => ({
    clave: crypto.randomUUID(), contenido: p.contenido === null ? '' : String(p.contenido), detalle: p.detalle ?? '',
    por_tanda: p.por_tanda === null ? '' : String(p.por_tanda), empaque: p.empaque ?? '' })));
  const ponerPres = (k: string, c: Partial<Pres>) => setPres((xs) => xs.map((x) => (x.clave === k ? { ...x, ...c } : x)));
  const [descripcion, setDescripcion] = useState(inicial?.descripcion ?? f?.descripcion ?? '');
  const [presentacion, setPresentacion] = useState(inicial?.presentacion ?? f?.presentacion ?? '');
  const [observaciones, setObservaciones] = useState(inicial?.observaciones ?? f?.observaciones ?? '');
  const [nota, setNota] = useState(f?.nota ?? '');
  const [motivo, setMotivo] = useState('');
  const [lineas, setLineas] = useState<Linea[]>(() => inicial
    ? inicial.lineas.map((l) => ({ clave: crypto.randomUUID(), ...l, producto_id: l.producto_id ?? '', factor: '' }))
    : datos.lineas.map((l) => ({
        clave: crypto.randomUUID(), generico_id: l.generico_id, producto_id: l.producto_id ?? '', cantidad: l.cantidad === null ? '' : String(l.cantidad),
        unidad: l.unidad, nota: l.nota ?? '', factor: '' })));
  const destino = volverA ?? `/fichas/${datos.resultado.id}`;
  const faltaNeto = !!receta && esMpi && num(neto) === null;
  const [buscar, setBuscar] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [enviando, iniciar] = useTransition();
  const ub = datos.resultado.unidad_base;
  const esFinal = datos.resultado.tipo === 'BEBIDA' || datos.resultado.tipo === 'PLATO';
  const [propuesta, setPropuesta] = useState<PropuestaDescripcion | null>(null);
  const [errorIA, setErrorIA] = useState<string | null>(null);
  const [pensando, iniciarIA] = useTransition();

  function pedirDescripcion() {
    setErrorIA(null);
    iniciarIA(async () => {
      const r = await proponerDescripcion({
        generico_id: datos.resultado.id, metodo, presentacion, pasos, descripcion,
        lineas: lineas.map((l) => ({ generico_id: l.generico_id, cantidad: l.cantidad, unidad: l.unidad, nota: l.nota })),
      });
      if (r.ok) setPropuesta(r.propuesta); else { setPropuesta(null); setErrorIA(r.error); }
    });
  }

  const poner = (k: string, c: Partial<Linea>) => { setLineas((ls) => ls.map((l) => (l.clave === k ? { ...l, ...c } : l))); setResultado(null); };
  const mover = (i: number, d: number) => setLineas((ls) => { const n = [...ls]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  const opciones = useMemo(() => {
    const q = sinTildes(buscar.trim());
    if (q.length < 2) return [];
    const ps = q.split(/\s+/);
    return datos.ingredientes.filter((i) => ps.every((w) => sinTildes(i.nombre).includes(w))).slice(0, 10);
  }, [buscar, datos.ingredientes]);

  const pendientes = lineas.filter((l) => {
    const i = porId.get(l.generico_id);
    return !i || num(l.cantidad) === null || (!convierte(i, l.unidad) && !TRAZA.includes(l.unidad) && !(num(l.factor)! > 0));
  }).length;

  // lo anotado en lotes de SGI-COSTOS: se ofrece, no se copia solo
  const sug = useMemo(() => {
    const vistos = new Set(alm.map((a) => a.conservacion));
    const almac: { c: Almacenamiento['conservacion']; dias: number; nota: string; de: string }[] = [];
    for (const l of datos.sugerencias.lotes) {
      const c = leerConservacion(l.conservacion);
      if (c && l.vida_util_dias && !vistos.has(c.c) && !almac.some((x) => x.c === c.c)) almac.push({ c: c.c, dias: l.vida_util_dias, nota: c.nota, de: l.codigo });
    }
    const g = datos.sugerencias.generico;
    if (g.conservacion && g.vida_util_dias && !vistos.has(g.conservacion as Alm['conservacion']) && !almac.some((x) => x.c === g.conservacion))
      almac.push({ c: g.conservacion as Alm['conservacion'], dias: g.vida_util_dias, nota: '', de: 'el catálogo' });
    const emp = !empaque ? datos.sugerencias.lotes.find((l) => l.empaque && !/granel|otro/i.test(l.empaque)) : undefined;
    const obs = datos.sugerencias.lotes.filter((l) => l.observaciones && l.observaciones.length > 15 && !puntos.some((p) => p.texto === l.observaciones!.slice(0, 400)));
    return { almac, emp, obs };
  }, [datos.sugerencias, alm, empaque, puntos]);

  function guardar() {
    setResultado(null);
    iniciar(async () => {
      const r = await (receta ? (p: Record<string, unknown>) => aprobarReceta({ ...p, fuente: receta.fuente, receta: receta.codigo }) : guardarFicha)({
        generico_id: datos.resultado.id, codigo, neto_esperado: neto, nota, motivo_cambio: motivo,
        tiempo_min: tiempo, porciones, metodo, empaque, descripcion, presentacion, observaciones,
        procedimiento: pasos, alergenos, puntos,
        almacenamientos: alm.map((a) => ({ conservacion: a.conservacion, vida_util_dias: a.dias, nota: a.nota })),
        presentaciones: pres.filter((p) => p.contenido.trim() || p.detalle.trim() || p.por_tanda.trim() || p.empaque.trim())
          .map((p) => ({ contenido: p.contenido.replace(',', '.'), detalle: p.detalle, por_tanda: p.por_tanda, empaque: p.empaque })),
        lineas: lineas.map((l) => ({ generico_id: l.generico_id, producto_id: l.producto_id || null, cantidad: l.cantidad, unidad: l.unidad, nota: l.nota, factor: num(l.factor) })),
      });
      setResultado(r);
      if (r.ok) { router.push(receta ? `/fichas/${datos.resultado.id}` : destino); router.refresh(); }
    });
  }

  if (!datos.puede_editar) return <p className="aviso">Solo el {datos.resultado.area === 'BAR' ? 'jefe de barra' : 'chef'} o administración editan esta ficha.</p>;

  return (
    <>
      <p className="suave mt-0">
        {receta ? <>Revise la propuesta y apruébela: nace la <strong>versión {(f?.version ?? 0) + 1}</strong> de la ficha, con origen {(receta.fuente === 'CARTA COCINA' ? 'RECETARIO COCINA' : receta.fuente).toLowerCase()}.</>
          : f ? <>Al guardar nace la <strong>versión {f.version + 1}</strong>; la {f.version} queda tal cual
          {Number(f.lotes) > 0 ? ` para los ${f.lotes} lote(s) que se hicieron con ella` : ''}.</> : 'Primera versión de esta ficha.'}
      </p>

      <div className="dos-col pagina-ancha">
        <div className="pila">
          <section className="tarjeta">
            <h2 className="sec-tit">Encabezado</h2>
            <div className="fila">
              <div>
                <label className="mt-0" htmlFor="codigo">Código de la ficha</label>
                <input id="codigo" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="#5, MPi-012…" />
              </div>
              <div>
                <label className="mt-0" htmlFor="neto">{esMpi ? 'Neto esperado' : 'Rinde'} ({ub})</label>
                <input id="neto" inputMode="decimal" value={neto} onChange={(e) => setNeto(e.target.value)} />
              </div>
            </div>
            {esMpi && <span className="ayuda">Lo que pesa la tanda completa ya terminada. Con esto se calcula el rendimiento esperado y el costo por {ub}.</span>}
            <div className="fila">
              <div>
                <label htmlFor="tiempo">Tiempo de preparación (min)</label>
                <input id="tiempo" inputMode="numeric" value={tiempo} onChange={(e) => setTiempo(e.target.value)} />
              </div>
              <div>
                <label htmlFor="porciones">Porciones o unidades por tanda</label>
                <input id="porciones" inputMode="decimal" value={porciones} onChange={(e) => setPorciones(e.target.value)} />
              </div>
            </div>
            <label htmlFor="metodo">Método o técnica</label>
            <input id="metodo" value={metodo} onChange={(e) => setMetodo(e.target.value)} placeholder="Reducción, maceración, licuado y colado…" />
          </section>

          <section className="tarjeta">
            <h2 className="sec-tit">Ingredientes ({lineas.length})</h2>
            <ul className="lista">
              {lineas.map((l, idx) => {
                const i = porId.get(l.generico_id);
                const original = datos.lineas.find((x) => x.generico_id === l.generico_id);
                const nombre = i?.nombre ?? original?.generico ?? 'Ingrediente inactivo';
                const unidades = i ? [...new Set([i.unidad_base, i.unidad_base === 'g' ? 'kg' : i.unidad_base === 'ml' ? 'l' : '', ...i.unidades, ...EXTRA, l.unidad].filter(Boolean))] : [l.unidad];
                const sinConv = !!i && !convierte(i, l.unidad) && !TRAZA.includes(l.unidad);
                const marcas = i?.productos ?? [];
                return (
                  <li key={l.clave} style={!i || num(l.cantidad) === null || (sinConv && !(num(l.factor)! > 0)) ? { borderColor: 'var(--aviso)', borderWidth: 2 } : undefined}>
                    <div className="linea arriba">
                      <div className="min-0">
                        <span className="suave texto-mini">{idx + 1}. </span>
                        {(i?.tipo ?? original?.tipo) === 'MPI'
                          ? <Link href={`/fichas/${l.generico_id}`} title={`Ver la ficha técnica de ${nombre}`}><strong>{nombre}</strong> ↗</Link>
                          : (i?.tipo ?? original?.tipo) === 'MPe'
                            ? <Link href={`/catalogo/generico/${l.generico_id}`} title={`Ver ${nombre} en el catálogo`}><strong>{nombre}</strong> ↗</Link>
                            : <strong>{nombre}</strong>}
                        {i && <span className="suave texto-mini"> · {i.tipo === 'SIN_COSTO' ? 'sin costo' : i.tipo} · base {i.unidad_base}</span>}
                      </div>
                      <div style={{ display: 'flex', gap: '.3rem' }}>
                        <button type="button" className="secundario chico" disabled={idx === 0} onClick={() => mover(idx, -1)} aria-label="Subir">↑</button>
                        <button type="button" className="secundario chico" disabled={idx === lineas.length - 1} onClick={() => mover(idx, 1)} aria-label="Bajar">↓</button>
                        <button type="button" className="secundario chico" onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}>Quitar</button>
                      </div>
                    </div>
                    {marcas.length > 1 && (
                      <label style={{ margin: '.45rem 0 0', fontWeight: 400, fontSize: '.85rem' }}>Marca
                        <select value={l.producto_id} onChange={(e) => poner(l.clave, { producto_id: e.target.value })} aria-label={`Marca de ${nombre}`}>
                          <option value="">Cualquiera de las {marcas.length}</option>
                          {marcas.map((p) => <option key={p.id} value={p.id}>{p.etiqueta}</option>)}
                        </select>
                      </label>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 2fr)', gap: '.5rem', marginTop: '.45rem', alignItems: 'end' }}>
                      <label className="campo">Cantidad
                        <input inputMode="decimal" value={l.cantidad} onChange={(e) => poner(l.clave, { cantidad: e.target.value })} />
                      </label>
                      <label className="campo">Unidad
                        <select value={l.unidad} onChange={(e) => poner(l.clave, { unidad: e.target.value, factor: '' })} style={{ minWidth: 84 }}>
                          {unidades.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </label>
                      <label className="campo">Nota
                        <input value={l.nota} onChange={(e) => poner(l.clave, { nota: e.target.value })} placeholder="en brunoise, para decorar…" />
                      </label>
                    </div>
                    {sinConv && i && (
                      <div className="aviso" style={{ margin: '.5rem 0 0', padding: '.45rem .6rem', fontSize: '.85rem' }}>
                        {nombre} no tiene conversión de {l.unidad} a {i.unidad_base}. Mídala una vez y la ficha podrá costearlo:
                        <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', marginTop: '.35rem' }}>
                          <span className="nowrap">1 {l.unidad} =</span>
                          <input inputMode="decimal" value={l.factor} onChange={(e) => poner(l.clave, { factor: e.target.value })} style={{ maxWidth: 110 }} aria-label={`Equivalencia de ${l.unidad} en ${i.unidad_base}`} />
                          <span>{i.unidad_base}</span>
                        </div>
                      </div>
                    )}
                    {TRAZA.includes(l.unidad) && !(i && convierte(i, l.unidad)) && (
                      <div className="suave" style={{ fontSize: '.8rem', marginTop: '.3rem' }}>Traza: sin conversión medida cuenta como $0.</div>
                    )}
                    {num(l.cantidad) === null && <div style={{ fontSize: '.82rem', color: 'var(--aviso)', marginTop: '.3rem' }}>Sin cantidad: la ficha queda incompleta.</div>}
                  </li>
                );
              })}
            </ul>
            <label htmlFor="ing">Agregar ingrediente</label>
            <input id="ing" placeholder="Buscar insumo, MPI o agua…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
            {opciones.length > 0 && (
              <ul className="lista mt-1">
                {opciones.map((i) => (
                  <li className="p-0" key={i.id}>
                    <button type="button" className="secundario" style={{ width: '100%', textAlign: 'left', justifyContent: 'flex-start', border: 0, color: 'inherit' }}
                            onClick={() => { setLineas((ls) => [...ls, { clave: crypto.randomUUID(), generico_id: i.id, producto_id: '', cantidad: '', unidad: i.unidad_base, nota: '', factor: '' }]); setBuscar(''); }}>
                      <strong>{i.nombre}</strong> <span className="suave">· {i.tipo === 'SIN_COSTO' ? 'sin costo' : i.tipo} · {i.unidad_base}{(i.productos?.length ?? 0) > 1 ? ` · ${i.productos!.length} marcas` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="tarjeta">
            <h2 className="sec-tit">Procedimiento · un paso por casilla</h2>
            <ol className="pasos-ficha">
              {pasos.map((p, i) => (
                <li key={i}>
                  <div style={{ display: 'flex', gap: '.4rem', alignItems: 'flex-start' }}>
                    <textarea rows={2} value={p} aria-label={`Paso ${i + 1}`}
                              onChange={(e) => setPasos((ps) => ps.map((x, j) => (j === i ? e.target.value : x)))} />
                    <button type="button" className="secundario chico" aria-label={`Quitar paso ${i + 1}`}
                            onClick={() => setPasos((ps) => (ps.length > 1 ? ps.filter((_, j) => j !== i) : ['']))}>×</button>
                  </div>
                </li>
              ))}
            </ol>
            <button type="button" className="secundario chico mt-2" onClick={() => setPasos((ps) => [...ps, ''])}>+ Paso</button>
          </section>

          <section className="tarjeta">
            <h2 className="sec-tit">Descripción y presentación</h2>
            <label className="mt-0" htmlFor="desc">Descripción <span className="ayuda">qué es y cómo debe quedar (color, textura, sabor)</span></label>
            <textarea id="desc" rows={esFinal ? 3 : 2} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
            {esFinal && (
              <div style={{ marginTop: '.45rem' }}>
                <button type="button" className="secundario chico" disabled={pensando || !lineas.length} onClick={pedirDescripcion}
                        title="La IA lee los ingredientes, cantidades, método y presentación de este editor y propone una descripción">
                  {pensando ? 'Pensando la descripción…' : propuesta ? '✦ Otra propuesta' : '✦ Proponer descripción con IA'}
                </button>
                {!lineas.length && <span className="ayuda"> agregue ingredientes primero</span>}
                {errorIA && <div className="error" role="alert" style={{ marginTop: '.45rem' }}>{errorIA}</div>}
                {propuesta && (
                  <div className="tarjeta" style={{ borderStyle: 'dashed', marginTop: '.5rem', padding: '.7rem .8rem' }} role="status">
                    <div className="suave" style={{ fontSize: '.8rem', marginBottom: '.3rem' }}>Propuesta de la IA según los ingredientes · usted decide</div>
                    <p style={{ margin: '0 0 .5rem' }}>{propuesta.descripcion}</p>
                    {propuesta.perfil.length > 0 && (
                      <ul className="renglones" style={{ fontSize: '.85rem', margin: '0 0 .5rem' }}>
                        {propuesta.perfil.map((x) => <li key={x.eje}><span><strong>{x.eje}:</strong> {x.detalle}</span></li>)}
                      </ul>
                    )}
                    {propuesta.aviso && <div className="aviso" style={{ margin: '0 0 .5rem', padding: '.4rem .6rem', fontSize: '.85rem' }}>{propuesta.aviso}</div>}
                    <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                      <button type="button" className="chico" onClick={() => { setDescripcion(propuesta.descripcion); setPropuesta(null); }}>Usar esta descripción</button>
                      <button type="button" className="secundario chico" onClick={() => setPropuesta(null)}>Descartar</button>
                    </div>
                    <div className="ayuda" style={{ marginTop: '.35rem' }}>Al usarla puede corregirla arriba; queda en la ficha solo cuando guarde la versión.</div>
                  </div>
                )}
              </div>
            )}
            <label htmlFor="pres">Presentación <span className="ayuda">{esMpi ? 'cómo se entrega a la línea o a la barra' : 'menaje, montaje y decoración'}</span></label>
            <textarea id="pres" rows={2} value={presentacion} onChange={(e) => setPresentacion(e.target.value)} />
          </section>
        </div>

        <div className="pila">
          <section className="tarjeta">
            <h2 className="sec-tit">Puntos críticos · se muestran antes de producir</h2>
            {puntos.length === 0 && <div className="vacio">Sin puntos críticos. Escriba lo que no se puede olvidar: temperaturas, tiempos, higiene, calidad.</div>}
            {puntos.map((p, i) => (
              <div key={i} style={{ display: 'grid', gap: '.35rem', padding: '.5rem 0', borderBottom: '1px solid var(--borde)' }}>
                <div className="fila-flex">
                  <select value={p.tipo} aria-label={`Tipo del punto ${i + 1}`} style={{ maxWidth: 170 }}
                          onChange={(e) => setPuntos((ps) => ps.map((x, j) => (j === i ? { ...x, tipo: e.target.value as TipoPunto } : x)))}>
                    {TIPOS_PUNTO.map((t) => <option key={t.v} value={t.v}>{t.t}</option>)}
                  </select>
                  <button type="button" className="secundario chico" onClick={() => setPuntos((ps) => ps.filter((_, j) => j !== i))} aria-label={`Quitar punto ${i + 1}`}>×</button>
                </div>
                <textarea rows={2} maxLength={400} value={p.texto} aria-label={`Punto crítico ${i + 1}`}
                          onChange={(e) => setPuntos((ps) => ps.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))} />
              </div>
            ))}
            <div className="chips-sel mt-2">
              {TIPOS_PUNTO.slice(0, 4).map((t) => (
                <button key={t.v} type="button" onClick={() => setPuntos((ps) => [...ps, { tipo: t.v, texto: '' }])}>+ {t.t}</button>
              ))}
            </div>
            <h3 className="sec-tit mt-3">Alérgenos</h3>
            <div className="chips-sel">
              {[...ALERGENOS, ...alergenos.filter((a) => !ALERGENOS.includes(a))].map((a) => (
                <button key={a} type="button" aria-pressed={alergenos.includes(a)}
                        onClick={() => setAlergenos((xs) => (xs.includes(a) ? xs.filter((x) => x !== a) : [...xs, a]))}>{a}</button>
              ))}
            </div>
          </section>

          <section className="tarjeta">
            <h2 className="sec-tit">Empaque y vida útil</h2>
            <label className="mt-0" htmlFor="empaque">Método de empaque</label>
            <input id="empaque" value={empaque} onChange={(e) => setEmpaque(e.target.value)} placeholder="Bolsa de vacío, frasco hermético…" />

            <label>Presentaciones <span className="ayuda">en qué porciones se guarda lo que sale de una tanda</span></label>
            {pres.length === 0 && <div className="suave" style={{ fontSize: '.85rem', marginBottom: '.4rem' }}>
              Sin presentaciones: se guarda todo junto. Agregue una por cada forma de porcionar (p. ej. 200 {ub} y 150 {ub}, o 22 porciones de 3 tapas).</div>}
            {pres.map((p, i) => (
              <div key={p.clave} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '.4rem', padding: '.5rem 0', borderBottom: '1px solid var(--borde)' }}>
                <label className="campo">Cada una lleva ({ub})
                  <input inputMode="decimal" value={p.contenido} onChange={(e) => ponerPres(p.clave, { contenido: e.target.value })} placeholder="200" />
                </label>
                <label className="campo">Qué lleva
                  <input value={p.detalle} maxLength={120} onChange={(e) => ponerPres(p.clave, { detalle: e.target.value })} placeholder="3 tapas, porción individual…" />
                </label>
                <label className="campo">Salen por tanda <span className="ayuda">si es fijo</span>
                  <input inputMode="numeric" value={p.por_tanda} onChange={(e) => ponerPres(p.clave, { por_tanda: e.target.value })} placeholder="22" />
                </label>
                <label className="campo">Empaque <span className="ayuda">si es otro</span>
                  <input value={p.empaque} maxLength={120} onChange={(e) => ponerPres(p.clave, { empaque: e.target.value })} placeholder={empaque || 'Bolsa de vacío…'} />
                </label>
                <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.4rem' }}>
                  <span className="suave texto-mini">Presentación {i + 1}</span>
                  <button type="button" className="secundario chico" onClick={() => setPres((xs) => xs.filter((x) => x.clave !== p.clave))} aria-label={`Quitar presentación ${i + 1}`}>Quitar</button>
                </div>
              </div>
            ))}
            {(() => {
              const fijas = pres.filter((p) => num(p.contenido) && num(p.por_tanda));
              const suma = fijas.reduce((t, p) => t + num(p.contenido)! * num(p.por_tanda)!, 0);
              const n = num(neto);
              return fijas.length > 0 && n ? (
                <div className={suma > n * 1.02 ? 'aviso' : 'suave'} style={{ fontSize: '.85rem', margin: '.4rem 0 0', padding: suma > n * 1.02 ? '.4rem .6rem' : 0 }}>
                  Las porciones fijas suman {cant(suma)} {ub} de {cant(n)} {ub} por tanda{suma > n * 1.02 ? ': pesan más que la tanda.' : suma < n ? ` · quedan ${cant(n - suma)} ${ub} para las demás.` : '.'}
                </div>) : null;
            })()}
            <button type="button" className="secundario chico mt-2"
                    onClick={() => setPres((xs) => [...xs, { clave: crypto.randomUUID(), contenido: '', detalle: '', por_tanda: '', empaque: '' }])}>+ Presentación</button>

            <label>Vida útil según dónde se guarde</label>
            {alm.map((a, i) => (
              <div key={a.conservacion} style={{ display: 'grid', gridTemplateColumns: 'auto 90px minmax(0, 1fr) auto', gap: '.4rem', alignItems: 'center', marginBottom: '.4rem' }}>
                <strong>{a.conservacion}</strong>
                <input inputMode="numeric" value={a.dias} aria-label={`Días en ${a.conservacion}`} placeholder="días"
                       onChange={(e) => setAlm((xs) => xs.map((x, j) => (j === i ? { ...x, dias: e.target.value } : x)))} />
                <input value={a.nota} aria-label={`Nota de ${a.conservacion}`} placeholder="2-5 °C…"
                       onChange={(e) => setAlm((xs) => xs.map((x, j) => (j === i ? { ...x, nota: e.target.value } : x)))} />
                <button type="button" className="secundario chico" onClick={() => setAlm((xs) => xs.filter((_, j) => j !== i))} aria-label={`Quitar ${a.conservacion}`}>×</button>
              </div>
            ))}
            <div className="chips-sel">
              {CONSERVACIONES.filter((c) => !alm.some((a) => a.conservacion === c)).map((c) => (
                <button key={c} type="button" onClick={() => setAlm((xs) => [...xs, { conservacion: c, dias: '', nota: '' }])}>+ {c}</button>
              ))}
            </div>
          </section>

          {(sug.almac.length > 0 || sug.emp || sug.obs.length > 0) && (
            <section className="tarjeta" style={{ borderStyle: 'dashed' }}>
              <h2 className="sec-tit">Anotado antes de la app · úselo si sirve</h2>
              <ul className="renglones">
                {sug.almac.map((s) => (
                  <li key={s.c}><span>{s.c} {s.dias} días <span className="suave">· de {s.de}</span></span>
                    <button type="button" className="secundario mini" onClick={() => setAlm((xs) => [...xs, { conservacion: s.c, dias: String(s.dias), nota: s.nota }])}>Usar</button></li>
                ))}
                {sug.emp && <li><span>Empaque: {sug.emp.empaque} <span className="suave">· {sug.emp.codigo}</span></span>
                  <button type="button" className="secundario mini" onClick={() => setEmpaque(sug.emp!.empaque!)}>Usar</button></li>}
                {sug.obs.map((l) => (
                  <li key={l.codigo}><span className="min-0">«{l.observaciones}» <span className="suave">· {l.codigo}</span></span>
                    <button type="button" className="secundario mini" onClick={() => setPuntos((ps) => [...ps, { tipo: 'OTRO', texto: l.observaciones!.slice(0, 400) }])}>A punto crítico</button></li>
                ))}
              </ul>
            </section>
          )}

          <section className="tarjeta">
            <h2 className="sec-tit">Observaciones</h2>
            <textarea rows={3} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} aria-label="Observaciones"
                      placeholder="Porción de servicio, aprovechamiento de recortes, proveedor preferido…" />
            {nota && <>
              <label htmlFor="nota">Nota interna <span className="ayuda">de dónde salió el neto, pendientes</span></label>
              <textarea id="nota" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} />
            </>}
          </section>
        </div>
      </div>

      {resultado && (
        resultado.ok
          ? <div className="exito" role="status"><strong>Ficha guardada.</strong>{resultado.avisos.length > 0 && <ul>{resultado.avisos.map((m) => <li key={m}>{m}</li>)}</ul>}</div>
          : <div className="error" role="alert"><strong>No se guardó:</strong><ul>{[...resultado.fatales, ...resultado.avisos].map((m) => <li key={m}>{m}</li>)}</ul></div>
      )}
      <div className="acciones barra-guardar" style={{ alignItems: 'flex-end' }}>
        {f && !receta && (
          <label style={{ margin: 0, flex: '1 1 260px' }}>Qué cambiaste
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Más azúcar, nuevo proveedor de limón…" maxLength={300} />
          </label>
        )}
        <Link className="boton secundario" href={destino}>Cancelar</Link>
        <button type="button" disabled={enviando || !codigo.trim() || !lineas.length || (!!f && !receta && !motivo.trim()) || faltaNeto} onClick={guardar}>
          {enviando ? 'Guardando…' : receta ? 'Aprobar como ficha' : f ? `Guardar versión ${f.version + 1}` : 'Crear ficha'}
        </button>
        {faltaNeto && <span className="suave" style={{ fontSize: '.85rem', alignSelf: 'center' }}>Falta el neto esperado en {ub}: pese una tanda terminada.</span>}
        {pendientes > 0 && <span className="suave" style={{ fontSize: '.85rem', alignSelf: 'center' }}>{pendientes} línea(s) por completar: se puede guardar igual.</span>}
      </div>
    </>
  );
}
