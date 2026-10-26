import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, puedeOperar, type Area } from '@/lib/roles';

export const metadata = { title: 'Contar' };

export default async function Conteo() {
  const perfil = await perfilActual();
  const areas = areasDe(perfil).filter((a) => puedeOperar(perfil, a));
  if (!areas.length) redirect('/');
  const supabase = await supabaseServidor();
  const [{ data: zonas }, { data: asignados }, { data: conteos }] = await Promise.all([
    supabase.from('ubicaciones').select('codigo, nombre, area').eq('activo', true).in('area', areas).order('area').order('nombre'),
    supabase.from('ubicacion_productos').select('ubicacion').eq('activo', true),
    supabase.from('conteos').select('ubicacion, fecha, tipo, codigo').order('registrado_en', { ascending: false }).limit(300),
  ]);
  const nAsignados = (u: string) => (asignados ?? []).filter((x) => x.ubicacion === u).length;
  const ultimo = (u: string) => (conteos ?? []).find((c) => c.ubicacion === u);
  const porArea = (a: Area) => (zonas ?? []).filter((z) => z.area === a);

  return (
    <>
      <h1>Contar</h1>
      <p className="suave">Elige la zona que vas a recorrer. Cuenta lo que ves; lo que no cuentes no cambia.</p>
      {areas.map((a) => (
        <section key={a}>
          {areas.length > 1 && <h2>{a === 'BAR' ? 'Bar' : 'Cocina'}</h2>}
          <nav className="menu">
            {porArea(a).map((z) => {
              const u = ultimo(z.codigo);
              const n = nAsignados(z.codigo);
              return (
                <Link key={z.codigo} href={`/conteo/${z.codigo}`} className="tarjeta">
                  <strong>{z.nombre}</strong>
                  <span>{n ? `${n} productos` : 'Todo el catálogo del área'}</span>
                  <span style={{ display: 'block' }}>
                    {u ? `Último: ${new Date(u.fecha + 'T12:00:00').toLocaleDateString('es-CO')}${u.tipo === 'INICIAL' ? ' (inicial)' : ''}` : 'Sin conteos todavía'}
                  </span>
                </Link>
              );
            })}
          </nav>
        </section>
      ))}
    </>
  );
}
