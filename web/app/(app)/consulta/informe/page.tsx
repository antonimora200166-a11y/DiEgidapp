import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import Exportar from '../Exportar';
import Redactar from './Redactar';
import { pesos, pct, fecha as fechaC } from '@/lib/formato';

export const metadata = { title: 'Informe quincenal' };

type Resumen = {
  id: string; area: 'BAR' | 'COCINA'; desde: string; hasta: string; ventas_netas: number; cmv_real: number; cmv_teorico: number;
  perdidas: number; no_explicado: number; pct_real: number | null; pct_teorico: number | null; variacion_pp: number | null;
  semaforo: string | null; inv_inicial: number; compras: number; inv_final: number; fichas_incompletas: number; forzado: boolean;
  motivo_forzado: string | null;
};
type Cifras = {
  periodo: Resumen; anterior: Resumen | null;
  insumos: { nombre: string; unidad: string; teorico: number; real: number; diferencia_pesos: number }[];
  alertas: { regla: string; titulo: string; impacto: number | null; estado: string; responsable: string | null }[];
  alertas_abiertas: number; propuestas_pendientes: number;
};
type Informe = { id: string; version: number; resumen: string; modelo: string | null; generado_por: string | null; generado_en: string };

const CLASE: Record<string, string> = { VERDE: ' sv', AMARILLO: ' sa', ROJO: ' sr' };

