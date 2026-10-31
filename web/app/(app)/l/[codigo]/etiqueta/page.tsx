import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { perfilActual } from '@/lib/sesion';
import { loteEtiqueta } from '@/lib/escaneo';
import Imprimir from './Imprimir';

export const metadata = { title: 'Etiqueta de lote' };
const corta = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' });

// Etiqueta de 62 mm con QR: al escanearla se abre /l/<lote> (qué es, cuándo vence) y en Producir
// el lote entra como ingrediente.
export default async function Etiqueta({ params, searchParams }: { params: Promise<{ codigo: string }>; searchParams: Promise<{ n?: string }> }) {
  await perfilActual();
  const { codigo } = await params;
  const l = await loteEtiqueta(decodeURIComponent(codigo));
  if (!l) notFound();
  const n = Math.min(Math.max(Number((await searchParams).n) || l.unidades || 1, 1), 40);
  const h = await headers();
  const origen = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
  const svg = await QRCode.toString(`${origen}/l/${encodeURIComponent(l.codigo)}`, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });

  const una = (
    <div className="etiqueta-lote">
      <span dangerouslySetInnerHTML={{ __html: svg }} />
      <strong>{l.mpi}</strong>
      <div>Lote {l.codigo}</div>
      <div>Hecho: {corta(l.fecha)}</div>
      {l.vence && <div><b>Vence: {corta(l.vence)}</b></div>}
      {l.conservacion && <div>{l.conservacion}</div>}
      <div>{Number(l.neto).toLocaleString('es-CO')} {l.unidad}{l.unidades && l.unidades > 1 ? ` (${l.unidades} env.)` : ''}</div>
    </div>
  );

  return (
    <>
      <div className="no-imprimir">
        <p style={{ margin: '0 0 .3rem' }}><Link href={`/l/${encodeURIComponent(l.codigo)}`}>← Lote</Link></p>
        <h1>Etiqueta de {l.mpi}</h1>
        <p className="suave">Una por envase. Se imprimen {n}; cambia la cantidad si hace falta.</p>
        <form className="acciones" style={{ marginTop: 0, alignItems: 'center' }}>
          <label style={{ margin: 0, fontWeight: 400 }}>Cantidad <input name="n" type="number" min={1} max={40} defaultValue={n} style={{ width: 90 }} /></label>
          <button type="submit" className="secundario chico">Actualizar</button>
          <Imprimir />
        </form>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2mm', marginTop: '1rem' }}>
        {Array.from({ length: n }, (_, i) => <div key={i}>{una}</div>)}
      </div>
    </>
  );
}
