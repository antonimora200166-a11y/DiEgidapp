import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import Matriz, { type PuntoMatriz } from './Matriz';
import Exportar from './Exportar';
import Bloque2, { type Insumo, type ResumenPeriodo } from './Bloque2';

export const metadata = { title: 'Consulta' };

type Producto = {
  generico_id: string; codigo: string; nombre: string; area: 'BAR' | 'COCINA'; seccion: string | null;
  unidades: number; unidades_sin_valor: number; valor_neto: number; completa: boolean; costo_unit: number | null;
  costo_total: number | null; costo_sin_venta: number | null; precio: number | null; neto_carta: number | null;
  pct_carta: number | null; margen_unit: number | null; meta_pct: number; banda_pp: number;
};
type Seccion = {
  seccion: string | null; area: 'BAR' | 'COCINA'; productos: number; pct_carta: number | null; pct_teorico: number | null;
  pct_teorico_con_venta: number | null; meta_pct: number; ventas: number; unidades: number; unidades_sin_valor: number;
  costo_sin_venta: number | null; margen: number | null; sin_ficha_completa: number;
};
type Consulta = {
  desde: string; hasta: string; ventas_netas: number; unidades: number; unidades_sin_valor: number; costo_teorico: number;
  costo_sin_venta: number; pct_teorico: number | null; pct_teorico_con_venta: number | null; cobertura_pct: number | null;
  sin_equivalencia: { productos: number; valor: number; unidades: number }; propinas: number; promociones: number; combos_sin_venta: number;
  secciones: Seccion[]; productos: Producto[];
  anterior: { desde: string; hasta: string; ventas_netas: number; pct_teorico: number | null; cobertura_pct: number | null };
  cargas: { desde: string; hasta: string; formato: string; por_dia: boolean }[]; meses: { mes: string; ventas: number }[];
};
type Vista = 'TODO' | 'BAR' | 'COCINA';

const pesos = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Number(n).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
const fechaC = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const META_AREA: Record<Vista, number | null> = { BAR: 24, COCINA: 30, TODO: null };
const semaforo = (v: number | null, meta: number | null, banda = 3) => (v === null || meta === null ? '' : v <= meta ? ' sv' : v <= meta + banda ? ' sa' : ' sr');

// Períodos a la mano: quincena y mes (actual y anterior) y todo lo cargado.
function periodos(hoy: Date, cargas: { desde: string; hasta: string }[]) {
  const a = hoy.getUTCFullYear(), m = hoy.getUTCMonth(), d = hoy.getUTCDate();
  const fin = (y: number, mm: number) => new Date(Date.UTC(y, mm + 1, 0));
  const q1 = d <= 15 ? [new Date(Date.UTC(a, m, 1)), new Date(Date.UTC(a, m, 15))] : [new Date(Date.UTC(a, m, 16)), fin(a, m)];
  const q0 = d <= 15 ? [new Date(Date.UTC(a, m - 1, 16)), fin(a, m - 1)] : [new Date(Date.UTC(a, m, 1)), new Date(Date.UTC(a, m, 15))];
  const lista = [
    { t: 'Esta quincena', desde: iso(q1[0]), hasta: iso(q1[1]) },
    { t: 'Quincena anterior', desde: iso(q0[0]), hasta: iso(q0[1]) },
    { t: 'Este mes', desde: iso(new Date(Date.UTC(a, m, 1))), hasta: iso(fin(a, m)) },
    { t: 'Mes anterior', desde: iso(new Date(Date.UTC(a, m - 1, 1))), hasta: iso(fin(a, m - 1)) },
  ];
  if (cargas.length) lista.unshift({ t: 'Todo lo cargado', desde: cargas.map((c) => c.desde).sort()[0], hasta: cargas.map((c) => c.hasta).sort().at(-1)! });
  return lista;
}

function Variacion({ actual, antes, inverso = false, unidad = '%' }: { actual: number | null; antes: number | null; inverso?: boolean; unidad?: '%' | 'pts' }) {
  if (actual === null || antes === null || !antes) return <small>sin período anterior para comparar</small>;
  const dif = unidad === '%' ? (actual / antes - 1) * 100 : actual - antes;
  const bueno = inverso ? dif <= 0 : dif >= 0;
  return <small style={{ color: bueno ? 'var(--ok)' : 'var(--error)' }}>{dif > 0 ? '+' : ''}{dif.toLocaleString('es-CO', { maximumFractionDigits: 1 })} {unidad === '%' ? '%' : 'pts'} vs. anterior</small>;
}

