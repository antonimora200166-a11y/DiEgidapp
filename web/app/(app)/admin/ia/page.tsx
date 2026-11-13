import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { estadoIA } from '@/lib/factura-ia';

export const metadata = { title: 'Lectura de facturas con IA' };
export const dynamic = 'force-dynamic';

// Solo administración: revisa la clave de Anthropic que está en Vercel sin mostrarla.
export default async function EstadoIA({ searchParams }: { searchParams: Promise<{ probar?: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol !== 'admin') redirect('/');
  const probar = (await searchParams).probar === '1';
  const e = await estadoIA(probar);
  const fila = (ok: boolean | null, titulo: string, texto: string) => (
    <li className={ok === null ? undefined : ok ? 'p-info' : 'p-urgente'}>
      <div style={{ display: 'flex', gap: '.6rem', padding: '.7rem .85rem', border: '1px solid var(--borde)', borderRadius: 10, background: 'var(--tarjeta)' }}>
        <span aria-hidden style={{ fontWeight: 800, color: ok === null ? 'var(--suave)' : ok ? 'var(--ok)' : 'var(--error)' }}>{ok === null ? '·' : ok ? '✓' : '✕'}</span>
        <span><strong>{titulo}</strong><br /><span className="suave texto-nota">{texto}</span></span>
      </div>
    </li>
  );

  return (
    <>
      <p className="m-0 mb-1"><Link href="/admin/registro">← Registro</Link></p>
      <h1>Lectura de facturas con IA</h1>
      <ul className="lista">
        {fila(e.variable, 'Variable ANTHROPIC_API_KEY en Vercel',
          e.variable ? `Está puesta (termina en …${e.final}).` : 'No está. Vercel → Settings → Environment Variables, y después Redeploy.')}
        {e.variable && fila(e.clave === 'ok', 'Anthropic acepta la clave',
          e.clave === 'ok' ? `Sí, y la cuenta puede usar el modelo ${e.modelo}.`
            : e.clave === 'invalida' ? 'No: la clave está mal copiada, se borró o no tiene permiso. Cree otra y reemplácela.'
              : `No se pudo comprobar (${e.detalle ?? 'sin conexión'}).`)}
        {e.clave === 'ok' && fila(e.prueba === null ? null : e.prueba === 'ok', 'Crédito en la cuenta',
          e.prueba === null ? 'Sin probar: toque «Probar con un mensaje» (cuesta una fracción de centavo de dólar).'
            : e.prueba === 'ok' ? 'Sí: la IA respondió. La lectura de facturas está lista.'
              : e.prueba === 'sin-credito' ? 'La cuenta no tiene saldo: console.anthropic.com → Billing.'
                : `La prueba falló (${e.detalle}).`)}
      </ul>
      <div className="acciones">
        {e.clave === 'ok' && e.prueba !== 'ok' && <Link className="boton" href="/admin/ia?probar=1">Probar con un mensaje</Link>}
        <Link className="boton secundario" href="/admin/ia">Volver a revisar</Link>
      </div>
      <p className="suave texto-nota">Si cambia la clave en Vercel, haga Redeploy: la app solo la lee al desplegarse.</p>
    </>
  );
}
