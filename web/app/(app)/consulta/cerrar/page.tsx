import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import CerrarPeriodo from './CerrarPeriodo';

export const metadata = { title: 'Cerrar período' };

export default async function CerrarPeriodoPagina({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol !== 'admin') redirect('/');
  const area = (await searchParams).area === 'COCINA' ? 'COCINA' : 'BAR';
  const supabase = await supabaseServidor();
  const { data } = await supabase.rpc('consulta_periodos', { p_area: area });
  const p = data as { cerrados: { hasta: string }[]; abiertos: { desde: string; hasta: string }[] } | null;
  const ultimo = p?.cerrados?.[0]?.hasta;
  const abierto = p?.abiertos?.[0];
  const sig = (s: string) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

  return (
    <>
      <p style={{ margin: '0 0 .3rem' }}><Link href={`/consulta?area=${area}`}>← Consulta</Link></p>
      <h1 className="pagina-ancha titulo-gestion">Cerrar período · {area === 'BAR' ? 'Bar' : 'Cocina'}</h1>
      <nav className="segmentos" style={{ marginBottom: '1rem' }}>
        {(['BAR', 'COCINA'] as const).map((a) => (
          <Link key={a} href={`/consulta/cerrar?area=${a}`}>
            <span style={a === area ? { background: 'var(--marca)', color: 'var(--marca-texto)', borderColor: 'var(--tinta)' } : undefined}>{a === 'BAR' ? 'Bar' : 'Cocina'}</span>
          </Link>
        ))}
      </nav>
      <p className="suave">Primero el jefe de {area === 'BAR' ? 'bar' : 'cocina'} cuenta todas las zonas en la fecha de cierre. Luego se cierra aquí: queda el CMV real contra el teórico,
        las pérdidas y lo no explicado del período, con el costo de cada ficha congelado.</p>
      {!ultimo && !abierto ? (
        <p className="tarjeta">Todavía no hay kardex en esta área: el primer período empieza con el conteo inicial.</p>
      ) : (
        <CerrarPeriodo area={area} desde={ultimo ? sig(ultimo) : abierto!.desde} hastaSugerido={hoy} desdeFijo={!!ultimo} />
      )}
    </>
  );
}
