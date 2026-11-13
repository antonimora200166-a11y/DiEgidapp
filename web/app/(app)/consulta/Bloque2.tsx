import Link from 'next/link';
import { pesos, pct, fecha as corta } from '@/lib/formato';
import { Insignia, tonoSemaforo } from '@/components/Insignia';

// Bloque 2 · Real vs. teórico. CMV real = inventario inicial + recepciones + traslados entrantes −
// traslados salientes − inventario final; teórico + pérdidas + no explicado = real.
export type ResumenPeriodo = {
  id?: string; area: 'BAR' | 'COCINA'; desde: string; hasta: string; ventas_netas: number; ventas_con_ficha: number;
  inv_inicial: number; compras: number; traslados_entrada: number; traslados_salida: number; inv_final: number;
  cmv_real: number; cmv_teorico: number; perdidas: number; no_explicado: number; perdidas_por_causa: Record<string, number>;
  pct_teorico: number | null; pct_real: number | null; variacion_pp: number | null; semaforo: 'VERDE' | 'AMARILLO' | 'ROJO' | null;
  fichas_incompletas: number; forzado?: boolean; cerrado_en?: string;
};
export type Insumo = { generico_id: string; nombre: string; unidad_base: string; teorico_q: number; real_q: number; teorico_valor: number; real_valor: number; dif_valor: number;
  desglose?: { generico_id: string; nombre: string; unidades: number; q: number }[] };

const cant = (n: number) => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 1 });
const COLOR = { VERDE: 'var(--ok)', AMARILLO: 'var(--aviso)', ROJO: 'var(--error)' } as const;
const SEMAFORO_TXT = { VERDE: 'En rango', AMARILLO: 'Vigilar', ROJO: 'Fuera' } as const;
const CAUSA: Record<string, string> = { VENCIDO: 'Vencido', DANADO: 'Dañado', DERRAME: 'Derrame', MAL_ESTADO: 'Mal estado', OTRO: 'Otro',
  CORTESIA: 'Cortesía', MAL_HECHO: 'Mal hecho', MERMA: 'Merma', ROTURA: 'Rotura' };

// Una fila por insumo; el nombre abre de qué cócteles, shots o botellas sale el teórico.
function FilaInsumo({ i, acum }: { i: Insumo; acum: string }) {
  const d = i.real_q - i.teorico_q;
  const des = i.desglose ?? [];
  return (
    <tr>
      <td>
        {des.length ? (
          <details>
            <summary style={{ cursor: 'pointer' }}>{i.nombre}</summary>
            <ul className="suave" style={{ margin: '.3rem 0 0', paddingLeft: '1.1rem', fontSize: '.82rem' }}>
              {des.map((x) => (
                <li key={x.generico_id}>{x.nombre}: {cant(x.unidades)} vendidos → {cant(x.q)} {i.unidad_base}</li>
              ))}
            </ul>
          </details>
        ) : i.nombre}
      </td>
      <td className="der">{cant(i.teorico_q)} {i.unidad_base}</td>
      <td className="der">{cant(i.real_q)} {i.unidad_base}</td>
      <td style={{ textAlign: 'right', color: d > 0 ? 'var(--error)' : 'var(--ok)' }}>{d > 0 ? '+' : ''}{cant(d)} {i.unidad_base}</td>
      <td style={{ textAlign: 'right', color: i.dif_valor > 0 ? 'var(--error)' : 'var(--ok)' }}>{pesos(i.dif_valor)}</td>
      <td className="suave der">{acum}</td>
    </tr>
  );
}

function TablaInsumos({ filas, total, desde }: { filas: Insumo[]; total: number; desde: number }) {
  let acum = desde;
  return (
    <div className="desborde tarjeta p-0">
      <table className="tabla">
        <thead><tr><th>Insumo</th><th className="der">Teórico</th><th className="der">Real</th>
          <th className="der">Diferencia</th><th className="der">Dif. $</th><th className="der">% acum.</th></tr></thead>
        <tbody>{filas.map((i) => {
          acum += Math.abs(i.dif_valor);
          return <FilaInsumo key={i.generico_id} i={i} acum={`${total ? Math.round((acum / total) * 100) : 0} %`} />;
        })}</tbody>
      </table>
    </div>
  );
}

