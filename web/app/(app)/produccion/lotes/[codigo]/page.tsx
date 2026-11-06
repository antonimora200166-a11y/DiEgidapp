import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { pesos } from '@/lib/fichas';
import { ESTADO_LOTE } from '@/lib/lotes';
import PestanasProduccion from '@/components/PestanasProduccion';

export const metadata = { title: 'Lote' };

type Origen = { cantidad: number; tipo: 'RECEPCION' | 'LOTE' | 'SALDO_INICIAL' | 'AJUSTE' | 'TRASLADO' | 'OTRO' | null; fecha: string | null; vence: string | null;
                documento_id: string | null; codigo: string | null; proveedor: string | null; documento: string | null; lote_proveedor: string | null;
                mpi: string | null; cadena: Insumo[] | null };
type Insumo = { linea: number; producto: string; presentacion: string; tipo: string; unidad_base: string; cantidad_base: number; gramos: number | null;
                costo: number | null; costo_unitario: number | null; zona: string | null; origenes: Origen[] };
type Destino = { tipo: string; fecha: string; cantidad: number; zona: string | null; documento_tipo: string; documento_id: string | null; codigo: string | null;
                 detalle: string | null; reversado: boolean; cadena: Destino[] | null };
type Lote = Record<string, unknown> & { codigo: string; mpi: string; unidad_base: string; estado: keyof typeof ESTADO_LOTE };
type Traza = { origen: 'APP' | 'SGI-COSTOS'; lote: Lote; atras: Insumo[] | HistInsumo[]; adelante: Destino[] | HistDestino[]; sin_partida?: number };
type HistInsumo = { linea: number; producto: string; tipo: string; cantidad: number | null; unidad: string; merma: number | null; costo: number | null;
                    costo_unitario: number | null; fuente_costo: string | null; lote_origen: string | null };
type HistDestino = { codigo: string; fecha: string; mpi: string; cantidad: number | null; unidad: string };