export default async function InformePagina({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol !== 'admin') redirect('/');
  const sp = await searchParams;
  const supabase = await supabaseServidor();
  const listas = await Promise.all((['BAR', 'COCINA'] as const).map((a) => supabase.rpc('consulta_periodos', { p_area: a })));
  const cerrados = listas.flatMap((r) => ((r.data as { cerrados?: Resumen[] } | null)?.cerrados ?? []))
    .sort((a, b) => b.hasta.localeCompare(a.hasta) || a.area.localeCompare(b.area));
  const id = sp.periodo && cerrados.some((c) => c.id === sp.periodo) ? sp.periodo : cerrados[0]?.id;

  let cifras: Cifras | null = null, informes: Informe[] = [];
  if (id) {
    const [c, i] = await Promise.all([supabase.rpc('informe_cifras', { p_periodo: id }), supabase.rpc('informes_lista', { p_periodo: id })]);
    if (c.error) throw new Error(c.error.message);
    cifras = c.data as Cifras;
    informes = (i.data ?? []) as Informe[];
  }
  const p = cifras?.periodo, ant = cifras?.anterior;

  return (
    <>
      <p className="no-imprimir m-0 mb-1"><Link href="/consulta">← Consulta</Link></p>
      <h1 className="pagina-ancha titulo-gestion">Informe quincenal{p ? ` · ${p.area === 'BAR' ? 'Bar' : 'Cocina'} · ${fechaC(p.desde)} al ${fechaC(p.hasta)}` : ''}</h1>
      {!cerrados.length ? (
        <p className="tarjeta">Todavía no hay períodos cerrados. El informe se arma con el cierre de cada quincena:
          primero el conteo de todas las zonas y luego <Link href="/consulta/cerrar">cerrar el período</Link>.</p>
      ) : (
        <>
          <form method="get" className="no-imprimir" style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <label className="m-0">Período
              <select name="periodo" defaultValue={id}>
                {cerrados.map((c) => <option key={c.id} value={c.id}>{c.area === 'BAR' ? 'Bar' : 'Cocina'} · {fechaC(c.desde)} al {fechaC(c.hasta)}</option>)}
              </select>
            </label>
            <button type="submit" className="secundario">Ver</button>
            <Exportar params={{ id }} bloques={[{ bloque: 'cierre', t: 'Cifras del cierre' }]} />
          </form>
          {p && cifras && <>
            {p.forzado && <p className="aviso">Este período se cerró sin el conteo completo: {p.motivo_forzado}</p>}
            <div className="cifras">
              <div className="cifra"><span>Ventas netas</span><b>{pesos(p.ventas_netas)}</b><small>{ant ? `antes ${pesos(ant.ventas_netas)}` : 'sin período anterior'}</small></div>
              <div className={`cifra${CLASE[p.semaforo ?? ''] ?? ''}`}><span>% costo real</span><b>{pct(p.pct_real)}</b><small>teórico {pct(p.pct_teorico)}</small></div>
              <div className="cifra"><span>Real vs. teórico</span><b>{p.variacion_pp == null ? '—' : `${p.variacion_pp > 0 ? '+' : ''}${p.variacion_pp.toLocaleString('es-CO')} pts`}</b>
                <small>{ant?.variacion_pp != null ? `antes ${ant.variacion_pp.toLocaleString('es-CO')} pts` : '—'}</small></div>
              <div className="cifra"><span>CMV real</span><b>{pesos(p.cmv_real)}</b><small>teórico {pesos(p.cmv_teorico)}</small></div>
              <div className="cifra"><span>Pérdidas</span><b>{pesos(p.perdidas)}</b><small>reportadas en bajas</small></div>
              <div className="cifra"><span>No explicado</span><b>{pesos(p.no_explicado)}</b><small>real − teórico − pérdidas</small></div>
            </div>

            <section className="tarjeta mb-3">
              <h2 className="mt-0">Resumen</h2>
              {informes[0] ? (
                <>
                  <div style={{ whiteSpace: 'pre-line', lineHeight: 1.5 }}>{informes[0].resumen}</div>
                  <p className="suave texto-mini">Versión {informes[0].version} · {informes[0].modelo ? `redactado con IA (${informes[0].modelo}) y revisado por` : 'escrito por'} {informes[0].generado_por ?? '—'}
                    {' '}· {new Date(informes[0].generado_en).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' })}</p>
                </>
              ) : <p className="suave">Todavía no hay resumen guardado para este período.</p>}
              <div className="no-imprimir"><Redactar periodo_id={p.id} hay={informes.length > 0} /></div>
              {informes.length > 1 && (
                <details className="no-imprimir mt-2"><summary>Versiones anteriores ({informes.length - 1})</summary>
                  {informes.slice(1).map((i) => <div key={i.id} style={{ margin: '.5rem 0', whiteSpace: 'pre-line', fontSize: '.9rem' }}>
                    <b>Versión {i.version}</b> · {i.generado_por ?? '—'}{'\n'}{i.resumen}</div>)}
                </details>)}
            </section>

            <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
              <section>
                <h2>Insumos con más diferencia</h2>
                {cifras.insumos.length === 0 ? <p className="suave">Sin diferencias.</p> : (
                  <table className="tabla"><thead><tr><th>Insumo</th><th className="der">Teórico</th><th className="der">Real</th><th className="der">Diferencia</th></tr></thead>
                    <tbody>{cifras.insumos.map((i) => <tr key={i.nombre}><td>{i.nombre}</td>
                      <td className="der">{Number(i.teorico).toLocaleString('es-CO')} {i.unidad}</td>
                      <td className="der">{Number(i.real).toLocaleString('es-CO')} {i.unidad}</td>
                      <td className="der">{pesos(i.diferencia_pesos)}</td></tr>)}</tbody></table>)}
              </section>
              <section>
                <h2>Alertas abiertas ({cifras.alertas_abiertas})</h2>
                {cifras.alertas.length === 0 ? <p className="suave">Ninguna.</p> : (
                  <table className="tabla"><thead><tr><th>Alerta</th><th>Responsable</th><th className="der">Impacto</th></tr></thead>
                    <tbody>{cifras.alertas.map((a, k) => <tr key={k}><td>{a.titulo}</td><td>{a.responsable ?? <span className="suave">sin asignar</span>}</td>
                      <td className="der">{pesos(a.impacto)}</td></tr>)}</tbody></table>)}
                {cifras.propuestas_pendientes > 0 && <p className="suave texto-nota">
                  {cifras.propuestas_pendientes} propuesta(s) de carta sin decidir · <Link href="/consulta/simulador">Simulador</Link></p>}
              </section>
            </div>
            <p className="suave texto-mini">Inventario inicial {pesos(p.inv_inicial)} + compras {pesos(p.compras)} − inventario final {pesos(p.inv_final)} (con traslados) = CMV real {pesos(p.cmv_real)}.
              {p.fichas_incompletas ? ` ${p.fichas_incompletas} producto(s) vendidos sin ficha completa no entran en el teórico.` : ''}</p>
          </>}
        </>
      )}
    </>
  );
}
