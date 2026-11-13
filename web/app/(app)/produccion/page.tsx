import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, editaFicha, type Area } from '@/lib/roles';
import PestanasProduccion from '@/components/PestanasProduccion';
import ListaFichasProduccion, { type FilaProd } from './ListaFichasProduccion';

export const metadata = { title: 'Producción · Fichas técnicas' };

export default async function Produccion({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio') redirect('/');
  const areas: Area[] = areasDe(perfil).length ? areasDe(perfil) : ['BAR', 'COCINA'];
  const pedida = (await searchParams).area as Area | undefined;
  const area: Area = pedida && areas.includes(pedida) ? pedida : areas[0];

  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('produccion_fichas', { p_area: area });
  if (error) throw new Error(error.message);
  const filas = (data ?? []) as FilaProd[];
  // avance de la validación con el recetario (solo cocina)
  const avance = area === 'COCINA' ? (await supabase.rpc('validacion_recetario_resumen')).data as { mpi: { total: number; con_ficha: number } } | null : null;

  return (
    <>
      <PestanasProduccion activa="fichas" area={area} />
      <div className="pagina-ancha" style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.6rem' }}>
        <h1 className="m-0">Fichas técnicas · {area === 'BAR' ? 'Bar' : 'Cocina'}</h1>
        {areas.length > 1 && (
          <nav className="segmentos" aria-label="Área">
            {areas.map((a) => (
              <Link key={a} href={`/produccion?area=${a}`} aria-current={a === area ? 'true' : undefined}>
                <span>
                  {a === 'BAR' ? 'Bar' : 'Cocina'}
                </span>
              </Link>
            ))}
          </nav>
        )}
      </div>
      <p className="suave mt-0">
        La receta de cada MPI: con ella se produce y se calcula el costo estándar. Toque una para ver sus pasos, puntos críticos y vida útil.
        {editaFicha(perfil, area) ? ' Cada cambio que guarde crea una versión nueva.' : ' Las crea y cambia el ' + (area === 'BAR' ? 'jefe de barra' : 'chef') + '.'}
      </p>
      {avance && avance.mpi.con_ficha < avance.mpi.total && (
        <Link href="/produccion/validar" className="tarjeta pagina-ancha tarjeta-enlace">
          <span><strong>Validar MPI con el recetario de cocina</strong><br />
            <span className="suave">{avance.mpi.con_ficha} de {avance.mpi.total} MPI con ficha. Empareje ingredientes, elija recetas y apruébelas.</span></span>
          <span className="boton">Continuar</span>
        </Link>
      )}
      <ListaFichasProduccion filas={filas} vePesos={perfil.rol === 'admin'} />
    </>
  );
}
