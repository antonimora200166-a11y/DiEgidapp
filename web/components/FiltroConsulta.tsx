import Link from 'next/link';
import { fecha } from '@/lib/formato';

// Filtro de Consulta (GEN-10): el período en un chip que se abre (quincenas, meses y fechas a medida) y el área en un
// segmento. Lo comparten Resumen, Ventas, Real vs. teórico, Inventario, Compras, Producción y Pérdidas.
export type Periodo = { t: string; desde: string; hasta: string };
const iso = (d: Date) => d.toISOString().slice(0, 10);

// Períodos a la mano: quincena y mes (actual y anterior) y, si hay ventas cargadas, todo lo cargado.
export function periodos(hoy: Date, cargas: { desde: string; hasta: string }[] = []): Periodo[] {
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
// hoy en Cali, como fecha UTC a medianoche (para armar los períodos)
export const hoyCali = () => { const h = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' })); return new Date(Date.UTC(h.getFullYear(), h.getMonth(), h.getDate())); };

export default function FiltroConsulta({ ruta, desde, hasta, area, opciones, fijos = {} }: {
  ruta: string; desde: string; hasta: string; area: string; opciones: Periodo[];
  fijos?: Record<string, string>;   // lo que se conserva al cambiar (la pestaña abierta)
}) {
  const enlace = (c: Record<string, string>) => `${ruta}?${new URLSearchParams({ desde, hasta, area, ...fijos, ...c })}`;
  const elegido = opciones.find((o) => o.desde === desde && o.hasta === hasta);
  return (
    <div className="filtros-consulta">
      <details className="chip-periodo">
        <summary>
          <span className="suave">Período</span> <strong>{elegido?.t ?? `${fecha(desde)} → ${fecha(hasta)}`}</strong> <span aria-hidden>▾</span>
        </summary>
        <div className="chip-periodo-menu tarjeta">
          <nav aria-label="Períodos">
            {opciones.map((o) => (
              <Link key={o.t} href={enlace({ desde: o.desde, hasta: o.hasta })} aria-current={o === elegido ? 'true' : undefined}>
                {o.t}<small>{fecha(o.desde)} → {fecha(o.hasta)}</small>
              </Link>
            ))}
          </nav>
          <form method="get" action={ruta} className="fechas-medida">
            <input type="hidden" name="area" value={area} />
            {Object.entries(fijos).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <label>Desde<input type="date" name="desde" defaultValue={desde} /></label>
            <label>Hasta<input type="date" name="hasta" defaultValue={hasta} /></label>
            <button type="submit" className="secundario">Ver estas fechas</button>
          </form>
        </div>
      </details>
      <nav className="segmentos" aria-label="Área">
        {['TODO', 'BAR', 'COCINA'].map((a) => (
          <Link key={a} href={enlace({ area: a })} aria-current={a === area ? 'true' : undefined}>
            <span>{a === 'TODO' ? 'Total' : a === 'BAR' ? 'Bar' : 'Cocina'}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
