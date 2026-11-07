import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, type Area } from '@/lib/roles';
import PestanasProduccion from '@/components/PestanasProduccion';
import ListaLotes, { type FilaLote } from './ListaLotes';

export const metadata = { title: 'Producción · Lotes' };

export default async function Lotes({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio') redirect('/');
  const areas: Area[] = areasDe(perfil).length ? areasDe(perfil) : ['BAR', 'COCINA'];
  const pedida = (await searchParams).area as Area | undefined;
  const area: Area = pedida && areas.includes(pedida) ? pedida : areas[0];
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('lotes_lista', { p_area: area });
  if (error) throw new Error(error.message);
  const filas = (data ?? []) as FilaLote[];
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  const alertas = filas.filter((l) => (l.estado === 'POR_VENCER' || l.estado === 'VENCIDO') && Number(l.restante) > 0);

  return (
    <>
      <PestanasProduccion activa="lotes" area={area} />
      <div className="pagina-ancha" style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.6rem' }}>
        <h1 style={{ margin: 0 }}>Lotes · {area === 'BAR' ? 'Bar' : 'Cocina'}</h1>
        {areas.length > 1 && (
          <nav className="segmentos" aria-label="Área">
            {areas.map((a) => (
              <Link key={a} href={`/produccion/lotes?area=${a}`}>
                <span style={a === area ? { background: 'var(--marca)', color: 'var(--marca-texto)', borderColor: 'var(--marca)' } : undefined}>{a === 'BAR' ? 'Bar' : 'Cocina'}</span>
              </Link>
            ))}
          </nav>
        )}
      </div>
      {alertas.map((l) => (
        <Link key={l.id} href={`/produccion/lotes/${encodeURIComponent(l.codigo)}`} className={`${l.estado === 'VENCIDO' ? 'error' : 'aviso'} pagina-ancha`}
              style={{ display: 'block', textDecoration: 'none', marginBottom: '.5rem' }}>
          <strong>{l.mpi} · {l.codigo} {l.estado === 'VENCIDO' ? 'venció' : l.vence === hoy ? 'vence hoy' : 'vence pronto'}{l.vence ? ` (${new Date(l.vence + 'T12:00:00').toLocaleDateString('es-CO')})` : ''}</strong>
          {' '}· quedan {Number(l.restante).toLocaleString('es-CO')} {l.unidad_base}. {l.estado === 'VENCIDO' ? 'Regístralo como baja.' : 'Úsalo primero.'}
        </Link>
      ))}
      <ListaLotes filas={filas} hoy={hoy} vePesos={perfil.rol === 'admin'} />
    </>
  );
}
