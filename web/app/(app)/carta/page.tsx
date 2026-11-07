import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, editaArea, type Area } from '@/lib/roles';
import ListaCarta, { type PlatoCarta } from './ListaCarta';
import ListaBaul, { type EnBaul } from './ListaBaul';

export const metadata = { title: 'Carta y margen' };

const activo = { background: 'var(--marca)', color: 'var(--marca-texto)', borderColor: 'var(--marca)' };

export default async function Carta({ searchParams }: { searchParams: Promise<{ area?: string; vista?: string }> }) {
  const perfil = await perfilActual();
  const areas = areasDe(perfil);
  if (!areas.length || perfil.rol === 'servicio') redirect('/');
  const params = await searchParams;
  const pedida = params.area as Area | undefined;
  const area: Area = pedida && areas.includes(pedida) ? pedida : areas[0];
  const enBaul = params.vista === 'baul';
  const supabase = await supabaseServidor();
  const [{ data, error }, { data: meta }, { data: baul, error: errorBaul }] = await Promise.all([
    supabase.rpc('carta_costos', { p_area: area }),
    supabase.from('parametros').select('valor').eq('clave', 'META_PCT_COSTO').order('vigente_desde', { ascending: false }).limit(1).maybeSingle(),
    supabase.rpc('carta_baul', { p_area: area }),
  ]);
  if (error) throw new Error(error.message);
  if (errorBaul) throw new Error(errorBaul.message);
  const nBaul = (baul ?? []).length;
  const puede = editaArea(perfil, area);
  const cosas = area === 'BAR' ? 'cócteles' : 'platos';

  return (
    <>
      <h1 className="pagina-ancha">Carta y margen</h1>
      <nav className="segmentos" style={{ marginBottom: '1rem', gap: '1rem' }}>
        {areas.length > 1 && areas.map((a) => (
          <Link key={a} href={`/carta?area=${a}${enBaul ? '&vista=baul' : ''}`}>
            <span style={a === area ? activo : undefined}>{a === 'BAR' ? 'Bar' : 'Cocina'}</span>
          </Link>
        ))}
        <Link href={`/carta?area=${area}`}><span style={!enBaul ? activo : undefined}>En carta</span></Link>
        <Link href={`/carta?area=${area}&vista=baul`}><span style={enBaul ? activo : undefined}>Baúl{nBaul ? ` (${nBaul})` : ''}</span></Link>
      </nav>
      {enBaul ? (
        <>
          <p className="suave">
            Los {cosas} que no se venden. Su ficha se guarda tal cual, pero no salen en la carta, en Fichas técnicas
            ni en los tableros de validación, y no cuentan en los promedios.
            {puede && ' Marca los que vuelven y devuélvelos a la carta.'}
          </p>
          {nBaul ? <ListaBaul filas={(baul ?? []) as EnBaul[]} puede={puede} />
            : <p className="tarjeta">El baúl está vacío. Desde «En carta» marca los {cosas} que no se van a vender y llévalos al baúl.</p>}
        </>
      ) : (
        <>
          <p className="suave">
            Costo de la receta vigente de cada {area === 'BAR' ? 'cóctel' : 'plato'} con los costos de hoy, contra su precio de carta.
            El % de costo se calcula sobre el precio sin impoconsumo. Si un ingrediente no tiene costo todavía, el % no sale.
            Mientras no haya kardex, el costo es <strong>estimado</strong>: precios de referencia y la receta de cada MPI.
            {puede && <> Lo que no se va a vender: márcalo y llévalo al <strong>baúl</strong>.</>}
          </p>
          {(data ?? []).length ? (
            <ListaCarta filas={(data ?? []) as PlatoCarta[]} meta={Number(meta?.valor ?? 25)} puedePrecio={puede} />
          ) : <p className="tarjeta">Todavía no hay {cosas} en el catálogo de esta área.</p>}
        </>
      )}
    </>
  );
}
