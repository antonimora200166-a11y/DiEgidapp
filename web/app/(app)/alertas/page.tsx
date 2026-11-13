import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import ListaAlertas, { type Alerta, type Responsable } from './ListaAlertas';

export const metadata = { title: 'Alertas' };

// Bandeja de alertas y seguimiento. Administración ve todas con su impacto en pesos; el jefe de
// barra, el chef y los demás ven las que tienen asignadas, sin pesos.
export default async function AlertasPagina() {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio') redirect('/');
  const admin = perfil.rol === 'admin';
  const supabase = await supabaseServidor();
  const [{ data, error }, { data: responsables }, { data: cargas }] = await Promise.all([
    supabase.rpc('alertas_lista', { p_todas: true }),
    admin ? supabase.rpc('responsables_alertas') : Promise.resolve({ data: [] }),
    admin ? supabase.from('ventas_cargas').select('desde, hasta') : Promise.resolve({ data: [] }),
  ]);
  if (error) throw new Error(error.message);
  const c = (cargas ?? []) as { desde: string; hasta: string }[];
  const revisar = c.length ? { desde: c.map((x) => x.desde).sort()[0], hasta: c.map((x) => x.hasta).sort().at(-1)! } : null;

  return (
    <>
      <h1 className="pagina-ancha titulo-gestion">Alertas</h1>
      <p className="suave">
        {admin
          ? 'Lo que las reglas encontraron en las ventas, el kardex, las compras y la producción, con su impacto estimado. Asígnelas con una fecha, comente y márquelas resueltas con la causa encontrada. Las que no se resuelven siguen abiertas en el siguiente período.'
          : 'Las alertas que administración le asignó. Comente lo que encuentre, márquelas en curso y resuélvalas escribiendo la causa.'}
      </p>
      <ListaAlertas alertas={(data ?? []) as Alerta[]} admin={admin} responsables={(responsables ?? []) as Responsable[]} revisar={revisar} />
    </>
  );
}
