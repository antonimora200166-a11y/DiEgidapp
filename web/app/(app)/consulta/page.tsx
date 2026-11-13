import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import Matriz, { type PuntoMatriz } from './Matriz';
import Exportar from './Exportar';
import Bloque2, { type Insumo, type ResumenPeriodo } from './Bloque2';
import { pesos, pct, fecha as fechaC } from '@/lib/formato';
import { Insignia, Cambio, tonoMeta, tonoSemaforo, type Tono } from '@/components/Insignia';
import TarjetaCierre, { periodosPorCerrar } from '@/components/TarjetaCierre';
import PestanasConsulta from '@/components/PestanasConsulta';
import FiltroConsulta, { periodos } from '@/components/FiltroConsulta';

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

const META_AREA: Record<Vista, number | null> = { BAR: 24, COCINA: 30, TODO: null };

function Variacion({ actual, antes, inverso = false, unidad = '%' }: { actual: number | null; antes: number | null; inverso?: boolean; unidad?: '%' | 'pts' }) {
  if (actual === null || antes === null || !antes) return <small>sin período anterior para comparar</small>;
  const dif = unidad === '%' ? (actual / antes - 1) * 100 : actual - antes;
  return <Cambio dif={dif} unidad={unidad === '%' ? '%' : 'pts'} inverso={inverso} />;
}
// cobertura de fichas: más es mejor
const tonoCobertura = (v: number | null): Tono | null => (v === null ? null : v >= 95 ? 'ok' : v >= 80 ? 'aviso' : 'error');
const TEXTO_COBERTURA: Record<Tono, string> = { ok: 'Completa', aviso: 'Casi', error: 'Baja', gris: 'Sin dato' };
const claseTono = (t: Tono | null) => (t === 'ok' ? ' sv' : t === 'aviso' ? ' sa' : t === 'error' ? ' sr' : '');