const num = (x: unknown, d = 0) => (x === null || x === undefined ? '—' : Number(x).toLocaleString('es-CO', { maximumFractionDigits: d }));
const fecha = (d: unknown) => (d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const CAUSA: Record<string, string> = { VENCIDO: 'vencido', DANADO: 'dañado', DERRAME: 'derrame', MAL_ESTADO: 'mal estado', OTRO: 'otro' };
const TIPO_DESTINO: Record<string, string> = { SALIDA_A_PRODUCCION: 'Producción', SALIDA_BAJA: 'Baja', TRASLADO_SALIDA: 'Traslado', AJUSTE_CONTEO_NEGATIVO: 'Ajuste de conteo', SALIDA_VENTA: 'Venta' };

// De dónde salió un insumo: recepción (proveedor) → 1 toque; otro lote → su cadena, plegada
function Origenes({ o, ub }: { o: Origen[]; ub: string }) {
  if (!o.length) return <div className="suave" style={{ fontSize: '.85rem' }}>Sin costo: no sale del kardex.</div>;
  return <div className="traza">
    {o.map((x, i) => (
      <div key={i} className="nodo-traza">
        {x.tipo === 'RECEPCION' && x.documento_id ? (
          <Link href={`/historial/recepcion/${x.documento_id}`} className="enlace-traza">
            <span><strong>{x.proveedor ?? 'Proveedor'}</strong> · <span className="cod">{x.codigo}</span>
              <span className="suave" style={{ display: 'block', fontSize: '.8rem' }}>Recepción del {fecha(x.fecha)}{x.documento ? ` · factura ${x.documento}` : ''}{x.lote_proveedor ? ` · lote ${x.lote_proveedor}` : ''}{x.vence ? ` · vence ${fecha(x.vence)}` : ''}</span></span>
            <span className="n">{num(x.cantidad, 1)} {ub} ›</span>
          </Link>
        ) : x.tipo === 'LOTE' && x.codigo ? (
          <details>
            <summary className="enlace-traza">
              <span><strong>{x.mpi}</strong> · <span className="cod">{x.codigo}</span> <span className="pill info">MPI</span>
                <span className="suave" style={{ display: 'block', fontSize: '.8rem' }}>Lote del {fecha(x.fecha)} · toca para ver de dónde salió · <Link href={`/produccion/lotes/${encodeURIComponent(x.codigo)}`}>abrir</Link></span></span>
              <span className="n">{num(x.cantidad, 1)} {ub}</span>
            </summary>
            {x.cadena && <div className="hijos-traza"><Atras insumos={x.cadena} /></div>}
          </details>
        ) : (
          <div className="enlace-traza">
            <span>{x.tipo === 'SALDO_INICIAL' ? <>Conteo inicial <span className="cod">{x.codigo}</span></> : x.tipo === 'AJUSTE' ? <>Ajuste de conteo <span className="cod">{x.codigo}</span></>
              : x.tipo === null ? <span style={{ color: 'var(--aviso)' }}>Sin origen registrado (había menos en el kardex)</span> : 'Otro origen'}
              {x.fecha && <span className="suave" style={{ display: 'block', fontSize: '.8rem' }}>{fecha(x.fecha)}</span>}</span>
            <span className="n">{num(x.cantidad, 1)} {ub}</span>
          </div>
        )}
      </div>
    ))}
  </div>;
}

function Atras({ insumos }: { insumos: Insumo[] }) {
  return <ul className="renglones">
    {insumos.map((i) => (
      <li key={i.linea} style={{ display: 'block' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.6rem' }}>
          <span><strong>{i.producto}</strong>{i.presentacion && <span className="suave"> · {i.presentacion}</span>}
            {i.zona && <span className="suave" style={{ display: 'block', fontSize: '.8rem' }}>de {i.zona}</span>}</span>
          <span className="n"><strong>{i.gramos ? `${num(i.gramos)} g` : `${num(i.cantidad_base, 1)} ${i.unidad_base}`}</strong>
            <span className="suave" style={{ display: 'block', fontSize: '.8rem' }}>{i.tipo === 'SIN_COSTO' ? 'sin costo' : i.costo !== null ? `${pesos(i.costo)} · ${pesos(i.costo_unitario, 2)}/${i.unidad_base}` : 'sin costo en el kardex'}</span></span>
        </div>
        <Origenes o={i.origenes} ub={i.unidad_base} />
      </li>
    ))}
  </ul>;
}

function Adelante({ d, ub }: { d: Destino[]; ub: string }) {
  return <ul className="renglones">
    {d.map((x, i) => (
      <li key={i} style={{ display: 'block', opacity: x.reversado ? 0.55 : 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.6rem' }}>
          <span>
            <span className={`pill ${x.tipo === 'SALIDA_BAJA' ? 'error' : x.tipo === 'SALIDA_A_PRODUCCION' ? 'info' : 'gris'}`}>{TIPO_DESTINO[x.tipo] ?? x.tipo}</span>{' '}
            {x.documento_tipo === 'LOTE' && x.codigo ? <Link href={`/produccion/lotes/${encodeURIComponent(x.codigo)}`}><strong>{x.detalle}</strong> <span className="cod">{x.codigo}</span></Link>
              : x.documento_id && ['BAJA', 'TRASLADO', 'CONTEO'].includes(x.documento_tipo)
                ? <Link href={`/historial/${x.documento_tipo.toLowerCase()}/${x.documento_id}`}><span className="cod">{x.codigo}</span>{x.detalle ? ` · ${CAUSA[x.detalle] ?? x.detalle}` : ''}</Link>
                : <span>{x.detalle ?? x.codigo ?? ''}</span>}
            <span className="suave" style={{ display: 'block', fontSize: '.8rem' }}>{fecha(x.fecha)}{x.zona ? ` · ${x.zona}` : ''}{x.reversado ? ' · reversado' : ''}</span>
          </span>
          <span className="n">{num(x.cantidad, 1)} {ub}</span>
        </div>
        {x.cadena && x.cadena.length > 0 && <div className="hijos-traza"><Adelante d={x.cadena} ub="" /></div>}
      </li>
    ))}
  </ul>;
}

export default async function DetalleLote({ params }: { params: Promise<{ codigo: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio') redirect('/');
  const { codigo } = await params;
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('traza_lote', { p_codigo: decodeURIComponent(codigo) });
  if (error) throw new Error(error.message);
  if (!data) notFound();
  const t = data as Traza;
  const l = t.lote;
  const ub = l.unidad_base;
  const est = ESTADO_LOTE[l.estado];
  const app = t.origen === 'APP';
  const desvio = l.desvio_pp as number | null;

  return (
    <>
      <PestanasProduccion activa="lotes" area={String(l.area)} />
      <p className="pagina-ancha" style={{ margin: '0 0 .3rem' }}><Link href={`/produccion/lotes?area=${l.area}`}>← Lotes</Link></p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.75rem', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.9rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>{l.mpi}</h1>
          <span className="cod">{l.codigo} · {fecha(l.fecha)}{app ? ` · ${l.responsable}` : ' · SGI-COSTOS'}{l.zona ? ` · ${l.zona}` : ''}</span>
          {app && <div className="suave" style={{ fontSize: '.82rem' }}>Registró {String(l.usuario ?? '—')}{l.registrado_en ? ` el ${new Date(String(l.registrado_en)).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
            {l.ficha ? <> · ficha <Link href={`/fichas/${l.generico_id}${l.ficha_id ? `?v=${l.ficha_id}` : ''}`}>{String(l.ficha)}</Link></> : ' · sin ficha'}</div>}
        </div>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span className={`pill ${est.c}`} style={{ fontSize: '.95rem', padding: '.3rem .8rem' }}>{est.t}</span>
          {app && <Link className="boton secundario" href={`/l/${encodeURIComponent(l.codigo)}/etiqueta`}>Etiqueta</Link>}
          {app && l.estado !== 'REVERSADO' && <Link className="boton secundario" href={`/historial/lote/${l.id}`}>Reversar</Link>}
        </div>
      </div>

      <div className="cifras">
        <div className="cifra"><span>Entrada</span><b>{num(l.entrada_g)}</b><small>g</small></div>
        <div className="cifra"><span>Neto</span><b>{num(l.neto_g)}</b><small>g</small></div>
        <div className="cifra"><span>Merma</span><b>{num(l.merma_g)}</b><small>g</small></div>
        <div className="cifra"><span>Rendimiento</span><b>{l.rendimiento ? `${num(Number(l.rendimiento) * 100, 1)} %` : '—'}</b>
          {desvio !== null && desvio !== undefined && <small>{desvio > 0 ? '+' : ''}{num(desvio, 1)} pp vs ficha</small>}</div>
        <div className={`cifra${l.estado_costo !== 'COMPLETO' ? ' alerta' : ''}`}><span>Costo</span><b>{pesos(l.costo_total as number | null)}</b>
          <small>{l.estado_costo === 'COMPLETO' ? `${pesos(l.costo_unitario as number | null, 2)}/${app ? ub : 'g'}` : 'parcial'}</small></div>
        <div className="cifra"><span>Vence</span><b>{l.vence ? fecha(l.vence) : '—'}</b>{l.conservacion ? <small>{String(l.conservacion)}</small> : null}</div>
        {app && <div className="cifra"><span>Queda</span><b>{num(l.restante, 1)}</b><small>{ub}</small></div>}
      </div>
      {Array.isArray(l.avisos) && (l.avisos as string[]).length > 0 && <div className="aviso pagina-ancha"><ul style={{ margin: 0 }}>{(l.avisos as string[]).map((a) => <li key={a}>{a}</li>)}</ul></div>}
      {Boolean(l.observaciones) && <p className="suave pagina-ancha">Observaciones: {String(l.observaciones)}</p>}

      <div className="dos-col pagina-ancha">
        <section className="tarjeta">
          <h2 className="sec-tit">Hacia atrás · de dónde salió cada insumo</h2>
          {app ? (
            <>
              <Atras insumos={t.atras as Insumo[]} />
              {Number(t.sin_partida) > 0 && <p className="aviso" style={{ marginBottom: 0 }}>Parte de lo consumido no tenía origen en el kardex (se produjo con menos existencia registrada).</p>}
            </>
          ) : (
            <ul className="renglones">
              {(t.atras as HistInsumo[]).map((i) => (
                <li key={i.linea}>
                  <span><strong>{i.producto}</strong>
                    {i.lote_origen && <span style={{ display: 'block', fontSize: '.85rem' }}>del lote <Link href={`/produccion/lotes/${encodeURIComponent(i.lote_origen)}`} className="cod">{i.lote_origen}</Link></span>}
                    {i.fuente_costo && <span className="suave" style={{ display: 'block', fontSize: '.78rem' }}>costo: {i.fuente_costo.toLowerCase()}</span>}</span>
                  <span className="n"><strong>{num(i.cantidad, 1)} {i.unidad}</strong><span className="suave" style={{ display: 'block', fontSize: '.8rem' }}>{pesos(i.costo)}</span></span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="tarjeta">
          <h2 className="sec-tit">Hacia adelante · en qué se usó</h2>
          {(t.adelante as unknown[]).length === 0 ? <div className="vacio">Todavía no se ha usado en nada.{app ? '' : ' (según el registro de SGI-COSTOS)'}</div>
            : app ? <Adelante d={t.adelante as Destino[]} ub={ub} />
            : <ul className="renglones">{(t.adelante as HistDestino[]).map((x) => (
                <li key={x.codigo}><span><Link href={`/produccion/lotes/${encodeURIComponent(x.codigo)}`}><strong>{x.mpi}</strong> <span className="cod">{x.codigo}</span></Link>
                  <span className="suave" style={{ display: 'block', fontSize: '.8rem' }}>{fecha(x.fecha)}</span></span>
                  <span className="n">{num(x.cantidad, 1)} {x.unidad}</span></li>))}</ul>}
          {app && <p className="suave" style={{ fontSize: '.8rem', margin: '.6rem 0 0' }}>Los cócteles y platos vendidos aparecerán aquí cuando se conecte el punto de venta.</p>}
        </section>
      </div>
    </>
  );
}
