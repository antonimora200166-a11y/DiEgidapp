import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, puedeOperar, vePrecios, type Area } from '@/lib/roles';
import Producir, { type DatosProduccion } from './Producir';
import PestanasProduccion from '@/components/PestanasProduccion';
import { fecha as fmtFecha } from '@/lib/formato';

export const metadata = { title: 'Producir' };

export default async function PaginaProducir({ searchParams }: { searchParams: Promise<{ area?: string; generico?: string }> }) {
  const perfil = await perfilActual();
  const areas = areasDe(perfil).filter((a) => puedeOperar(perfil, a));
  if (!areas.length) redirect('/');
  const sp = await searchParams;
  const pedida = sp.area as Area | undefined;
  const area: Area = pedida && areas.includes(pedida) ? pedida : areas[0];

  const supabase = await supabaseServidor();
  const [{ data, error }, { data: zonas }, { data: recientes }] = await Promise.all([
    supabase.rpc('datos_produccion', { p_area: area }),
    supabase.from('ubicaciones').select('codigo, nombre').eq('area', area).eq('activo', true).order('nombre'),
    supabase.from('lotes_produccion').select('id, codigo, fecha, neto_base, estado_costo, forzado, productos(genericos(nombre, unidad_base))')
      .eq('area', area).order('registrado_en', { ascending: false }).limit(5),
  ]);
  if (error) throw new Error(error.message);
  // dónde se guarda cada producto (la matriz de ubicaciones): de ahí se propone de dónde coger cada
  // ingrediente y dónde guardar lo producido
  const codigos = new Set((zonas ?? []).map((z) => z.codigo));
  const { data: asignados } = await supabase.from('ubicacion_productos').select('producto_id, ubicacion, orden').eq('activo', true)
    .order('orden', { ascending: true, nullsFirst: false });
  const zonaDe: Record<string, string> = {};
  for (const x of asignados ?? []) if (codigos.has(x.ubicacion) && !zonaDe[x.producto_id]) zonaDe[x.producto_id] = x.ubicacion;

  return (
    <>
      <PestanasProduccion activa="producir" area={area} />
      {/* al elegir la MPI, esto se oculta para dejar a la vista solo lo que se está produciendo */}
      <div className="producir-cab">
      <h1 className="pagina-ancha">Producir</h1>
      {areas.length > 1 && (
        <nav className="segmentos mb-3">
          {areas.map((a) => (
            <Link key={a} href={`/producir?area=${a}`} aria-current={a === area ? 'true' : undefined}>
              <span>
                {a === 'BAR' ? 'Bar' : 'Cocina'}
              </span>
            </Link>
          ))}
        </nav>
      )}
      </div>
      <Producir key={area} area={area} datos={data as DatosProduccion} zonas={zonas ?? []} zonaDe={zonaDe} generico={sp.generico} perfilId={perfil.id} vePesos={vePrecios(perfil)} />
      <div className="producir-extra">
      {vePrecios(perfil) && <p style={{ marginTop: '1.2rem' }}><Link href="/producir/sin-costo">Lotes sin costo completo y por qué →</Link></p>}
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
                  <span className="suave texto-nota der">
                    {fmtFecha(l.fecha)}<br />
                    {vePrecios(perfil) && l.estado_costo !== 'COMPLETO' && <span className="etiqueta provisional">sin costo completo</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      </div>
    </>
  );
}