export default async function ConsultaPagina({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; area?: string; vista?: string }> }) {
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
  const vista = sp.vista === 'ventas' || sp.vista === 'real' || sp.vista === 'alertas' ? sp.vista : 'resumen';
  // los enlaces de período y área se quedan en la pestaña abierta
  const enlace = (cambio: Record<string, string>) => `/consulta?${new URLSearchParams({ desde, hasta, area, ...(vista === 'resumen' ? {} : { vista }), ...cambio })}`;
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
  const porCerrar = periodosPorCerrar(abiertos);
  const tonoTeorico = tonoMeta(c.pct_teorico, meta);

  // bandeja: las alertas abiertas del área (o de todas), de mayor impacto
  const { data: al } = await supabase.rpc('alertas_lista', { p_todas: false });
  const alertas = ((al ?? []) as { id: string; titulo: string; impacto: number | null; estado: string; responsable: string | null; area: string | null }[])
    .filter((x) => area === 'TODO' || x.area === area || x.area === null);

  return (
    <>
      <h1 className="pagina-ancha titulo-gestion">Consulta</h1>
      {porCerrar.length > 0 && <TarjetaCierre periodos={porCerrar} />}
      {/* filtros compactos: período en un chip que se abre y el área en un segmento; las cifras quedan arriba */}
      <FiltroConsulta ruta="/consulta" desde={desde} hasta={hasta} area={area} opciones={opciones} fijos={vista === 'resumen' ? {} : { vista }} />
      <p className="suave" style={{ fontSize: '.82rem', margin: '.2rem 0 0' }}>
        {fechaC(c.desde)} → {fechaC(c.hasta)} · comparado con {fechaC(c.anterior.desde)} → {fechaC(c.anterior.hasta)}
      </p>
      <PestanasConsulta activa={vista} desde={desde} hasta={hasta} area={area} alertas={alertas.length} />

      {(vista === 'resumen' || vista === 'ventas') && (sinDatos ? (
        <p className="tarjeta">No hay ventas cargadas en este período. <Link href="/consulta/ventas">Cargue el reporte de Odoo</Link> o escoja «Todo lo cargado».</p>
      ) : (
        <>
          {vista === 'resumen' && <>
          {/* ------------------------------------------------ bloque 0: tres cifras principales y las demás */}
          <h2 className="sr-only">Resumen</h2>
          <div className="cifras heroe">
            <div className="cifra"><span>Ventas netas</span><b>{pesos(c.ventas_netas)}</b><Variacion actual={c.ventas_netas} antes={c.anterior.ventas_netas} /></div>
            <div className={`cifra${claseTono(tonoTeorico)}`}><span>% costo teórico</span><b>{pct(c.pct_teorico)}</b>
              <small>{meta !== null ? `meta ${meta} % · ` : ''}sin lo de $0: {pct(c.pct_teorico_con_venta)}</small>
              {tonoTeorico && <Insignia tono={tonoTeorico} />}</div>
            {ultimo ? (
              <div className={`cifra${claseTono(tonoSemaforo(ultimo.semaforo))}`}>
                <span>Real vs. teórico</span><b>{ultimo.variacion_pp === null ? '—' : `${ultimo.variacion_pp > 0 ? '+' : ''}${ultimo.variacion_pp.toLocaleString('es-CO')} pts`}</b>
                <small>{pesos(ultimo.cmv_real - ultimo.cmv_teorico)} · no explicado {pesos(ultimo.no_explicado)}</small>
                {tonoSemaforo(ultimo.semaforo) && <Insignia tono={tonoSemaforo(ultimo.semaforo)!} />}</div>
            ) : (
              <div className={`cifra${claseTono(tonoCobertura(c.cobertura_pct))}`}>
                <span>Cobertura de fichas</span><b>{pct(c.cobertura_pct)}</b><small>de lo vendido tiene ficha completa</small>
                {tonoCobertura(c.cobertura_pct) && <Insignia tono={tonoCobertura(c.cobertura_pct)!}>{TEXTO_COBERTURA[tonoCobertura(c.cobertura_pct)!]}</Insignia>}</div>
            )}
          </div>
          <div className="cifras anchas secundarias">
            {ultimo && (
              <>
                <div className="cifra"><span>% costo real</span><b>{pct(ultimo.pct_real)}</b><small>último cierre · teórico {pct(ultimo.pct_teorico)}</small></div>
                <div className="cifra"><span>Pérdidas reportadas</span><b>{pesos(ultimo.perdidas)}</b><small>bajas del último cierre</small></div>
                <div className="cifra"><span>Inventario</span><b>{pesos(ultimo.inv_final)}</b>
                  <small>{ultimo.cmv_real > 0 ? `${Math.round(ultimo.inv_final / (ultimo.cmv_real / ((new Date(ultimo.hasta).getTime() - new Date(ultimo.desde).getTime()) / 864e5 + 1)))} días de inventario` : 'al último cierre'}</small></div>
                <div className={`cifra${claseTono(tonoCobertura(c.cobertura_pct))}`}>
                  <span>Cobertura de fichas</span><b>{pct(c.cobertura_pct)}</b><small>de lo vendido tiene ficha completa</small>
                  {tonoCobertura(c.cobertura_pct) && <Insignia tono={tonoCobertura(c.cobertura_pct)!}>{TEXTO_COBERTURA[tonoCobertura(c.cobertura_pct)!]}</Insignia>}</div>
              </>
            )}
            <div className="cifra"><span>Salió a $0</span><b>{pesos(c.costo_sin_venta)}</b>
              <small>{Number(c.unidades_sin_valor).toLocaleString('es-CO')} und (menús Yuga, cortesías)</small></div>
          </div>
          {!ultimo && (
            // las cifras que aún no tienen dato, juntas y con lo que las destraba
            <p className="aviso falta-datos">
              <strong>Falta para ver costo real, real vs. teórico, pérdidas e inventario:</strong>{' '}
              {area === 'TODO'
                ? <>escoja <Link href={enlace({ area: 'BAR' })}>Bar</Link> o <Link href={enlace({ area: 'COCINA' })}>Cocina</Link>.</>
                : <>el <Link href="/conteo">conteo inicial</Link> y el <Link href={`/consulta/cerrar?area=${area}`}>primer cierre de período</Link>.</>}
            </p>
          )}
          <div className="mas-consulta">
            <Link href="/consulta/ventas" className="boton secundario chico">Cargar ventas de Odoo</Link>
            <Link href="/consulta/simulador" className="boton secundario chico">Simulador</Link>
            <Link href="/consulta/informe" className="boton secundario chico">Informe quincenal</Link>
          </div>
          <Exportar params={{ desde, hasta, area }} bloques={[{ bloque: 'ventas', t: 'Ventas y teórico' }, ...(area !== 'TODO' ? [{ bloque: 'periodo', t: 'Real vs. teórico' }] : [])]} />
          <p className="suave" style={{ fontSize: '.8rem' }}>Costo de cada ficha con los costos de hoy (estimado mientras no haya kardex); los cierres de período lo congelarán.</p>
          {area === 'TODO' && c.sin_equivalencia.productos > 0 && (
            <p className="aviso">{c.sin_equivalencia.productos} producto(s) de Odoo sin equivalencia con la carta: {pesos(c.sin_equivalencia.valor)} vendidos que no entran
              en el teórico. <Link href="/consulta/ventas">Resolverlos</Link></p>
          )}
          {Number(c.combos_sin_venta) > 0 && (
            <p className="suave" style={{ fontSize: '.88rem' }}>En el período hay {Number(c.combos_sin_venta).toLocaleString('es-CO')} menús Yuga a $0. Cuentan como combos: sus platos y bebidas consumen
              ingredientes sin venta en Odoo, por eso el % teórico se muestra con y sin lo que salió a $0.</p>
          )}
          <h3>Lo más urgente de la bandeja</h3>
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
          <p style={{ fontSize: '.88rem' }}><Link href={enlace({ vista: 'alertas' })}>Ver las {alertas.length} alertas abiertas →</Link></p>
          </>}

          {vista === 'ventas' && <>
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
                const tono = tonoMeta(s.pct_teorico, s.meta_pct);
                return (
                  <tr key={`${s.area}-${s.seccion}`}>
                    <td><strong>{s.seccion ?? 'Sin sección'}</strong>{s.sin_ficha_completa > 0 && <div className="suave" style={{ fontSize: '.78rem' }}>{s.sin_ficha_completa} sin ficha completa</div>}</td>
                    {area === 'TODO' && <td>{s.area === 'BAR' ? 'Bar' : 'Cocina'}</td>}
                    <td style={{ textAlign: 'right' }}>{Number(s.unidades).toLocaleString('es-CO')}{s.unidades_sin_valor > 0 && <div className="suave" style={{ fontSize: '.78rem' }}>{s.unidades_sin_valor} a $0</div>}</td>
                    <td style={{ textAlign: 'right' }}>{pct(s.pct_carta)}</td>
                    <td style={{ textAlign: 'right' }}><span className="con-estado"><strong>{pct(s.pct_teorico)}</strong>{tono && <Insignia tono={tono}>{tono === 'aviso' ? 'Cerca' : undefined}</Insignia>}</span></td>
                    <td style={{ textAlign: 'right' }}>{s.unidades_sin_valor > 0 ? pct(s.pct_teorico_con_venta) : <span className="suave">=</span>}</td>
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
                  <td style={{ textAlign: 'right' }}><span className="con-estado"><strong>{pct(p.pct_carta)}</strong><Insignia tono={tonoMeta(Number(p.pct_carta), p.meta_pct)!}>{tonoMeta(Number(p.pct_carta), p.meta_pct) === 'aviso' ? 'Cerca' : undefined}</Insignia></span></td>
                  <td style={{ textAlign: 'right' }} className="suave">{p.meta_pct} %</td></tr>)}</tbody></table>
              <p className="suave" style={{ fontSize: '.8rem' }}>Solo productos que se vendieron en el período.</p>
            </section>
          </div>
          </>}
        </>
      ))}

      {/* ------------------------------------------------ bloque 2 */}
      {vista === 'real' && <Bloque2 cerrados={cerrados} abiertos={abiertos} detalle={detalle} insumos={detalle?.insumos ?? []} area={area} />}

      {/* ------------------------------------------------ alertas: toda la bandeja abierta, de mayor impacto */}
      {vista === 'alertas' && (
        <section>
          <h2>Alertas abiertas{area !== 'TODO' ? ` · ${area === 'BAR' ? 'Bar' : 'Cocina'}` : ''}</h2>
          {alertas.length ? (
            <ul className="renglones tarjeta" style={{ padding: '0 1rem' }}>
              {[...alertas].sort((a, b) => Number(b.impacto ?? 0) - Number(a.impacto ?? 0)).map((x) => (
                <li key={x.id}>
                  <span style={{ minWidth: 0 }}><strong>{x.titulo}</strong>
                    <span className="suave" style={{ display: 'block', fontSize: '.8rem' }}>{x.estado === 'EN_CURSO' ? 'En curso' : 'Abierta'}{x.responsable ? ` · ${x.responsable}` : ' · sin responsable'}</span></span>
                  <strong className="n">{pesos(x.impacto)}</strong>
                </li>
              ))}
            </ul>
          ) : <p className="suave">No hay alertas abiertas.</p>}
          <p style={{ fontSize: '.88rem' }}><Link href="/alertas" className="boton secundario chico">Asignar y resolver en Alertas →</Link></p>
        </section>
      )}
    </>
  );
}
