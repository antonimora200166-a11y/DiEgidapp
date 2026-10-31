import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, type Area } from '@/lib/roles';
import ListaSinCosto, { type LoteSinCosto } from './ListaSinCosto';

export const metadata = { title: 'Lotes sin costo completo' };

export default async function SinCosto() {
  const perfil = await perfilActual();
  const areas = areasDe(perfil);
  if (!areas.length || perfil.rol === 'servicio') redirect('/');
  const supabase = await supabaseServidor();
  const respuestas = await Promise.all(areas.map((a: Area) => supabase.rpc('lotes_sin_costo', { p_area: a })));
  const error = respuestas.find((r) => r.error)?.error;
  if (error) throw new Error(error.message);
  const filas = respuestas.flatMap((r) => (r.data ?? []) as LoteSinCosto[]);
  const historicos = filas.filter((f) => f.origen === 'HISTÓRICO').length;

  return (
    <>
      <p className="pagina-ancha" style={{ margin: '0 0 .3rem' }}><Link href="/producir">← Producir</Link></p>
      <h1>Lotes sin costo completo</h1>
      <p className="suave">
        Lotes a los que les falta el costo de algún insumo: su costo por gramo no es confiable. {filas.length - historicos} de la app
        y {historicos} del histórico de los Sheets. Filtra por «Insumo que falta» para ver qué compra o conversión destraba más lotes.
      </p>
      <ListaSinCosto filas={filas} />
    </>
  );
}
