import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import Exportar from '../Exportar';
import PestanasConsulta from '@/components/PestanasConsulta';
import FiltroConsulta, { periodos, hoyCali } from '@/components/FiltroConsulta';
import { pesos as fmtPesos, fecha as corta } from '@/lib/formato';
const pesos = (n: unknown) => fmtPesos(n as number | null);

export const metadata = { title: 'Consulta · Operación' };

type Bloque = 'inventario' | 'compras' | 'produccion' | 'perdidas';
const BLOQUES: { v: Bloque; t: string }[] = [
  { v: 'inventario', t: 'Inventario' }, { v: 'compras', t: 'Compras' }, { v: 'produccion', t: 'Producción' }, { v: 'perdidas', t: 'Pérdidas' },
];
const RPC: Record<Bloque, string> = { inventario: 'consulta_inventario', compras: 'consulta_compras', produccion: 'consulta_produccion', perdidas: 'consulta_perdidas' };
const CAUSA: Record<string, string> = { VENCIDO: 'Vencido', DANADO: 'Dañado', DERRAME: 'Derrame', MAL_ESTADO: 'Mal estado', OTRO: 'Otro', CORTESIA: 'Cortesía', MAL_HECHO: 'Mal hecho' };
const HALLAZGO: Record<string, string> = { H03: 'sin precio', H09: 'cantidad dudosa', H12: 'precio fuera de banda' };

const pesos2 = (n: unknown) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const num = (n: unknown, d = 0) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: d }));
type Fila = Record<string, unknown>;
const D = 'right' as const;

