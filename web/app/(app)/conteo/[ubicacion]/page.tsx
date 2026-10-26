import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, puedeOperar, type Area } from '@/lib/roles';
import HojaConteo, { type ProductoHoja } from './HojaConteo';

export const metadata = { title: 'Conteo' };

export default async function ConteoZona({ params }: { params: Promise<{ ubicacion: string }> }) {
  const { ubicacion } = await params;
  const perfil = await perfilActual();
  const supabase = await supabaseServidor();
  const { data: zona } = await supabase.from('ubicaciones').select('codigo, nombre, area').eq('codigo', ubicacion).eq('activo', true).maybeSingle();
  if (!zona) notFound();
  const area = zona.area as Area;
  if (!puedeOperar(perfil, area) || !areasDe(perfil).includes(area)) redirect('/conteo');
  const { data, error } = await supabase.rpc('hoja_conteo', { p_ubicacion: ubicacion });
  if (error) throw new Error(error.message);
  // el conteo inicial lo hace administración o el jefe del área (igual que la base)
  const haceInicial = perfil.rol === 'admin' || (area === 'BAR' && perfil.rol === 'jefe_bar') || (area === 'COCINA' && perfil.rol === 'chef');

  return (
    <>
      <p style={{ margin: '0 0 .3rem' }}><Link href="/conteo">← Zonas</Link></p>
      <h1>{zona.nombre}</h1>
      <HojaConteo ubicacion={zona.codigo} productos={(data ?? []) as ProductoHoja[]} haceInicial={haceInicial} />
    </>
  );
}
