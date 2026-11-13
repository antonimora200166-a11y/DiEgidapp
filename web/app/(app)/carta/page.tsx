import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import ListaCarta, { type PlatoCarta } from './ListaCarta';
import ListaBaul, { type EnBaul } from './ListaBaul';

export const metadata = { title: 'Carta y margen' };

type Vista = 'BAR' | 'COCINA' | 'TODO';
const NOMBRE: Record<Vista, string> = { BAR: 'Bar', COCINA: 'Cocina', TODO: 'Todo' };

// Consulta rápida de cada producto final. Precios y costos: solo administración (decisión 06/11/2026).
export default async function Carta({ searchParams }: { searchParams: Promise<{ area?: string; vista?: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol !== 'admin') redirect('/');
  const params = await searchParams;
  const area: Vista = (['BAR', 'COCINA', 'TODO'] as Vista[]).includes(params.area as Vista) ? (params.area as Vista) : 'BAR';
  const enBaul = params.vista === 'baul';
  const supabase = await supabaseServidor();
  const areasBaul = area === 'TODO' ? (['BAR', 'COCINA'] as const) : [area];
  const [{ data, error }, ...baules] = await Promise.all([
    supabase.rpc('carta_margen', { p_area: area === 'TODO' ? null : area }),
    ...areasBaul.map((a) => supabase.rpc('carta_baul', { p_area: a })),
  ]);
  if (error) throw new Error(error.message);
  const errorBaul = baules.find((b) => b.error)?.error;
  if (errorBaul) throw new Error(errorBaul.message);
  const baul = baules.flatMap((b) => (b.data ?? []) as EnBaul[]);
  const filas = (data ?? []) as PlatoCarta[];
  const imp = filas[0]?.impoconsumo_pct ?? 8;

  return (
    <>
      <h1 className="pagina-ancha titulo-gestion">Carta y margen</h1>
      <nav className="segmentos" style={{ marginBottom: '1rem', gap: '1rem' }}>
        {(['BAR', 'COCINA', 'TODO'] as Vista[]).map((a) => (
          <Link key={a} href={`/carta?area=${a}${enBaul ? '&vista=baul' : ''}`} aria-current={a === area ? 'true' : undefined}><span>{NOMBRE[a]}</span></Link>
        ))}
        <Link href={`/carta?area=${area}`} aria-current={!enBaul ? 'true' : undefined}><span>En carta</span></Link>
        <Link href={`/carta?area=${area}&vista=baul`} aria-current={enBaul ? 'true' : undefined}><span>Baúl{baul.length ? ` (${baul.length})` : ''}</span></Link>
      </nav>
      {enBaul ? (
        <>
          <p className="suave">
            Lo que no se vende. Su ficha se guarda tal cual, pero no sale en la carta, en Fichas técnicas ni en los
            tableros, y no cuenta en los promedios. Marque lo que vuelve y devuélvelo a la carta.
          </p>
          {baul.length ? <ListaBaul filas={baul} puede />
            : <p className="tarjeta">El baúl está vacío. Desde «En carta» marque lo que no se va a vender y llévelo al baúl.</p>}
        </>
      ) : (
        <>
          <p className="suave">
            Costo de la ficha vigente con los costos de hoy, contra el precio de carta. El % de costo y el margen van sobre
            el <strong>precio neto</strong> = precio de carta ÷ {(1 + imp / 100).toLocaleString('es-CO')} (impoconsumo del {imp} %).
            Semáforo contra la meta de cada sección: verde en la meta, amarillo hasta 3 puntos encima, rojo después.
            Mientras no haya kardex, el costo es <strong>estimado</strong>.
          </p>
          {filas.length ? <ListaCarta filas={filas} variasAreas={area === 'TODO'} />
            : <p className="tarjeta">Todavía no hay productos de carta en {area === 'TODO' ? 'ninguna área' : NOMBRE[area].toLowerCase()}.</p>}
        </>
      )}
    </>
  );
}