function Tabla({ cols, filas, vacio }: { cols: { t: string; v: (f: Fila) => React.ReactNode; der?: boolean }[]; filas: Fila[]; vacio: string }) {
  if (!filas.length) return <p className="suave">{vacio}</p>;
  return (
    <div className="desborde tarjeta p-0">
      <table className="tabla">
        <thead><tr>{cols.map((c) => <th key={c.t} style={c.der ? { textAlign: D } : undefined}>{c.t}</th>)}</tr></thead>
        <tbody>{filas.map((f, i) => <tr key={i}>{cols.map((c) => <td key={c.t} style={c.der ? { textAlign: D, whiteSpace: 'nowrap' } : undefined}>{c.v(f)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Barras({ filas, etiqueta, valor }: { filas: Fila[]; etiqueta: (f: Fila) => string; valor: (f: Fila) => number }) {
  const max = Math.max(1, ...filas.map(valor));
  return (
    <div style={{ display: 'grid', gap: '.3rem' }}>
      {filas.map((f, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 9rem) 1fr auto', gap: '.5rem', alignItems: 'center', fontSize: '.88rem' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{etiqueta(f)}</span>
          <span style={{ height: 12, borderRadius: 3, background: 'var(--marca)', width: `${Math.max(2, (valor(f) / max) * 100)}%`, opacity: i ? 0.65 : 1 }} />
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{pesos(valor(f))}</span>
        </div>
      ))}
    </div>
  );
}

export default async function Operacion({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; area?: string; bloque?: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol !== 'admin') redirect('/');
  const sp = await searchParams;
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const hace = (n: number) => { const d = new Date(hoy + 'T12:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const valida = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  const desde = valida(sp.desde) ?? hace(29), hasta = valida(sp.hasta) ?? hoy;
  const area = sp.area === 'BAR' || sp.area === 'COCINA' ? sp.area : 'TODO';
  const bloque: Bloque = BLOQUES.some((b) => b.v === sp.bloque) ? (sp.bloque as Bloque) : 'inventario';
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc(RPC[bloque], { p_area: area === 'TODO' ? null : area, p_desde: desde, p_hasta: hasta });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Record<string, unknown>;
  const lista = (k: string) => (d[k] ?? []) as Fila[];

  return (
    <>
      <h1 className="pagina-ancha titulo-gestion">Consulta</h1>
      <FiltroConsulta ruta="/consulta/operacion" desde={desde} hasta={hasta} area={area} fijos={{ bloque }}
                      opciones={[{ t: 'Últimos 30 días', desde: hace(29), hasta: hoy }, ...periodos(hoyCali())]} />
      <PestanasConsulta activa={bloque} desde={desde} hasta={hasta} area={area} />
      <Exportar params={{ desde, hasta, area }} bloques={[{ bloque: 'inventario', t: 'Inventario' }, { bloque: 'compras', t: 'Compras' }, { bloque: 'produccion', t: 'Producción' }, { bloque: 'perdidas', t: 'Pérdidas' }]} />

      {bloque === 'inventario' && (
        <>
          <div className="cifras anchas">
            <div className="cifra"><span>Valor del inventario</span><b>{pesos(d.valor_total)}</b><small>hoy, con el costo promedio</small></div>
            <div className="cifra"><span>Inmovilizado</span><b>{pesos(d.inmovilizado)}</b><small>sin movimiento en 30 días</small></div>
            <div className={`cifra${lista('bajo_minimo').length ? ' sa' : ''}`}><span>Bajo mínimo</span><b>{lista('bajo_minimo').length}</b><small>productos</small></div>
            <div className={`cifra${lista('por_vencer').length ? ' sr' : ''}`}><span>MPI por vencer</span><b>{lista('por_vencer').length}</b><small>lotes con saldo</small></div>
          </div>
          {!Number(d.valor_total) && <p className="aviso">Todavía no hay kardex: el inventario se llena con el conteo inicial.</p>}
          <div className="dos-col pagina-ancha">
            <section><h2>Por zona</h2><Barras filas={lista('por_zona')} etiqueta={(f) => String(f.zona)} valor={(f) => Number(f.valor)} /></section>
            <section><h2>Rotación por categoría</h2>
              <Tabla vacio="Sin datos." filas={lista('por_categoria')} cols={[
                { t: 'Categoría', v: (f) => String(f.categoria) }, { t: 'Valor', der: true, v: (f) => pesos(f.valor) },
                { t: 'Consumo', der: true, v: (f) => pesos(f.consumo) }, { t: 'Rotación', der: true, v: (f) => num(f.rotacion, 2) },
                { t: 'Días', der: true, v: (f) => num(f.dias) }]} /></section>
          </div>
          <h2>Bajo mínimo</h2>
          <Tabla vacio="Nada bajo el mínimo." filas={lista('bajo_minimo')} cols={[
            { t: 'Producto', v: (f) => String(f.nombre) }, { t: 'Hay', der: true, v: (f) => `${num(f.saldo, 1)} ${f.unidad}` }, { t: 'Mínimo', der: true, v: (f) => num(f.minimo) }]} />
          <h2>Sin movimiento en 30 días</h2>
          <Tabla vacio="Todo se movió en los últimos 30 días." filas={lista('sin_movimiento').slice(0, 20)} cols={[
            { t: 'Producto', v: (f) => String(f.nombre) }, { t: 'Último movimiento', v: (f) => (f.ultimo ? corta(String(f.ultimo)) : '—') }, { t: 'Valor', der: true, v: (f) => pesos(f.valor) }]} />
          <h2>MPI por vencer</h2>
          <Tabla vacio="Ningún lote por vencer." filas={lista('por_vencer')} cols={[
            { t: 'Lote', v: (f) => <Link href={`/produccion/lotes/${encodeURIComponent(String(f.codigo))}`} className="cod">{String(f.codigo)}</Link> },
            { t: 'MPI', v: (f) => String(f.mpi) }, { t: 'Vence', v: (f) => corta(String(f.vence)) }, { t: 'Queda', der: true, v: (f) => `${num(f.restante, 1)} ${f.unidad}` }]} />
          <h2>Diferencias de los conteos</h2>
          <Tabla vacio="No hubo diferencias en los conteos del período." filas={lista('diferencias_conteo').slice(0, 20)} cols={[
            { t: 'Fecha', v: (f) => corta(String(f.fecha)) }, { t: 'Zona', v: (f) => String(f.zona) }, { t: 'Producto', v: (f) => String(f.nombre) },
            { t: 'Diferencia', der: true, v: (f) => `${Number(f.diferencia) > 0 ? '+' : ''}${num(f.diferencia, 1)} ${f.unidad}` }, { t: 'Valor', der: true, v: (f) => pesos(f.valor) }]} />
        </>
      )}

      {bloque === 'compras' && (
        <>
          <div className="cifras anchas">
            <div className="cifra"><span>Compras</span><b>{pesos(d.total)}</b><small>período anterior {pesos(d.total_anterior)}</small></div>
            <div className={`cifra${Number(d.impacto_subidas) > 0 ? ' sr' : ''}`}><span>Impacto de las subidas</span><b>{pesos(d.impacto_subidas)}</b><small>sobre el costo de lo vendido</small></div>
            <div className="cifra"><span>Pedido ≠ recibido</span><b>{lista('pedido_vs_recibido').length}</b><small>líneas</small></div>
            <div className={`cifra${lista('con_alertas').length ? ' sa' : ''}`}><span>Recepciones con alertas</span><b>{lista('con_alertas').length}</b><small>{num(d.recepciones_forzadas)} forzadas</small></div>
          </div>
          <div className="dos-col pagina-ancha">
            <section><h2>Por proveedor</h2><Barras filas={lista('por_proveedor').slice(0, 12)} etiqueta={(f) => String(f.proveedor)} valor={(f) => Number(f.valor)} /></section>
            <section><h2>Por categoría</h2><Barras filas={lista('por_categoria').slice(0, 12)} etiqueta={(f) => String(f.categoria)} valor={(f) => Number(f.valor)} /></section>
          </div>
          <h2>Los 10 insumos que más subieron</h2>
          <Tabla vacio="Ningún insumo subió contra el período anterior (o no se compró en los dos)." filas={lista('subidas')} cols={[
            { t: 'Insumo', v: (f) => <Link href={`/catalogo/generico/${f.generico_id}`}>{String(f.nombre)}</Link> },
            { t: 'Antes', der: true, v: (f) => `${pesos2(f.cu_antes)}/${f.unidad}` }, { t: 'Ahora', der: true, v: (f) => `${pesos2(f.cu)}/${f.unidad}` },
            { t: 'Subió', der: true, v: (f) => <strong className="c-error">+{num(f.pct, 1)} %</strong> }, { t: 'Impacto', der: true, v: (f) => pesos(f.impacto) }]} />
          <p className="suave texto-mini">Costo promedio por unidad base del período contra el anterior de igual largo. Impacto: la diferencia × lo que se gastó de ese insumo según las ventas y las fichas.</p>
          <h2>Pedido contra recibido</h2>
          <Tabla vacio="Todo llegó como se pidió." filas={lista('pedido_vs_recibido')} cols={[
            { t: 'Fecha', v: (f) => corta(String(f.fecha)) }, { t: 'Recepción', v: (f) => <Link href={`/historial/recepcion/${f.recepcion_id}`} className="cod">{String(f.recepcion)}</Link> },
            { t: 'Proveedor', v: (f) => String(f.proveedor) }, { t: 'Producto', v: (f) => String(f.producto) },
            { t: 'Pedido', der: true, v: (f) => num(f.pedida, 1) }, { t: 'Llegó', der: true, v: (f) => num(f.recibida, 1) }]} />
          <h2>Recepciones con alertas</h2>
          <Tabla vacio="Ninguna recepción con alertas." filas={lista('con_alertas')} cols={[
            { t: 'Fecha', v: (f) => corta(String(f.fecha)) }, { t: 'Recepción', v: (f) => <Link href={`/historial/recepcion/${f.recepcion_id}`} className="cod">{String(f.recepcion)}</Link> },
            { t: 'Producto', v: (f) => String(f.producto) }, { t: 'Alerta', v: (f) => ((f.hallazgos as string[]) ?? []).map((h) => HALLAZGO[h] ?? h).join(', ') }]} />
        </>
      )}

      {bloque === 'produccion' && (
        <>
          <div className="cifras anchas">
            <div className="cifra"><span>Lotes</span><b>{num(d.lotes)}</b><small>en el período</small></div>
            <div className="cifra"><span>Costo producido</span><b>{pesos(d.costo_total)}</b></div>
            <div className={`cifra${Number(d.fuera_banda) ? ' sa' : ''}`}><span>Fuera de banda</span><b>{num(d.fuera_banda)}</b><small>más de ±{num(d.umbral_pp)} pp contra la ficha</small></div>
            <div className={`cifra${lista('vencidos_sin_consumir').length ? ' sr' : ''}`}><span>Vencidos sin usar</span><b>{lista('vencidos_sin_consumir').length}</b><small>lotes con saldo</small></div>
          </div>
          <h2>Lotes por MPI</h2>
          <Tabla vacio="No hubo lotes en el período." filas={lista('por_mpi')} cols={[
            { t: 'MPI', v: (f) => <Link href={`/fichas/${f.generico_id}`}>{String(f.mpi)}</Link> }, { t: 'Lotes', der: true, v: (f) => num(f.lotes) },
            { t: 'Neto', der: true, v: (f) => `${num(f.neto)} ${f.unidad ?? ''}` }, { t: 'Rendimiento', der: true, v: (f) => (f.rendimiento === null ? '—' : `${num(f.rendimiento, 1)} %`) },
            { t: 'Desvío prom.', der: true, v: (f) => (f.desvio === null ? '—' : `${num(f.desvio, 1)} pp`) }, { t: 'Fuera', der: true, v: (f) => num(f.fuera_banda) },
            { t: 'Costo', der: true, v: (f) => pesos(f.costo) }, { t: '$/g', der: true, v: (f) => (f.costo_g === null ? '—' : pesos2(f.costo_g)) }]} />
          <h2>$/g en el tiempo</h2>
          {lista('serie').length ? (
            <div className="rej2" style={{ display: 'grid', gap: '.8rem', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}>
              {lista('serie').map((s) => {
                const pts = (s.puntos as { fecha: string; costo_g: number; codigo: string }[]);
                const max = Math.max(...pts.map((p) => Number(p.costo_g))) * 1.1 || 1;
                return (
                  <div key={String(s.mpi)} className="tarjeta" style={{ padding: '.6rem' }}>
                    <strong className="texto-nota">{String(s.mpi)}</strong>
                    <svg viewBox="0 0 260 90" style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={`$/g de ${s.mpi}`}>
                      <polyline fill="none" stroke="var(--tinta)" strokeWidth="2"
                                points={pts.map((p, i) => `${10 + (i * 240) / Math.max(1, pts.length - 1)},${80 - (Number(p.costo_g) / max) * 70}`).join(' ')} />
                      {pts.map((p, i) => <circle key={p.codigo} cx={10 + (i * 240) / Math.max(1, pts.length - 1)} cy={80 - (Number(p.costo_g) / max) * 70} r="3" fill="var(--tinta)"><title>{`${corta(p.fecha)}: ${pesos(p.costo_g)}/g`}</title></circle>)}
                    </svg>
                    <span className="suave texto-mini">{corta(pts[0].fecha)}: {pesos2(pts[0].costo_g)}/g → {corta(pts[pts.length - 1].fecha)}: {pesos2(pts[pts.length - 1].costo_g)}/g</span>
                  </div>
                );
              })}
            </div>
          ) : <p className="suave">Hacen falta al menos 2 lotes con costo de la misma MPI.</p>}
          <h2>Responsables</h2>
          <Tabla vacio="Sin lotes." filas={lista('responsables')} cols={[
            { t: 'Responsable', v: (f) => String(f.responsable) }, { t: 'Lotes', der: true, v: (f) => num(f.lotes) },
            { t: 'Fuera de banda', der: true, v: (f) => num(f.fuera_banda) }, { t: 'Desvío prom.', der: true, v: (f) => `${num(f.desvio, 1)} pp` }]} />
          <p className="suave texto-mini">Los lotes históricos de los Sheets no traen responsable.</p>
          <h2>Vencidos sin consumir</h2>
          <Tabla vacio="Ningún lote se venció con saldo." filas={lista('vencidos_sin_consumir')} cols={[
            { t: 'Lote', v: (f) => <Link href={`/produccion/lotes/${encodeURIComponent(String(f.codigo))}`} className="cod">{String(f.codigo)}</Link> },
            { t: 'MPI', v: (f) => String(f.mpi) }, { t: 'Venció', v: (f) => corta(String(f.vence)) },
            { t: 'Quedó', der: true, v: (f) => `${num(f.restante, 1)} ${f.unidad}` }, { t: 'Valor', der: true, v: (f) => pesos(f.valor) }]} />
        </>
      )}

      {bloque === 'perdidas' && (
        <>
          <div className="cifras anchas">
            <div className="cifra"><span>Pérdidas del período</span><b>{pesos(d.total)}</b><small>bajas del kardex</small></div>
          </div>
          {!Number(d.total) && <p className="suave">Sin bajas en el período.</p>}
          <p className="texto-nota"><Link href="/bajas/carta">Cortesías y mal hechos: quién autorizó, quién responde y lo que falta por cobrar →</Link></p>
          <div className="dos-col pagina-ancha">
            <section><h2>Por causa</h2><Barras filas={lista('por_causa')} etiqueta={(f) => CAUSA[String(f.causa)] ?? String(f.causa)} valor={(f) => Number(f.valor)} /></section>
            <section><h2>Tendencia</h2><Barras filas={lista('tendencia')} etiqueta={(f) => `${corta(String(f.desde))} – ${corta(String(f.hasta))}`} valor={(f) => Number(f.valor)} /></section>
          </div>
          <h2>Por quién la registró</h2>
          <Tabla vacio="Sin bajas." filas={lista('por_responsable')} cols={[
            { t: 'Persona', v: (f) => String(f.responsable) }, { t: 'Bajas', der: true, v: (f) => num(f.bajas) }, { t: 'Valor', der: true, v: (f) => pesos(f.valor) }]} />
          <h2>Productos con más pérdida</h2>
          <Tabla vacio="Sin bajas." filas={lista('por_producto')} cols={[
            { t: 'Producto', v: (f) => String(f.producto) }, { t: 'Cantidad', der: true, v: (f) => `${num(f.cantidad, 1)} ${f.unidad}` }, { t: 'Valor', der: true, v: (f) => pesos(f.valor) }]} />
          <p className="suave texto-nota">Cortesías y mal hechos (con quién autorizó y el valor a cargo del responsable) se registran en la app en una etapa aparte;
            hoy las bajas traen las causas vencido, dañado, derrame, mal estado y otro.</p>
        </>
      )}
    </>
  );
}
