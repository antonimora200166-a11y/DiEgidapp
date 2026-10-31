import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, type Area } from '@/lib/roles';
import ListaFichas, { type FilaFicha } from './ListaFichas';

export const metadata = { title: 'Fichas técnicas' };

export default async function Fichas() {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio') redirect('/');
  const areas: Area[] = areasDe(perfil).length ? areasDe(perfil) : ['BAR', 'COCINA'];
  const supabase = await supabaseServidor();
  const resultados = await Promise.all(areas.map((a) => supabase.rpc('lista_fichas', { p_area: a })));
  const filas: FilaFicha[] = resultados.flatMap((r, i) => {
    if (r.error) throw new Error(r.error.message);
    return ((r.data ?? []) as Omit<FilaFicha, 'area'>[]).map((f) => ({ ...f, area: areas[i] }));
  });

  return (
    <>
      <h1 className="pagina-ancha">Fichas técnicas</h1>
      <p className="suave">La receta de cada MPI, cóctel y plato: con ella se producen los lotes y se calcula el costo estándar.
        Por defecto se ven las que les falta algo; quita el filtro de estado para verlas todas.</p>
      <ListaFichas filas={filas} variasAreas={areas.length > 1} />
    </>
  );
}
