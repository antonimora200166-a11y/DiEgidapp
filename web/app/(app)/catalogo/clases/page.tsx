import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, editaArea } from '@/lib/roles';
import PropuestasClase, { type PropuestaClase } from './PropuestasClase';
import PestanasCalidad from '@/components/PestanasCalidad';

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
      <PestanasCalidad activa="clases" esAdmin={perfil.rol === 'admin'} />
      <h1 className="pagina-ancha titulo-gestion">Clasificar insumos</h1>
      <p className="suave pagina-ancha">
        Lo que se compra y no es alimento se separa en <strong>desechables</strong> (pueden ir en una ficha), <strong>aseo y limpieza</strong>
        {' '}(gasto del área), <strong>menaje</strong> y <strong>herramientas o equipos</strong> (no se gastan: se cuentan y salen por baja).
        Esta es una propuesta por el nombre y la categoría de cada uno. <strong>Nada cambia hasta que la acepte.</strong> Acepte por grupos,
        corrija la clase de los que estén mal y rechace lo que sí es materia prima.
      </p>
      <PropuestasClase filas={(data ?? []) as PropuestaClase[]} soloLectura={perfil.rol === 'auditor'} />
    </>
  );
}
