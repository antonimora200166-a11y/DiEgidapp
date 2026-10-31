import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, editaArea, type Area } from '@/lib/roles';
import ListaCarta, { type PlatoCarta } from './ListaCarta';

export const metadata = { title: 'Carta y margen' };

export default async function Carta({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const perfil = await perfilActual();
  const areas = areasDe(perfil);
  if (!areas.length || perfil.rol === 'servicio') redirect('/');
  const pedida = (await searchParams).area as Area | undefined;
  const area: Area = pedida && areas.includes(pedida) ? pedida : areas[0];
  const supabase = await supabaseServidor();
  const [{ data, error }, { data: meta }] = await Promise.all([
    supabase.rpc('carta_costos', { p_area: area }),
    supabase.from('parametros').select('valor').eq('clave', 'META_PCT_COSTO').order('vigente_desde', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error) throw new Error(error.message);

  return (
    <>
      <h1 className="pagina-ancha">Carta y margen</h1>
      {areas.length > 1 && (
        <nav className="segmentos" style={{ marginBottom: '1rem' }}>
          {areas.map((a) => (
            <Link key={a} href={`/carta?area=${a}`}>
              <span style={a === area ? { background: 'var(--marca)', color: 'var(--marca-texto)', borderColor: 'var(--marca)' } : undefined}>
                {a === 'BAR' ? 'Bar' : 'Cocina'}
              </span>
            </Link>
          ))}
        </nav>
      )}
      <p className="suave">
        Costo de la receta vigente de cada {area === 'BAR' ? 'cóctel' : 'plato'} con los costos de hoy, contra su precio de carta.
        El % de costo se calcula sobre el precio sin impoconsumo. Si un ingrediente no tiene costo todavía, el % no sale.
      </p>
      {(data ?? []).length ? (
        <ListaCarta filas={(data ?? []) as PlatoCarta[]} meta={Number(meta?.valor ?? 25)} puedePrecio={editaArea(perfil, area)} />
      ) : <p className="tarjeta">Todavía no hay {area === 'BAR' ? 'cócteles' : 'platos'} en el catálogo de esta área.</p>}
    </>
  );
}
