import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, puedeOperar, type Area } from '@/lib/roles';
import type { ProductoSaldo } from '@/components/LineasInventario';
import Bajas from './Bajas';
import PestanasPerdida from '@/components/PestanasPerdida';
import { fecha as fmtFecha } from '@/lib/formato';

export const metadata = { title: 'Reportar pérdida' };
const CAUSAS: Record<string, string> = { VENCIDO: 'Vencido', DANADO: 'Dañado / roto', DERRAME: 'Derrame', MAL_ESTADO: 'Mal estado', OTRO: 'Otro', CORTESIA: 'Cortesía', MAL_HECHO: 'Mal hecho' };

export default async function PaginaBajas({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const perfil = await perfilActual();
  const areas = areasDe(perfil).filter((a) => puedeOperar(perfil, a));
  if (!areas.length) redirect('/');
  const pedida = (await searchParams).area as Area | undefined;
  const area: Area = pedida && areas.includes(pedida) ? pedida : areas[0];

  const supabase = await supabaseServidor();
  const [{ data: productos, error }, { data: zonas }, { data: recientes }] = await Promise.all([
    supabase.rpc('saldos_area', { p_area: area }),
    supabase.from('ubicaciones').select('codigo, nombre').eq('area', area).eq('activo', true).order('nombre'),
    supabase.from('bajas').select('id, codigo, fecha, causa, forzada, ubicacion').eq('area', area)
      .order('registrado_en', { ascending: false }).limit(5),
  ]);
  if (error) throw new Error(error.message);

  return (
    <>
      <h1>Reportar pérdida</h1>
      <PestanasPerdida activa="insumos" area={area} />
      <p className="suave" style={{ marginTop: 0 }}>Lo que se bota o ya no sirve: sale del kardex al costo promedio.</p>
      {areas.length > 1 && (
        <nav className="segmentos" style={{ marginBottom: '1rem' }}>
          {areas.map((a) => (
            <Link key={a} href={`/bajas?area=${a}`} aria-current={a === area ? 'true' : undefined}>
              <span>
                {a === 'BAR' ? 'Bar' : 'Cocina'}
              </span>
            </Link>
          ))}
        </nav>
      )}
      <Bajas key={area} area={area} productos={(productos ?? []) as ProductoSaldo[]} zonas={zonas ?? []} />
      {!!recientes?.length && (
        <>
          <h2>Últimas pérdidas</h2>
          <ul className="lista">
            {recientes.map((b) => (
              <li key={b.id} className="linea">
                <span><span className="cod">{b.codigo}</span><br />{CAUSAS[b.causa] ?? b.causa} · {zonas?.find((z) => z.codigo === b.ubicacion)?.nombre ?? b.ubicacion}</span>
                <span className="suave" style={{ fontSize: '.85rem', textAlign: 'right' }}>
                  {fmtFecha(b.fecha)}
                  {b.forzada && <><br /><span className="etiqueta provisional">forzada</span></>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
