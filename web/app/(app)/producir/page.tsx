import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, puedeOperar, type Area } from '@/lib/roles';
import Producir, { type DatosProduccion } from './Producir';

export const metadata = { title: 'Producir' };

export default async function PaginaProducir({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const perfil = await perfilActual();
  const areas = areasDe(perfil).filter((a) => puedeOperar(perfil, a));
  if (!areas.length) redirect('/');
  const pedida = (await searchParams).area as Area | undefined;
  const area: Area = pedida && areas.includes(pedida) ? pedida : areas[0];

  const supabase = await supabaseServidor();
  const [{ data, error }, { data: zonas }, { data: recientes }] = await Promise.all([
    supabase.rpc('datos_produccion', { p_area: area }),
    supabase.from('ubicaciones').select('codigo, nombre').eq('area', area).eq('activo', true).order('nombre'),
    supabase.from('lotes_produccion').select('id, codigo, fecha, neto_base, costo_unitario, estado_costo, forzado, productos(genericos(nombre, unidad_base))')
      .eq('area', area).order('registrado_en', { ascending: false }).limit(5),
  ]);
  if (error) throw new Error(error.message);

  return (
    <>
      <h1>Producir</h1>
      {areas.length > 1 && (
        <nav className="segmentos" style={{ marginBottom: '1rem' }}>
          {areas.map((a) => (
            <Link key={a} href={`/producir?area=${a}`}>
              <span style={a === area ? { background: 'var(--marca)', color: 'var(--marca-texto)', borderColor: 'var(--marca)' } : undefined}>
                {a === 'BAR' ? 'Bar' : 'Cocina'}
              </span>
            </Link>
          ))}
        </nav>
      )}
      <Producir key={area} area={area} datos={data as DatosProduccion} zonas={zonas ?? []} />
      <p style={{ marginTop: '1.2rem' }}><Link href="/producir/sin-costo">Lotes sin costo completo y por qué →</Link></p>
      {!!recientes?.length && (
        <>
          <h2>Últimos lotes</h2>
          <ul className="lista">
            {recientes.map((l) => {
              const g = (l.productos as unknown as { genericos: { nombre: string; unidad_base: string } } | null)?.genericos;
              return (
                <li key={l.id} className="linea">
                  <span>
                    <span className="cod">{l.codigo}</span><br />
                    {g?.nombre ?? '—'} · {Number(l.neto_base).toLocaleString('es-CO')} {g?.unidad_base}
                  </span>
                  <span className="suave" style={{ fontSize: '.85rem', textAlign: 'right' }}>
                    {new Date(l.fecha + 'T12:00:00').toLocaleDateString('es-CO')}<br />
                    {l.costo_unitario !== null
                      ? `${Number(l.costo_unitario).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 })}/${g?.unidad_base}`
                      : <span className="etiqueta provisional">sin costo completo</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
