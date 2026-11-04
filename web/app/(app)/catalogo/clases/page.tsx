import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, editaArea } from '@/lib/roles';
import PropuestasClase, { type PropuestaClase } from './PropuestasClase';

export const metadata = { title: 'Clasificar insumos' };

export default async function Clases() {
  const perfil = await perfilActual();
  const areas = areasDe(perfil).filter((a) => editaArea(perfil, a));
  if (!areas.length && perfil.rol !== 'auditor') redirect('/catalogo');
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('lista_propuestas_clase');
  if (error) throw new Error(error.message);

  return (
    <>
      <p className="pagina-ancha" style={{ margin: '0 0 .3rem' }}><Link href="/catalogo">← Catálogo</Link></p>
      <h1 className="pagina-ancha">Clasificar insumos</h1>
      <p className="suave pagina-ancha">
        Lo que se compra y no es alimento se separa en <strong>desechables</strong> (pueden ir en una ficha), <strong>aseo y limpieza</strong>
        {' '}(gasto del área), <strong>menaje</strong> y <strong>herramientas o equipos</strong> (no se gastan: se cuentan y salen por baja).
        Esta es una propuesta por el nombre y la categoría de cada uno. <strong>Nada cambia hasta que la aceptes.</strong> Acepta por grupos,
        corrige la clase de los que estén mal y rechaza lo que sí es materia prima.
      </p>
      <PropuestasClase filas={(data ?? []) as PropuestaClase[]} soloLectura={perfil.rol === 'auditor'} />
    </>
  );
}
