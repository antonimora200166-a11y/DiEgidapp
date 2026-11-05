import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { puedeOperar } from '@/lib/roles';
import { cant, fechaLarga, pct, pesos, tipoPunto } from '@/lib/fichas';
import PestanasProduccion from '@/components/PestanasProduccion';
import type { DatosFicha } from './EditorFicha';

export const metadata = { title: 'Ficha técnica' };
const TIPO: Record<string, string> = { MPI: 'Producción (MPI)', BEBIDA: 'Cóctel o bebida', PLATO: 'Plato' };

// Consulta de una ficha: lo que necesita quien la revisa o la va a preparar, en una pantalla.
// ?v=<id> muestra una versión anterior (la receta con que se hicieron lotes viejos).
export default async function Ficha({ params, searchParams }: { params: Promise<{ generico: string }>; searchParams: Promise<{ v?: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio') redirect('/');
  const { generico } = await params;
  const { v } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(generico) || (v && !/^[0-9a-f-]{36}$/.test(v))) notFound();
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('ficha_para_editar', { p_generico: generico, p_ficha: v ?? null });
  if (error) { if (/Solo los MPI|no es de/.test(error.message)) notFound(); throw new Error(error.message); }
  const d = data as DatosFicha;
  const r = d.resultado;
  const f = d.ficha;
  const ub = r.unidad_base;
  const esMpi = r.tipo === 'MPI';
  const volver = esMpi ? `/produccion?area=${r.area}` : '/fichas';

  const faltan = d.lineas.filter((l) => l.falta);
  const total = d.lineas.reduce((t, l) => t + Number(l.costo ?? 0), 0);
  const entrada = d.lineas.every((l) => l.cantidad_base !== null) ? d.lineas.reduce((t, l) => t + Number(l.cantidad_base), 0) : null;
  const neto = f?.neto_esperado ? Number(f.neto_esperado) : null;
  const rend = neto && entrada ? neto / entrada : null;
  const estimado = d.lineas.some((l) => l.estimado);
  const completa = d.lineas.length > 0 && faltan.length === 0;

  return (
    <>
      {esMpi && <PestanasProduccion activa="fichas" area={r.area} />}
      <p style={{ margin: '0 0 .3rem' }}><Link href={volver}>← {esMpi ? 'Fichas de producción' : 'Fichas técnicas'}</Link></p>

      {f && !d.es_vigente && (
        <p className="aviso">Estás viendo la <strong>versión {f.version}</strong>
          {f.vigente_hasta && <>, que rigió hasta el {fechaLarga(f.vigente_hasta)}</>}. Los lotes hechos con ella conservan esta receta.{' '}
          <Link href={`/fichas/${r.id}`}>Ver la vigente</Link></p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.75rem', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.9rem' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0 }}>{r.nombre}</h1>
          <span className="cod">{r.codigo}{f ? ` · ficha ${f.codigo} · v${f.version} desde ${fechaLarga(f.vigente_desde)}` : ''} · {r.area === 'BAR' ? 'Bar' : 'Cocina'} · {TIPO[r.tipo]}</span>
          {f && <div className="suave" style={{ fontSize: '.82rem' }}>
            {f.origen === 'APP' ? `Escrita en la app${f.creado_por ? ` por ${f.creado_por}` : ''}` : `Cargada de ${f.origen}`}
            {f.motivo_cambio && <> · Cambio: {f.motivo_cambio}</>}
          </div>}
        </div>
        {d.es_vigente && (
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            {d.puede_editar && <Link className="boton secundario" href={`/fichas/${r.id}/editar`}>{f ? 'Editar' : 'Crear ficha'}</Link>}
            {esMpi && f && puedeOperar(perfil, r.area) && <Link className="boton" href={`/producir?area=${r.area}&generico=${r.id}`}>Producir esta ficha</Link>}
          </div>
        )}
      </div>

      {!f ? (
        <div className="vacio">{r.nombre} aún no tiene ficha técnica.{d.puede_editar ? ' Créala con el botón de arriba.' : ` La crea el ${r.area === 'BAR' ? 'jefe de barra' : 'chef'}.`}</div>
      ) : (
        <>
          <div className="cifras">
            {esMpi && <div className="cifra"><span>Rendimiento</span><b>{pct(rend)}</b><small>{entrada ? `de ${cant(entrada)} ${ub}` : 'sin calcular'}</small></div>}
            <div className="cifra"><span>{esMpi ? 'Neto esperado' : 'Rinde'}</span><b>{neto ? cant(neto) : '—'}</b><small>{neto ? `${ub} por tanda` : 'falta el neto'}</small></div>
            <div className="cifra"><span>Costo {esMpi ? 'tanda' : 'receta'}</span><b>{completa ? pesos(total) : '—'}</b><small>{completa ? (estimado ? 'estimado' : 'kardex') : 'incompleto'}</small></div>
            {esMpi && <div className="cifra"><span>Costo / {ub}</span><b>{completa && neto ? pesos(total / neto, 2) : '—'}</b></div>}
            {f.tiempo_min && <div className="cifra"><span>Tiempo</span><b>{f.tiempo_min >= 120 ? `${cant(f.tiempo_min / 60)} h` : `${f.tiempo_min} min`}</b></div>}
            {f.porciones && <div className="cifra"><span>Porciones</span><b>{cant(f.porciones)}</b></div>}
          </div>
          {faltan.length > 0 && (
            <div className="aviso"><strong>A la ficha le falta para costear:</strong>
              <ul>{faltan.map((l) => <li key={l.generico_id + l.falta}>{l.falta}</li>)}</ul></div>
          )}

          <div className="dos-col pagina-ancha">
            <div className="pila">
              <section className="tarjeta">
                <h2 className="sec-tit">Ingredientes por tanda</h2>
                <ul className="renglones">
                  {d.lineas.map((l, i) => (
                    <li key={i}>
                      <span style={{ minWidth: 0 }}>
                        {l.tipo === 'MPI'
                          ? <Link href={`/fichas/${l.generico_id}`}><strong>{l.generico}</strong></Link>
                          : <strong>{l.generico}</strong>}
                        {l.nota && <span className="suave" style={{ display: 'block', fontSize: '.82rem' }}>{l.nota}</span>}
                      </span>
                      <span className="n">
                        <strong>{cant(l.cantidad)} {l.unidad}</strong>
                        <span className="suave" style={{ display: 'block', fontSize: '.8rem' }}>
                          {l.tipo === 'SIN_COSTO' ? 'sin costo'
                            : l.costo !== null && l.costo_unitario !== null ? `${pesos(l.costo_unitario, 2)}/${l.unidad_base} = ${pesos(l.costo)}${l.estimado ? ' *' : ''}`
                            : 'sin costo vigente'}
                        </span>
                      </span>
                    </li>
                  ))}
                  {entrada !== null && <li><strong>Entrada total</strong><strong className="n">{cant(entrada)} {ub}</strong></li>}
                </ul>
                {estimado && <p className="suave" style={{ fontSize: '.8rem', margin: '.4rem 0 0' }}>* Estimado: el insumo aún no tiene kardex y usa su precio de referencia.</p>}
              </section>

              <section className="tarjeta">
                <h2 className="sec-tit">Procedimiento{f.metodo ? ` · ${f.metodo}` : ''}</h2>
                {f.procedimiento.length
                  ? <ol className="pasos-ficha">{f.procedimiento.map((p, i) => <li key={i}>{p}</li>)}</ol>
                  : <div className="vacio">Aún no hay pasos escritos.{d.puede_editar && d.es_vigente ? ' Agrégalos en Editar.' : ''}</div>}
              </section>

              {(f.descripcion || f.presentacion) && (
                <section className="tarjeta">
                  {f.descripcion && <><h2 className="sec-tit">Descripción</h2><p style={{ marginTop: 0 }}>{f.descripcion}</p></>}
                  {f.presentacion && <><h2 className="sec-tit">Presentación</h2><p style={{ margin: 0 }}>{f.presentacion}</p></>}
                </section>
              )}
            </div>

            <div className="pila">
              <section className="tarjeta">
                <h2 className="sec-tit">Puntos críticos</h2>
                {d.puntos.length
                  ? d.puntos.map((p, i) => <div key={i} className="punto"><span className={`pill ${tipoPunto(p.tipo).c}`}>{tipoPunto(p.tipo).t}</span><span>{p.texto}</span></div>)
                  : <div className="aviso" style={{ margin: 0 }}><strong>Ficha sin puntos críticos</strong>
                      <div>Antes de producir no se mostrará ninguna indicación.{d.puede_editar && d.es_vigente ? ' Complétalos en Editar.' : ''}</div></div>}
                <div className="punto"><span className="pill aviso">Alérgenos</span>
                  <span>{f.alergenos.length ? f.alergenos.join(', ') : <span className="suave">Ninguno declarado</span>}</span></div>
              </section>

              <section className="tarjeta">
                <h2 className="sec-tit">Empaque y almacenamiento</h2>
                <ul className="renglones">
                  <li><span>Empaque</span><strong>{f.empaque ?? '—'}</strong></li>
                  {d.almacenamientos.length
                    ? d.almacenamientos.map((a) => (
                        <li key={a.conservacion}><span>{a.conservacion}{a.nota ? <span className="suave"> · {a.nota}</span> : ''}</span>
                          <strong className="n">{a.vida_util_dias} {a.vida_util_dias === 1 ? 'día' : 'días'}</strong></li>))
                    : <li><span>Vida útil</span><span className="suave">sin definir: los lotes no tendrán vencimiento</span></li>}
                </ul>
              </section>

              {(f.observaciones || f.nota) && (
                <section className="tarjeta">
                  <h2 className="sec-tit">Observaciones</h2>
                  {f.observaciones && <p style={{ marginTop: 0 }}>{f.observaciones}</p>}
                  {f.nota && <p className="suave" style={{ margin: 0, fontSize: '.88rem' }}>{f.nota}</p>}
                </section>
              )}

              <section className="tarjeta">
                <h2 className="sec-tit">Versiones</h2>
                <ul className="renglones">
                  {d.versiones.map((x) => (
                    <li key={x.id}>
                      <span style={{ minWidth: 0 }}>
                        {x.id === f.id ? <strong>v{x.version}</strong> : <Link href={`/fichas/${r.id}?v=${x.id}`}>v{x.version}</Link>}
                        {' · '}{fechaLarga(x.vigente_desde)}{x.motivo_cambio ? ` · ${x.motivo_cambio}` : x.origen !== 'APP' ? ` · ${x.origen}` : ''}
                        {x.creado_por && <span className="suave" style={{ display: 'block', fontSize: '.8rem' }}>{x.creado_por}</span>}
                      </span>
                      <span className="n">
                        {x.vigente_hasta === null ? <span className="pill ok">vigente</span> : <span className="pill gris">reemplazada</span>}
                        {Number(x.lotes) > 0 && <span className="suave" style={{ display: 'block', fontSize: '.8rem' }}>{x.lotes} lote(s)</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </>
      )}
    </>
  );
}