function Cascada({ r }: { r: ResumenPeriodo }) {
  const pasos = [
    { t: 'Teórico', v: r.cmv_teorico, base: 0, c: 'var(--ok)' },
    { t: 'Pérdidas', v: r.perdidas, base: r.cmv_teorico, c: 'var(--aviso)' },
    { t: 'No explicado', v: r.no_explicado, base: r.cmv_teorico + r.perdidas, c: 'var(--error)' },
    { t: 'Real', v: r.cmv_real, base: 0, c: 'var(--tinta)' },
  ];
  const tope = Math.max(1, ...pasos.map((p) => Math.max(p.base, p.base + p.v))) * 1.12;
  const y = (v: number) => 200 - (v / tope) * 180;
  return (
    <svg viewBox="0 0 440 236" style={{ width: '100%', maxWidth: 520, height: 'auto', display: 'block' }} role="img" aria-label="Cascada de teórico a real">
      <line x1={20} x2={430} y1={200} y2={200} stroke="var(--borde)" />
      {pasos.map((p, i) => {
        const x0 = 34 + i * 100, a = Math.min(p.base, p.base + p.v), b = Math.max(p.base, p.base + p.v);
        return (
          <g key={p.t}>
            <rect x={x0} y={y(b)} width={70} height={Math.max(1, y(a) - y(b))} rx={3} fill={p.c} />
            <text x={x0 + 35} y={y(b) - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--texto)">{pesos(p.v)}</text>
            <text x={x0 + 35} y={218} textAnchor="middle" fontSize="11" fill="var(--suave)">{p.t}</text>
            {i < 3 && <line x1={x0 + 70} x2={x0 + 100} y1={y(p.base + p.v)} y2={y(p.base + p.v)} stroke="var(--suave)" strokeDasharray="3 3" />}
          </g>
        );
      })}
    </svg>
  );
}

