import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, puedeOperar, type Area } from '@/lib/roles';
import RegistrarCarta from './RegistrarCarta';
import ListaBajasCarta, { type FilaBajaCarta } from './ListaBajasCarta';
import PestanasPerdida from '@/components/PestanasPerdida';

export const metadata = { title: 'Cortesías y mal hechos' };

export default async function PaginaBajasCarta({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const perfil = await perfilActual();
  const esAdmin = perfil.rol === 'admin';
  const areas = areasDe(perfil).filter((a) => puedeOperar(perfil, a));
  if (!areas.length && !esAdmin) redirect('/');
  const lista: Area[] = areas.length ? areas : ['BAR', 'COCINA'];
  const pedida = (await searchParams).area as Area | undefined;
  const area: Area = pedida && lista.includes(pedida) ? pedida : lista[0];

  const supabase = await supabaseServidor();
  const [{ data: carta }, { data: zonas }, { data: personas }, { data: filas, error }, { data: exigePin }] = await Promise.all([
    supabase.from('genericos').select('id, nombre, tipo, seccion_carta').eq('area', area).in('tipo', ['BEBIDA', 'PLATO'])
      .eq('activo', true).eq('en_baul', false).order('nombre'),
    supabase.from('ubicaciones').select('codigo, nombre').eq('area', area).eq('activo', true).order('nombre'),
    supabase.rpc('personas_bajas_carta'),
    supabase.rpc('bajas_carta_lista', { p_area: esAdmin ? null : area }),
    supabase.rpc('exige_pin'),
  ]);
  if (error) throw new Error(error.message);
  const puede = areas.includes(area);

  return (
    <>
      <h1>Reportar pérdida</h1>
      <PestanasPerdida activa="carta" area={area} />
      <p className="suave" style={{ marginTop: 0 }}>Se registran como producto de la carta («2 Gin Sour»): la app descarga del kardex los ingredientes de su ficha y guarda quién
        lo autorizó y quién responde por el costo.</p>
      <p className="aviso" style={{ fontSize: '.9rem' }}>Las cortesías se registran solo aquí: no las marques a $0 en Odoo, porque contarían dos veces.</p>
      {lista.length > 1 && (
        <nav className="segmentos" style={{ marginBottom: '1rem' }}>
          {lista.map((a) => (
            <Link key={a} href={`/bajas/carta?area=${a}`}>
              <span style={a === area ? { background: 'var(--marca)', color: 'var(--marca-texto)', borderColor: 'var(--tinta)' } : undefined}>{a === 'BAR' ? 'Bar' : 'Cocina'}</span>
            </Link>))}
        </nav>)}
      {puede ? (
        <RegistrarCarta key={area} area={area} carta={(carta ?? []).map((g) => ({ id: g.id, nombre: g.nombre }))} zonas={zonas ?? []}
                        personas={(personas ?? []) as { id: string; nombre: string; rol: string; autoriza: boolean }[]} yo={perfil.id} exigePin={exigePin === true} />
      ) : <p className="suave">No registra en esta área; aquí ve lo registrado.</p>}
      <ListaBajasCarta filas={(filas ?? []) as FilaBajaCarta[]} esAdmin={esAdmin} />
    </>
  );
}
