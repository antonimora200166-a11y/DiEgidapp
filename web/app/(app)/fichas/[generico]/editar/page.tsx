import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import PestanasProduccion from '@/components/PestanasProduccion';
import EditorFicha, { type DatosFicha } from '../EditorFicha';

export const metadata = { title: 'Editar ficha técnica' };
// la propuesta de descripción con IA corre en esta página y puede tardar más que el límite por defecto
export const maxDuration = 120;

export default async function EditarFicha({ params }: { params: Promise<{ generico: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio') redirect('/');
  const { generico } = await params;
  if (!/^[0-9a-f-]{36}$/.test(generico)) notFound();
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('ficha_para_editar', { p_generico: generico });
  if (error) { if (/Solo los MPI/.test(error.message)) notFound(); throw new Error(error.message); }
  const d = data as DatosFicha;

  return (
    <>
      {d.resultado.tipo === 'MPI' && <PestanasProduccion activa="fichas" area={d.resultado.area} />}
      <p className="m-0 mb-1"><Link href={`/fichas/${generico}`}>← {d.resultado.nombre}</Link></p>
      <h1 style={{ marginBottom: '.3rem' }}>{d.ficha ? 'Editar' : 'Crear'} ficha · {d.resultado.nombre}</h1>
      <EditorFicha key={d.ficha?.id ?? 'nueva'} datos={d} />
    </>
  );
}
