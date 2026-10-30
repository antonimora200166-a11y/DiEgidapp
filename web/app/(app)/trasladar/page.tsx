import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, puedeOperar, type Area } from '@/lib/roles';
import type { ProductoSaldo } from '@/components/LineasInventario';
import Trasladar from './Trasladar';

export const metadata = { title: 'Trasladar' };

export default async function PaginaTrasladar() {
  const perfil = await perfilActual();
  const areas = areasDe(perfil).filter((a) => puedeOperar(perfil, a));
  if (!areas.length) redirect('/');

  const supabase = await supabaseServidor();
  const [{ data: zonas }, { data: recientes }, ...porArea] = await Promise.all([
    supabase.from('ubicaciones').select('codigo, nombre, area').in('area', areas).eq('activo', true).order('area').order('nombre'),
    supabase.from('traslados').select('id, codigo, fecha, origen, destino, forzado').order('registrado_en', { ascending: false }).limit(5),
    ...areas.map((a) => supabase.rpc('saldos_area', { p_area: a })),
  ]);
  const productos: Record<string, ProductoSaldo[]> = {};
  areas.forEach((a, i) => {
    if (porArea[i].error) throw new Error(porArea[i].error!.message);
    productos[a] = (porArea[i].data ?? []) as ProductoSaldo[];
  });
  const nombre = (u: string) => zonas?.find((z) => z.codigo === u)?.nombre ?? u;

  return (
    <>
      <h1>Trasladar</h1>
      <p className="suave">Mover mercancía entre zonas (bodega → barra, cocina → bar). No cambia el costo.</p>
      <Trasladar zonas={(zonas ?? []) as { codigo: string; nombre: string; area: Area }[]} productos={productos} />
      {!!recientes?.length && (
        <>
          <h2>Últimos traslados</h2>
          <ul className="lista">
            {recientes.map((t) => (
              <li key={t.id} className="linea">
                <span><span className="cod">{t.codigo}</span><br />{nombre(t.origen)} → {nombre(t.destino)}</span>
                <span className="suave" style={{ fontSize: '.85rem', textAlign: 'right' }}>
                  {new Date(t.fecha + 'T12:00:00').toLocaleDateString('es-CO')}
                  {t.forzado && <><br /><span className="etiqueta provisional">forzado</span></>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
