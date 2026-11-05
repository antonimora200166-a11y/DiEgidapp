import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import PestanasProduccion from '@/components/PestanasProduccion';

export const metadata = { title: 'Producción · Lotes' };

// Sección 3 del rediseño (trazabilidad): se construye después de Fichas y Producir.
export default async function Lotes({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio') redirect('/');
  const { area } = await searchParams;
  return (
    <>
      <PestanasProduccion activa="lotes" area={area} />
      <h1>Lotes y trazabilidad</h1>
      <div className="vacio">Esta sección está en construcción. Por ahora los lotes registrados están en <Link href="/historial">Historial</Link>.</div>
    </>
  );
}