export default async function ConsultaPagina({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; area?: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol !== 'admin') redirect('/');
  const sp = await searchParams;
  const supabase = await supabaseServidor();
  const { data: cargas } = await supabase.from('ventas_cargas').select('desde, hasta').order('desde');
  const hoy = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
  const opciones = periodos(new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())), cargas ?? []);
  const valida = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  const desde = valida(sp.desde) ?? opciones[0].desde, hasta = valida(sp.hasta) ?? opciones[0].hasta;
  const area: Vista = (['TODO', 'BAR', 'COCINA'] as Vista[]).includes(sp.area as Vista) ? (sp.area as Vista) : 'TODO';
  const { data, error } = await supabase.rpc('consulta_ventas', { p_desde: desde, p_hasta: hasta, p_area: area === 'TODO' ? null : area });
  if (error) throw new Error(error.message);
  const c = data as Consulta;
  const enlace = (cambio: Record<string, string>) => `/consulta?${new URLSearchParams({ desde, hasta, area, ...cambio })}`;
  const meta = META_AREA[area];
  const conVentas = c.productos.filter((p) => p.unidades - p.unidades_sin_valor > 0);
  const puntos: PuntoMatriz[] = conVentas.filter((p) => p.completa && p.margen_unit !== null)
    .map((p) => ({ generico_id: p.generico_id, nombre: p.nombre, seccion: p.seccion, unidades: p.unidades - p.unidades_sin_valor, margen_unit: Number(p.margen_unit), pct_carta: p.pct_carta }));
  const topMargen = [...puntos].sort((a, b) => b.unidades * b.margen_unit - a.unidades * a.margen_unit).slice(0, 10);
  const topCosto = [...conVentas].filter((p) => p.pct_carta !== null).sort((a, b) => Number(b.pct_carta) - Number(a.pct_carta)).slice(0, 10);
  const sinDatos = !c.productos.length;

  // bloque 2: períodos (cerrados congelados y el abierto en vivo); el detalle, del más reciente del área
  const { data: per, error: errorPer } = await supabase.rpc('consulta_periodos', { p_area: area === 'TODO' ? null : area });
  if (errorPer) throw new Error(errorPer.message);
  const cerrados = ((per as { cerrados: ResumenPeriodo[] })?.cerrados ?? []);
  const abiertos = ((per as { abiertos: ResumenPeriodo[] })?.abiertos ?? []);
  let detalle: (ResumenPeriodo & { insumos?: Insumo[] }) | null = null;
  if (area !== 'TODO') {
    const abierto = abiertos[0];
    if (abierto) {
      const { data: d } = await supabase.rpc('periodo_vivo', { p_area: area, p_desde: abierto.desde, p_hasta: abierto.hasta });
      detalle = d as ResumenPeriodo & { insumos: Insumo[] };
    } else if (cerrados[0]?.id) {
      const { data: d } = await supabase.rpc('periodo_detalle', { p_id: cerrados[0].id });
      detalle = d as ResumenPeriodo & { insumos: Insumo[] };
    }
  }
  const ultimo = area !== 'TODO' ? cerrados[0] ?? null : null;

  // bandeja: las alertas abiertas del área (o de todas), de mayor impacto
  const { data: al } = await supabase.rpc('alertas_lista', { p_todas: false });
  const alertas = ((al ?? []) as { id: string; titulo: string; impacto: number | null; estado: string; responsable: string | null; area: string | null }[])
    .filter((x) => area === 'TODO' || x.area === area || x.area === null);

  return (
    <>
      <h1 className="pagina-ancha">Consulta</h1>
      <div className="tarjeta" style={{ display: 'grid', gap: '.6rem', marginBottom: '1rem' }}>
        <nav className="segmentos" style={{ gap: '.4rem' }}>
          {opciones.map((o) => (
            <Link key={o.t} href={enlace({ desde: o.desde, hasta: o.hasta })}>
              <span style={o.desde === desde && o.hasta === hasta ? { background: 'var(--marca)', color: 'var(--marca-texto)', borderColor: 'var(--marca)' } : undefined}>{o.t}</span>
            </Link>
          ))}
        </nav>
        <form method="get" style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ margin: 0 }}>Desde<input type="date" name="desde" defaultValue={desde} /></label>
          <label style={{ margin: 0 }}>Hasta<input type="date" name="hasta" defaultValue={hasta} /></label>
          <label style={{ margin: 0 }}>Área
            <select name="area" defaultValue={area}><option value="TODO">Total</option><option value="BAR">Bar</option><option value="COCINA">Cocina</option></select>
          </label>
          <button type="submit" className="secundario">Ver</button>
          <Link href={`/consulta/operacion?${new URLSearchParams({ desde, hasta, area })}`} className="boton secundario" style={{ marginLeft: 'auto' }}>Inventario, compras, producción y pérdidas</Link>
          <Link href="/consulta/ventas" className="boton secundario">Cargar ventas de Odoo</Link>
          <Link href="/consulta/simulador" className="boton secundario">Simulador</Link>
          <Link href="/consulta/informe" className="boton secundario">Informe quincenal</Link>
        </form>
        <span className="suave" style={{ fontSize: '.85rem' }}>
          {fechaC(c.desde)} → {fechaC(c.hasta)} · comparado con {fechaC(c.anterior.desde)} → {fechaC(c.anterior.hasta)}.
          Costo de cada ficha con los costos de hoy (estimado mientras no haya kardex); los cierres de período lo congelarán.
        </span>
        <Exportar params={{ desde, hasta, area }} bloques={[{ bloque: 'ventas', t: 'Ventas y teórico' }, ...(area !== 'TODO' ? [{ bloque: 'periodo', t: 'Real vs. teórico' }] : [])]} />
      </div>

      {sinDatos ? (
        <p className="tarjeta">No hay ventas cargadas en este período. <Link href="/consulta/ventas">Carga el reporte de Odoo</Link> o escoge «Todo lo cargado».</p>
      ) : (
        <>
          {/* ------------------------------------------------ bloque 0 */}
          <h2>Resumen</h2>
          <div className="cifras anchas">
            <div className="cifra"><span>Ventas netas</span><b>{pesos(c.ventas_netas)}</b><Variacion actual={c.ventas_netas} antes={c.anterior.ventas_netas} /></div>
            <div className={`cifra${semaforo(c.pct_teorico, meta)}`}><span>% costo teórico</span><b>{pct(c.pct_teorico)}</b>
              <small>{meta !== null ? `meta ${meta} % · ` : ''}sin lo de $0: {pct(c.pct_teorico_con_venta)}</small></div>
            {ultimo ? (
              <>
                <div className="cifra"><span>% costo real</span><b>{pct(ultimo.pct_real)}</b><small>último cierre · teórico {pct(ultimo.pct_teorico)}</small></div>
                <div className={`cifra${ultimo.semaforo === 'VERDE' ? ' sv' : ultimo.semaforo === 'AMARILLO' ? ' sa' : ultimo.semaforo === 'ROJO' ? ' sr' : ''}`}>
                  <span>Real vs. teórico</span><b>{ultimo.variacion_pp === null ? '—' : `${ultimo.variacion_pp > 0 ? '+' : ''}${ultimo.variacion_pp.toLocaleString('es-CO')} pts`}</b>
                  <small>{pesos(ultimo.cmv_real - ultimo.cmv_teorico)} · no explicado {pesos(ultimo.no_explicado)}</small></div>
                <div className="cifra"><span>Pérdidas reportadas</span><b>{pesos(ultimo.perdidas)}</b><small>bajas del último cierre</small></div>
                <div className="cifra"><span>Inventario</span><b>{pesos(ultimo.inv_final)}</b>
                  <small>{ultimo.cmv_real > 0 ? `${Math.round(ultimo.inv_final / (ultimo.cmv_real / ((new Date(ultimo.hasta).getTime() - new Date(ultimo.desde).getTime()) / 864e5 + 1)))} días de inventario` : 'al último cierre'}</small></div>
              </>
            ) : (
              <>
                <div className="cifra"><span>% costo real</span><b>—</b><small>{area === 'TODO' ? 'escoge Bar o Cocina' : 'falta el primer cierre de período'}</small></div>
                <div className="cifra"><span>Real vs. teórico</span><b>—</b><small>se calcula al cerrar el período</small></div>
                <div className="cifra"><span>Pérdidas reportadas</span><b>—</b><small>salen de las bajas del kardex</small></div>
                <div className="cifra"><span>Inventario</span><b>—</b><small>valor y días: con el conteo inicial</small></div>
              </>
            )}
            <div className={`cifra${c.cobertura_pct === null ? '' : c.cobertura_pct >= 95 ? ' sv' : c.cobertura_pct >= 80 ? ' sa' : ' sr'}`}>
              <span>Cobertura de fichas</span><b>{pct(c.cobertura_pct)}</b><small>de lo vendido tiene ficha completa</small></div>
            <div className="cifra"><span>Salió a $0</span><b>{pesos(c.costo_sin_venta)}</b>
              <small>{Number(c.unidades_sin_valor).toLocaleString('es-CO')} und (menús Yuga, cortesías)</small></div>
          </div>
          {area === 'TODO' && c.sin_equivalencia.productos > 0 && (
            <p className="aviso">{c.sin_equivalencia.productos} producto(s) de Odoo sin equivalencia con la carta: {pesos(c.sin_equivalencia.valor)} vendidos que no entran
              en el teórico. <Link href="/consulta/ventas">Resolverlos</Link></p>
          )}
          {Number(c.combos_sin_venta) > 0 && (
            <p className="suave" style={{ fontSize: '.88rem' }}>En el período hay {Number(c.combos_sin_venta).toLocaleString('es-CO')} menús Yuga a $0. Cuentan como combos: sus platos y bebidas consumen
              ingredientes sin venta en Odoo, por eso el % teórico se muestra con y sin lo que salió a $0.</p>
          )}
          <h3>Bandeja de alertas</h3>
          {alertas.length ? (
            <ul className="renglones tarjeta" style={{ padding: '0 1rem' }}>
              {alertas.slice(0, 5).map((x) => (
                <li key={x.id}>
                  <span style={{ minWidth: 0 }}><Link href="/alertas">{x.titulo}</Link>
                    <span className="suave" style={{ display: 'block', fontSize: '.8rem' }}>{x.estado === 'EN_CURSO' ? 'En curso' : 'Abierta'}{x.responsable ? ` · ${x.responsable}` : ' · sin responsable'}</span></span>
                  <strong className="n">{pesos(x.impacto)}</strong>
                </li>
              ))}
            </ul>
          ) : <p className="suave">No hay alertas abiertas.</p>}
          <p style={{ fontSize: '.88rem' }}><Link href="/alertas">Ver toda la bandeja ({alertas.length} abiertas) →</Link></p>

          {/* ------------------------------------------------ bloque 1 */}
          <h2>Costo y margen por sección</h2>
          <div className="desborde tarjeta" style={{ padding: 0 }}>
            <table className="tabla">
              <thead><tr>
                <th>Sección</th>{area === 'TODO' && <th>Área</th>}
                <th style={{ textAlign: 'right' }}>Und</th><th style={{ textAlign: 'right' }}>% carta</th>
                <th style={{ textAlign: 'right' }}>% teórico</th><th style={{ textAlign: 'right' }}>sin $0</th><th style={{ textAlign: 'right' }}>Meta</th>
                <th style={{ textAlign: 'right' }}>Ventas netas</th><th style={{ textAlign: 'right' }}>Margen $</th><th style={{ textAlign: 'right' }}>Margen %</th>
              </tr></thead>
              <tbody>{c.secciones.map((s) => {
                const color = (v: number | null) => (v === null ? undefined : v <= s.meta_pct ? 'var(--ok)' : v <= s.meta_pct + 3 ? 'var(--aviso)' : 'var(--error)');
                return (
                  <tr key={`${s.area}-${s.seccion}`}>
                    <td><strong>{s.seccion ?? 'Sin sección'}</strong>{s.sin_ficha_completa > 0 && <div className="suave" style={{ fontSize: '.78rem' }}>{s.sin_ficha_completa} sin ficha completa</div>}</td>
                    {area === 'TODO' && <td>{s.area === 'BAR' ? 'Bar' : 'Cocina'}</td>}
                    <td style={{ textAlign: 'right' }}>{Number(s.unidades).toLocaleString('es-CO')}{s.unidades_sin_valor > 0 && <div className="suave" style={{ fontSize: '.78rem' }}>{s.unidades_sin_valor} a $0</div>}</td>
                    <td style={{ textAlign: 'right' }}>{pct(s.pct_carta)}</td>
                    <td style={{ textAlign: 'right' }}><strong style={{ color: color(s.pct_teorico) }}>{pct(s.pct_teorico)}</strong></td>
                    <td style={{ textAlign: 'right', color: color(s.pct_teorico_con_venta) }}>{s.unidades_sin_valor > 0 ? pct(s.pct_teorico_con_venta) : <span className="suave">=</span>}</td>
                    <td style={{ textAlign: 'right' }} className="suave">{s.meta_pct} %</td>
                    <td style={{ textAlign: 'right' }}>{pesos(s.ventas)}</td>
                    <td style={{ textAlign: 'right' }}>{pesos(s.margen)}</td>
                    <td style={{ textAlign: 'right' }}>{s.margen !== null && s.ventas ? pct((s.margen / s.ventas) * 100) : '—'}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <p className="suave" style={{ fontSize: '.82rem' }}>% carta: promedio simple de las fichas de la sección. % teórico: costo de lo vendido (unidades de Odoo × costo de la ficha) sobre las ventas netas
            de los productos con ficha completa. Las secciones sin ficha completa no tienen %.</p>

          <div className="dos-col pagina-ancha" style={{ alignItems: 'start' }}>
            <section>
              <h2>Ingeniería de menú</h2>
              <Matriz puntos={puntos} />
            </section>
            <section>
              <h2>Evolución mensual</h2>
              {c.meses.length >= 2 ? (
                <ul className="renglones">{c.meses.map((m) => <li key={m.mes}><span>{m.mes}</span><strong className="n">{pesos(m.ventas)}</strong></li>)}</ul>
              ) : <p className="suave">Se arma con las cargas semanales, que traen el día de cada venta. El histórico de enero a noviembre vino sin día por línea.</p>}
            </section>
          </div>

          <div className="dos-col pagina-ancha" style={{ alignItems: 'start' }}>
            <section>
              <h2>Top 10 por margen $ total</h2>
              <table className="tabla"><thead><tr><th>Producto</th><th style={{ textAlign: 'right' }}>Und</th><th style={{ textAlign: 'right' }}>Margen total</th></tr></thead>
                <tbody>{topMargen.map((p) => <tr key={p.generico_id}><td><Link href={`/fichas/${p.generico_id}`}>{p.nombre}</Link></td>
                  <td style={{ textAlign: 'right' }}>{p.unidades.toLocaleString('es-CO')}</td><td style={{ textAlign: 'right' }}>{pesos(p.unidades * p.margen_unit)}</td></tr>)}</tbody></table>
              <p className="suave" style={{ fontSize: '.8rem' }}>Unidades cobradas × margen por unidad de la carta.</p>
            </section>
            <section>
              <h2>Top 10 con peor % costo</h2>
              <table className="tabla"><thead><tr><th>Producto</th><th style={{ textAlign: 'right' }}>% costo</th><th style={{ textAlign: 'right' }}>Meta</th></tr></thead>
                <tbody>{topCosto.map((p) => <tr key={p.generico_id}><td><Link href={`/fichas/${p.generico_id}`}>{p.nombre}</Link></td>
                  <td style={{ textAlign: 'right', color: Number(p.pct_carta) <= p.meta_pct ? 'var(--ok)' : Number(p.pct_carta) <= p.meta_pct + 3 ? 'var(--aviso)' : 'var(--error)' }}><strong>{pct(p.pct_carta)}</strong></td>
                  <td style={{ textAlign: 'right' }} className="suave">{p.meta_pct} %</td></tr>)}</tbody></table>
              <p className="suave" style={{ fontSize: '.8rem' }}>Solo productos que se vendieron en el período.</p>
            </section>
          </div>
        </>
      )}

      {/* ------------------------------------------------ bloque 2 */}
      <Bloque2 cerrados={cerrados} abiertos={abiertos} detalle={detalle} insumos={detalle?.insumos ?? []} area={area} />
    </>
  );
}
