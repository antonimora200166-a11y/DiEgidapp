import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, type Area } from '@/lib/roles';
import ListaExistencias, { type FilaExistencia } from './ListaExistencias';

export const metadata = { title: 'Existencias' };

// ?zona=BAR_BARRA llega como filtro inicial (enlaces de otras pantallas); el resto se filtra en la lista.
export default async function Existencias({ searchParams }: { searchParams: Promise<{ zona?: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio') redirect('/');
  const { zona } = await searchParams;
  const areas: Area[] = areasDe(perfil).length ? areasDe(perfil) : ['BAR', 'COCINA'];
  const supabase = await supabaseServidor();
  const [{ data: zonas }, { data }] = await Promise.all([
    supabase.from('ubicaciones').select('codigo, nombre, area').in('area', areas).order('area').order('nombre'),
    supabase.from('v_existencias').select('*').in('area', areas).neq('cantidad', 0).order('generico').limit(5000),
  ]);
  const nombreZona = (u: string) => zonas?.find((z) => z.codigo === u)?.nombre ?? u;
  const filas = ((data ?? []) as Omit<FilaExistencia, 'zona'>[]).map((f) => ({ ...f, zona: nombreZona(f.ubicacion) }));

  return (
    <>
      <h1 className="pagina-ancha">Existencias</h1>
      {filas.length ? (
        <ListaExistencias filas={filas} zonaInicial={zona ? nombreZona(zona) : null} variasAreas={areas.length > 1} />
      ) : (
        <p className="tarjeta">
          No hay existencias todavía. El kardex nace con el <Link href="/conteo">conteo inicial</Link> de cada zona.
        </p>
      )}
    </>
  );
}
