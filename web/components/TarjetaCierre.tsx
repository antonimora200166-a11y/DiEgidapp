import Link from 'next/link';
import Icono from './Icono';
import { fecha } from '@/lib/formato';

// Períodos abiertos (consulta_periodos) cuya fecha final ya pasó: toca cerrarlos.
export type PeriodoAbierto = { area: 'BAR' | 'COCINA'; desde: string; hasta: string };
export function periodosPorCerrar(abiertos: PeriodoAbierto[]) {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  return abiertos.filter((p) => p.hasta < hoy);
}

// Aviso de cierre de quincena, en Inicio de administración y arriba en Consulta.
export default function TarjetaCierre({ periodos }: { periodos: PeriodoAbierto[] }) {
  return (
    <section className="tarjeta tarjeta-cierre" aria-labelledby="cierre-tit">
      <Icono nombre="arranque" className="icono-menu" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong id="cierre-tit">Toca cerrar la quincena</strong>
        <ul>
          {periodos.map((p) => (
            <li key={p.area + p.desde}>
              {p.area === 'BAR' ? 'Bar' : 'Cocina'}: {fecha(p.desde)} → {fecha(p.hasta)}{' '}
              <Link href={`/consulta/cerrar?area=${p.area}`} className="boton chico">Cerrar {p.area === 'BAR' ? 'bar' : 'cocina'}</Link>
            </li>
          ))}
        </ul>
        <span className="suave" style={{ fontSize: '.85rem' }}>Antes, el jefe del área cuenta todas las zonas en la fecha de cierre.</span>
      </div>
    </section>
  );
}
