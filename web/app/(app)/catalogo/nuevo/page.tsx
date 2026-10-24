import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, puedeOperar, type Area } from '@/lib/roles';
import CrearProducto from './CrearProducto';

export const metadata = { title: 'Crear producto' };

export default async function NuevoProducto() {
  const perfil = await perfilActual();
  const areas = areasDe(perfil).filter((a) => puedeOperar(perfil, a));
  if (!areas.length) redirect('/');
  const supabase = await supabaseServidor();
  const { data: categorias } = await supabase.from('categorias').select('codigo, nombre, area').eq('activo', true).in('area', areas).order('nombre');
  return (
    <>
      <h1>Crear producto</h1>
      <p className="suave">Primero busca: si ya existe, úsalo. Lo que crees aquí entra <strong>provisional</strong> hasta que el jefe del área lo valide.</p>
      <CrearProducto areas={areas as Area[]} categorias={(categorias ?? []) as { codigo: string; nombre: string; area: Area }[]} />
    </>
  );
}
