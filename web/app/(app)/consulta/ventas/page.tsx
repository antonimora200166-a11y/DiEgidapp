import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import CargarVentas from './CargarVentas';
import Equivalencias, { type ProductoCarta, type SinEquivalencia } from './Equivalencias';
import { fecha } from '@/lib/formato';

export const metadata = { title: 'Cargar ventas' };


// Ventas de Odoo: cada lunes se sube el reporte de la semana. Solo administración (decisión 06/11/2026).
export default async function CargarVentasPagina() {
  const perfil = await perfilActual();
  if (perfil.rol !== 'admin') redirect('/');
  const supabase = await supabaseServidor();
  const [{ data: cargas }, { data: pendientes, error }, { data: carta }] = await Promise.all([
    supabase.from('ventas_cargas').select('id, formato, archivo, desde, hasta, lineas, unidades, total_odoo, neto_estimado, cargado_en').order('desde', { ascending: false }),
    supabase.rpc('ventas_sin_equivalencia'),
    supabase.from('genericos').select('id, codigo, nombre, area').in('tipo', ['BEBIDA', 'PLATO']).eq('activo', true).eq('en_baul', false).order('nombre'),
  ]);
  if (error) throw new Error(error.message);

  return (
    <>
      <p className="m-0 mb-1"><Link href="/consulta">← Consulta</Link></p>
      <h1 className="pagina-ancha titulo-gestion">Cargar ventas de Odoo</h1>
      <p className="suave">Cada lunes suba el reporte de la semana tal como sale de Odoo. La app lo lee, revisa que cuadre día por día y lo guarda;
        los días que ya estaban cargados no se cuentan dos veces. La app no escribe nada en Odoo.</p>
      <CargarVentas />

      <h2>Productos de Odoo sin equivalencia {pendientes?.length ? `(${pendientes.length})` : ''}</h2>
      <p className="suave">Se resuelven una sola vez: la próxima carga ya los reconoce. Mientras no tengan equivalencia, salen en Consulta como «ventas sin ficha».</p>
      <Equivalencias filas={(pendientes ?? []) as SinEquivalencia[]} carta={(carta ?? []) as ProductoCarta[]} />

      <h2>Cargas</h2>
      {cargas?.length ? (
        <div className="desborde tarjeta p-0">
          <table className="tabla">
            <thead><tr><th>Desde</th><th>Hasta</th><th>Archivo</th><th className="der">Líneas</th><th className="der">Unidades</th><th className="der">Total Odoo</th></tr></thead>
            <tbody>{cargas.map((c) => (
              <tr key={c.id}>
                <td>{fecha(c.desde)}</td><td>{fecha(c.hasta)}</td>
                <td>{c.archivo}{c.formato === 'DETALLE_PDF' && <span className="suave"> · histórico sin día</span>}{c.neto_estimado && <span className="suave"> · neto estimado</span>}</td>
                <td className="der">{c.lineas}</td>
                <td className="der">{Number(c.unidades).toLocaleString('es-CO')}</td>
                <td className="der">{Number(c.total_odoo).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="tarjeta">Todavía no hay ventas cargadas.</p>}
    </>
  );
}
