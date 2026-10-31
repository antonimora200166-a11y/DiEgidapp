import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, editaArea } from '@/lib/roles';
import Propuestas, { type Propuesta } from './Propuestas';

export const metadata = { title: 'Revisar unidades' };

export default async function Unidades() {
  const perfil = await perfilActual();
  const areas = areasDe(perfil).filter((a) => editaArea(perfil, a));
  if (!areas.length && perfil.rol !== 'auditor') redirect('/catalogo');
  const supabase = await supabaseServidor();
  const [{ data, error }, { data: categorias }] = await Promise.all([
    supabase.rpc('lista_propuestas_unidad'),
    supabase.from('categorias').select('codigo, nombre, area').eq('activo', true).order('area').order('nombre'),
  ]);
  if (error) throw new Error(error.message);
  const filas = (data ?? []) as Propuesta[];

  return (
    <>
      <p className="pagina-ancha" style={{ margin: '0 0 .3rem' }}><Link href="/catalogo">← Catálogo</Link></p>
      <h1>Revisar unidades</h1>
      <p className="suave">
        Revisión del catálogo hecha con Claude el 31/10/2026: para cada insumo propone la unidad base (g, ml o und), el contenido de
        su presentación y la categoría, con la razón. <strong>Nada cambia hasta que lo aceptes.</strong> Acepta por grupos las que estén
        bien, corrige las que no y rechaza las que sobren. Conviene terminar antes del conteo inicial: después, la unidad de un
        producto con kardex ya no se puede cambiar.
      </p>
      <Propuestas filas={filas} categorias={categorias ?? []} soloLectura={perfil.rol === 'auditor'} />
    </>
  );
}