export default function Bloque2({ cerrados, abiertos, detalle, insumos, area }: {
  cerrados: ResumenPeriodo[]; abiertos: ResumenPeriodo[]; detalle: ResumenPeriodo | null; insumos: Insumo[]; area: 'TODO' | 'BAR' | 'COCINA';
}) {
  return (
    <>
      <h2>Real vs. teórico</h2>
      {!detalle ? (
        <div className="tarjeta">
          <p className="mt-0">{area === 'TODO' ? 'Escoja Bar o Cocina para ver el detalle de un período.'
            : 'Todavía no hay kardex en esta área. Con el conteo inicial empieza el período, y con el conteo de cierre del jefe de bar se cierra.'}</p>
          <p className="suave mb-0">CMV real = inventario inicial + recepciones + traslados de otras áreas − traslados a otras áreas − inventario final.
            Teórico = unidades vendidas en Odoo × costo de la ficha. Lo que no cuadra, descontadas las pérdidas reportadas, es lo no explicado.</p>
        </div>
      ) : (
        <>
          <p className="suave texto-nota">
            {detalle.id ? `Período cerrado del ${corta(detalle.desde)} al ${corta(detalle.hasta)}${detalle.forzado ? ' (cerrado sin el conteo completo)' : ''}: sus cifras quedaron congeladas.`
              : `Período abierto del ${corta(detalle.desde)} a hoy: cifras provisionales, cambian hasta el cierre.`}
            {detalle.fichas_incompletas > 0 && ` ${detalle.fichas_incompletas} producto(s) vendidos sin ficha completa no entran en el teórico.`}
          </p>
          <div className="dos-col pagina-ancha" style={{ alignItems: 'start' }}>
            <section>
              <Cascada r={detalle} />
              <p className="mt-1 mb-1">
                <strong style={{ color: detalle.semaforo ? COLOR[detalle.semaforo] : undefined }}>
                  {detalle.variacion_pp === null ? '—' : `${detalle.variacion_pp > 0 ? '+' : ''}${detalle.variacion_pp.toLocaleString('es-CO')} puntos`}
                </strong>{' '}
                {tonoSemaforo(detalle.semaforo) && <Insignia tono={tonoSemaforo(detalle.semaforo)!}>{SEMAFORO_TXT[detalle.semaforo!]}</Insignia>}{' '}
                <span className="suave">real {pct(detalle.pct_real)} contra teórico {pct(detalle.pct_teorico)} · {pesos(detalle.cmv_real - detalle.cmv_teorico)}</span>
              </p>
            </section>
            <section>
              <table className="tabla" style={{ fontSize: '.92rem' }}>
                <tbody>
                  <tr><td>Inventario inicial</td><td className="der">{pesos(detalle.inv_inicial)}</td></tr>
                  <tr><td>+ Recepciones</td><td className="der">{pesos(detalle.compras)}</td></tr>
                  <tr><td>+ Traslados de otras áreas</td><td className="der">{pesos(detalle.traslados_entrada)}</td></tr>
                  <tr><td>− Traslados a otras áreas</td><td className="der">{pesos(detalle.traslados_salida)}</td></tr>
                  <tr><td>− Inventario final</td><td className="der">{pesos(detalle.inv_final)}</td></tr>
                  <tr><td><strong>= CMV real</strong></td><td className="der"><strong>{pesos(detalle.cmv_real)}</strong></td></tr>
                  <tr><td className="suave">Teórico · pérdidas · no explicado</td>
                    <td className="suave der">{pesos(detalle.cmv_teorico)} · {pesos(detalle.perdidas)} · {pesos(detalle.no_explicado)}</td></tr>
                </tbody>
              </table>
              {Object.keys(detalle.perdidas_por_causa ?? {}).length > 0 && (
                <p className="suave texto-nota">Pérdidas: {Object.entries(detalle.perdidas_por_causa).map(([k, v]) => `${CAUSA[k] ?? k} ${pesos(v)}`).join(' · ')}</p>
              )}
            </section>
          </div>

          <h3>Insumos con más diferencia</h3>
          {insumos.length ? (() => {
            const total = insumos.reduce((t, i) => t + Math.abs(i.dif_valor), 0);
            const top = insumos.slice(0, 10), resto = insumos.slice(10);
            const enTop = top.reduce((t, i) => t + Math.abs(i.dif_valor), 0);
            return (
              <>
                <TablaInsumos filas={top} total={total} desde={0} />
                {resto.length > 0 && (
                  <details className="mt-2">
                    <summary style={{ cursor: 'pointer' }}>Ver los otros {resto.length} insumos</summary>
                    <div className="mt-2"><TablaInsumos filas={resto} total={total} desde={enTop} /></div>
                  </details>
                )}
              </>
            );
          })() : <p className="suave">Sin consumo de insumos en el período.</p>}
          <p className="suave texto-mini">Teórico: lo vendido en Odoo × la cantidad de cada ficha. Real: lo que el conteo encontró de menos (las botellas abiertas, pesadas).
            Toque el nombre de un insumo para ver de qué cócteles, shots o botellas sale su teórico. Ordenados por la diferencia en pesos.</p>
        </>
      )}

      <h3>Períodos</h3>
      {cerrados.length || abiertos.length ? (
        <div className="desborde tarjeta p-0">
          <table className="tabla">
            <thead><tr><th>Período</th>{area === 'TODO' && <th>Área</th>}<th className="der">% teórico</th><th className="der">% real</th>
              <th className="der">Variación</th><th className="der">No explicado</th><th>Estado</th></tr></thead>
            <tbody>
              {[...abiertos, ...cerrados].map((p) => (
                <tr key={`${p.area}-${p.desde}`}>
                  <td>{corta(p.desde)} → {corta(p.hasta)}</td>{area === 'TODO' && <td>{p.area === 'BAR' ? 'Bar' : 'Cocina'}</td>}
                  <td className="der">{pct(p.pct_teorico)}</td><td className="der">{pct(p.pct_real)}</td>
                  <td className="der"><strong style={{ color: p.semaforo ? COLOR[p.semaforo] : undefined }}>
                    {p.variacion_pp === null ? '—' : `${p.variacion_pp > 0 ? '+' : ''}${p.variacion_pp.toLocaleString('es-CO')} pts`}</strong>
                    {tonoSemaforo(p.semaforo) && <> <Insignia tono={tonoSemaforo(p.semaforo)!}>{SEMAFORO_TXT[p.semaforo!]}</Insignia></>}</td>
                  <td className="der">{pesos(p.no_explicado)}</td>
                  <td>{p.id ? <span className="etiqueta validado">cerrado</span> : <span className="etiqueta provisional">abierto</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="suave">Todavía no hay períodos.</p>}
      <p className="suave texto-mini">Semáforo: verde hasta 1 punto de diferencia, amarillo hasta 3, rojo más de 3.{' '}
        <Link href={`/consulta/cerrar${area !== 'TODO' ? `?area=${area}` : ''}`}>Cerrar un período →</Link></p>
    </>
  );
}
