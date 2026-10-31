import Link from 'next/link';
import { notFound } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { loteEtiqueta } from '@/lib/escaneo';

export const metadata = { title: 'Lote' };
const fecha = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });

// A esta página lleva el QR de la etiqueta: qué es, cuándo se hizo y hasta cuándo sirve.
export default async function Lote({ params }: { params: Promise<{ codigo: string }> }) {
  await perfilActual();
  const { codigo } = await params;
  const l = await loteEtiqueta(decodeURIComponent(codigo));
  if (!l) notFound();
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  const vencido = l.vence && l.vence < hoy;

  return (
    <>
      <p style={{ margin: '0 0 .3rem' }}><Link href="/producir">← Producir</Link></p>
      <h1>{l.mpi}</h1>
      <p className="suave"><span className="cod">{l.codigo}</span> · {l.area === 'BAR' ? 'Bar' : 'Cocina'} · {l.zona}</p>
      {l.anulado && <p className="error">Este lote fue anulado: no lo uses.</p>}
      {l.vence && (
        <p className={vencido ? 'error' : l.vence === hoy ? 'aviso' : 'exito'}>
          <strong>{vencido ? 'Vencido' : l.vence === hoy ? 'Vence hoy' : 'Sirve'}</strong>{vencido ? ' desde el ' : l.vence === hoy ? '' : ' hasta el '}
          {l.vence !== hoy && fecha(l.vence)}.
          {vencido && ' Regístralo como baja.'}
        </p>
      )}
      <dl className="tarjeta datos">
        <dt>Producido</dt><dd>{fecha(l.fecha)} · {l.responsable}</dd>
        <dt>Cantidad</dt><dd>{Number(l.neto).toLocaleString('es-CO')} {l.unidad}{l.unidades ? ` en ${l.unidades} envase(s)` : ''}</dd>
        {l.conservacion && <><dt>Conservación</dt><dd>{l.conservacion}</dd></>}
        {l.costo_unitario !== null && <><dt>Costo</dt><dd>{Number(l.costo_unitario).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 })} por {l.unidad}</dd></>}
        {l.estado_costo !== 'COMPLETO' && <><dt>Costo</dt><dd>incompleto: algún insumo no tenía costo</dd></>}
      </dl>
      <div className="acciones">
        <Link className="boton" href={`/l/${encodeURIComponent(l.codigo)}/etiqueta`}>Imprimir etiqueta</Link>
        <Link className="boton secundario" href={`/historial/lote/${l.id}`}>Ver el lote completo</Link>
        {vencido && <Link className="boton secundario peligro" href="/bajas">Registrar baja</Link>}
      </div>
    </>
  );
}
