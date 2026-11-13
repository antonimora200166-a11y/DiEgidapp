import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, puedeOperar, type Area } from '@/lib/roles';
import { fecha as fmtFecha } from '@/lib/formato';
import { Insignia } from '@/components/Insignia';
import Ayuda from '@/components/Ayuda';

export const metadata = { title: 'Contar' };

export default async function Conteo() {
  const perfil = await perfilActual();
  const areas = areasDe(perfil).filter((a) => puedeOperar(perfil, a));
  if (!areas.length) redirect('/');
  const supabase = await supabaseServidor();
  const [{ data: zonas }, { data: asignados }, { data: conteos }, { data: programa }] = await Promise.all([
    supabase.from('ubicaciones').select('codigo, nombre, area').eq('activo', true).in('area', areas).order('area').order('nombre'),
    supabase.from('ubicacion_productos').select('ubicacion').eq('activo', true),
    supabase.from('conteos').select('ubicacion, fecha, tipo, codigo').order('registrado_en', { ascending: false }).limit(300),
    supabase.rpc('conteos_programados'),
  ]);
  type Programa = { ubicacion: string; tocan: number; tocan_a: number; tocan_b: number; tocan_c: number };
  const toca = (u: string) => ((programa ?? []) as Programa[]).find((p) => p.ubicacion === u);
  const totalToca = ((programa ?? []) as Programa[]).reduce((t, p) => t + p.tocan, 0);
  const nAsignados = (u: string) => (asignados ?? []).filter((x) => x.ubicacion === u).length;
  const ultimo = (u: string) => (conteos ?? []).find((c) => c.ubicacion === u);
  const porArea = (a: Area) => (zonas ?? []).filter((z) => z.area === a);

  return (
    <>
      <h1>Contar</h1>
      <p className="suave">Elija la zona que va a recorrer. Cuente lo que ve; lo que no cuente no cambia.</p>
      <p className="suave texto-nota m-0">{totalToca > 0 ? <>Hoy toca contar <strong>{totalToca}</strong> producto(s).</> : 'Hoy no toca contar ninguno.'}</p>
      <Ayuda titulo="¿Cada cuánto se cuenta?">Clase A cada semana, B cada 15 días y C cada mes, desde el último conteo de cada producto en su zona.</Ayuda>
      {areas.map((a) => (
        <section key={a}>
          {areas.length > 1 && <h2>{a === 'BAR' ? 'Bar' : 'Cocina'}</h2>}
          {/* de lo urgente a lo demás: primero las zonas donde toca contar hoy, luego las que llevan más sin contarse */}
          <ul className="zonas-conteo">
            {porArea(a).map((z) => ({ z, u: ultimo(z.codigo), n: nAsignados(z.codigo), t: toca(z.codigo)?.tocan ?? 0, d: toca(z.codigo) }))
              .sort((x, y) => (y.t - x.t) || (x.u?.fecha ?? '').localeCompare(y.u?.fecha ?? '') || x.z.nombre.localeCompare(y.z.nombre, 'es'))
              .map(({ z, u, n, t, d }) => (
                <li key={z.codigo}>
                  <Link href={`/conteo/${z.codigo}`} className={t > 0 ? 'toca' : undefined}>
                    <span className="zc-nombre">
                      <strong>{z.nombre}</strong>
                      <small>
                        {u ? `Último: ${fmtFecha(u.fecha)}${u.tipo === 'INICIAL' ? ' (inicial)' : ''}` : 'Sin contar todavía'}
                        {n ? ` · ${n} ${n === 1 ? 'producto' : 'productos'}` : ''}
                      </small>
                    </span>
                    {t > 0 && d && (
                      <Insignia tono="aviso" titulo={[d.tocan_a && `A ${d.tocan_a}`, d.tocan_b && `B ${d.tocan_b}`, d.tocan_c && `C ${d.tocan_c}`].filter(Boolean).join(' · ')}>
                        Toca hoy: {t}
                      </Insignia>
                    )}
                    <span aria-hidden className="zc-flecha">›</span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </>
  );
}
