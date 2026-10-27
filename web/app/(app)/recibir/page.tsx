import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, puedeOperar, type Area } from '@/lib/roles';
import Recibir, { type ProductoRecepcion } from './Recibir';

export const metadata = { title: 'Recibir' };
// la lectura de la factura con IA puede tardar
export const maxDuration = 120;

export default async function PaginaRecibir({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const perfil = await perfilActual();
  const areas = areasDe(perfil).filter((a) => puedeOperar(perfil, a));
  if (!areas.length) redirect('/');
  const pedida = (await searchParams).area as Area | undefined;
  const area: Area = pedida && areas.includes(pedida) ? pedida : areas[0];

  const supabase = await supabaseServidor();
  const [{ data: proveedores }, { data: zonas }, { data: productos, error }, { data: recientes }] = await Promise.all([
    supabase.from('proveedores').select('id, nombre').eq('activo', true).order('nombre'),
    supabase.from('ubicaciones').select('codigo, nombre').eq('area', area).eq('activo', true).order('nombre'),
    supabase.rpc('productos_recepcion', { p_area: area }),
    supabase.from('recepciones').select('id, codigo, fecha, forzada, proveedores(nombre)').eq('area', area)
      .order('registrado_en', { ascending: false }).limit(5),
  ]);
  if (error) throw new Error(error.message);

  return (
    <>
      <h1>Recibir</h1>
      {areas.length > 1 && (
        <nav className="segmentos" style={{ marginBottom: '1rem' }}>
          {areas.map((a) => (
            <Link key={a} href={`/recibir?area=${a}`}>
              <span style={a === area ? { background: 'var(--marca)', color: 'var(--marca-texto)', borderColor: 'var(--marca)' } : undefined}>
                {a === 'BAR' ? 'Bar' : 'Cocina'}
              </span>
            </Link>
          ))}
        </nav>
      )}
      <Recibir key={area} area={area} proveedores={proveedores ?? []} zonas={zonas ?? []}
               productos={(productos ?? []) as ProductoRecepcion[]} />
      {!!recientes?.length && (
        <>
          <h2>Últimas recepciones</h2>
          <ul className="lista">
            {recientes.map((r) => (
              <li key={r.id} className="linea">
                <span>
                  <span className="cod">{r.codigo}</span><br />
                  {(r.proveedores as unknown as { nombre: string } | null)?.nombre ?? '—'}
                </span>
                <span className="suave" style={{ fontSize: '.85rem', textAlign: 'right' }}>
                  {new Date(r.fecha + 'T12:00:00').toLocaleDateString('es-CO')}
                  {r.forzada && <><br /><span className="etiqueta provisional">forzada</span></>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
