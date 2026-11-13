import Link from 'next/link';
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
  // avance de las fichas de cócteles con la carta de coctelería
  const carta = areas.includes('BAR')
    ? (await supabase.rpc('validacion_recetario_resumen', { p_fuente: 'CARTA COCTELERÍA' })).data as { mpi: { total: number; aprobadas: number } } | null : null;
  // avance de las fichas de los platos de la carta de cocina
  const platos = areas.includes('COCINA')
    ? (await supabase.rpc('validacion_recetario_resumen', { p_fuente: 'CARTA COCINA' })).data as { mpi: { total: number; con_ficha: number; sin_receta: number } } | null : null;

  return (
    <>
      <h1 className="pagina-ancha">Fichas técnicas</h1>
      <p className="suave">La receta de cada MPI, cóctel y plato: con ella se producen los lotes y se calcula el costo estándar.
        Por defecto se ven las que les falta algo, incluidas las que no tienen ficha; quita el filtro de estado para verlas todas.
        Con «Forma de venta» separas los cócteles de las botellas, shots, copas y reventa.</p>
      {carta && carta.mpi.aprobadas < carta.mpi.total && (
        <Link href="/produccion/validar?fuente=cocteles" className="tarjeta pagina-ancha" style={{ display: 'flex', gap: '.75rem', justifyContent: 'space-between', alignItems: 'center', textDecoration: 'none', marginBottom: '1rem', borderColor: 'var(--tinta)' }}>
          <span><strong>Completar las fichas de cócteles con la carta</strong><br />
            <span className="suave">{carta.mpi.aprobadas} de {carta.mpi.total} bebidas con procedimiento, presentación y alérgenos de la carta.</span></span>
          <span className="boton">Continuar</span>
        </Link>
      )}
      {platos && platos.mpi.total > 0 && platos.mpi.con_ficha < platos.mpi.total && (
        <Link href="/produccion/validar?fuente=platos" className="tarjeta pagina-ancha" style={{ display: 'flex', gap: '.75rem', justifyContent: 'space-between', alignItems: 'center', textDecoration: 'none', marginBottom: '1rem', borderColor: 'var(--tinta)' }}>
          <span><strong>Fichas de los platos de la carta</strong><br />
            <span className="suave">{platos.mpi.con_ficha} de {platos.mpi.total} platos con ficha · {platos.mpi.sin_receta} sin receta en el recetario.</span></span>
          <span className="boton">Continuar</span>
        </Link>
      )}
      <ListaFichas filas={filas} variasAreas={areas.length > 1} />
    </>
  );
}
