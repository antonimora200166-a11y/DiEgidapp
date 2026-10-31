import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, type Area } from '@/lib/roles';
import ListaHistorial, { type FilaHistorial } from './ListaHistorial';

export const metadata = { title: 'Historial' };

// Los 300 documentos más recientes de cada área; se filtran y agrupan en la lista.
export default async function Historial() {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio') redirect('/');
  const areas: Area[] = areasDe(perfil).length ? areasDe(perfil) : ['BAR', 'COCINA'];   // auditoría ve las dos
  const supabase = await supabaseServidor();
  const resultados = await Promise.all(areas.map((a) => supabase.rpc('historial_documentos', { p_area: a, p_tipo: null, p_limite: 300 })));
  const vistos = new Set<string>();
  const filas: FilaHistorial[] = resultados.flatMap((r, i) => {
    if (r.error) throw new Error(r.error.message);
    return ((r.data ?? []) as Omit<FilaHistorial, 'area'>[]).map((f) => ({ ...f, area: areas[i] }));
  }).filter((f) => (vistos.has(f.tipo + f.id) ? false : vistos.add(f.tipo + f.id)))   // un traslado de cocina a bar sale en las dos
    .sort((a, b) => b.registrado_en.localeCompare(a.registrado_en));

  return (
    <>
      <h1 className="pagina-ancha">Historial</h1>
      <p className="suave">Lo registrado, del más reciente al más antiguo. Un error se corrige anulando el documento: nada se borra.</p>
      {filas.length ? <ListaHistorial filas={filas} variasAreas={areas.length > 1} />
        : <p className="tarjeta">Todavía no hay documentos.</p>}
    </>
  );
}
