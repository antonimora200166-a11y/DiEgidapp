import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { cartaCompleta, mezclaDe, productoSim } from './datos';
import Simulador from './Simulador';
import Propuestas, { type Propuesta } from './Propuestas';
import ElegirProducto from './ElegirProducto';
import Exportar from '../Exportar';
import { fecha as fechaC } from '@/lib/formato';

export const metadata = { title: 'Simulador de carta' };


export default async function SimuladorPagina({ searchParams }: { searchParams: Promise<{ producto?: string; desde?: string; hasta?: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol !== 'admin') redirect('/');
  const sp = await searchParams;
  const supabase = await supabaseServidor();
  const [carta, { data: cargas }, { data: props, error: ep }] = await Promise.all([
    cartaCompleta(supabase),
    supabase.from('ventas_cargas').select('desde, hasta, por_dia').order('hasta', { ascending: false }).limit(1),
    supabase.rpc('propuestas_lista', { p_area: null }),
  ]);
  if (ep) throw new Error(ep.message);

  // referencia de ventas: los 30 días que terminan en la última carga de Odoo; si esa carga es un
  // acumulado sin días (el histórico en PDF), todo su rango, porque no se puede partir
  const valida = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  const ultima = cargas?.[0] as { desde: string; hasta: string; por_dia: boolean } | undefined;
  const fin = valida(sp.hasta) ?? ultima?.hasta ?? new Date().toISOString().slice(0, 10);
  const ini = new Date(fin + 'T12:00:00'); ini.setDate(ini.getDate() - 29);
  const desde = valida(sp.desde) ?? (ultima && !ultima.por_dia ? ultima.desde : ini.toISOString().slice(0, 10)), hasta = fin;

  const prod = carta.find((p) => p.generico_id === sp.producto);
  const mezcla = prod ? await mezclaDe(supabase, prod.generico_id, prod.area, desde, hasta) : null;
  const opciones = carta.map((p) => ({ id: p.generico_id, nombre: p.nombre, area: p.area, seccion: p.seccion, pct: p.pct_costo, semaforo: p.semaforo }));

  return (
    <>
      <p className="m-0 mb-1"><Link href="/consulta">← Consulta</Link></p>
      <h1 className="pagina-ancha titulo-gestion">Simulador de carta</h1>
      <p className="suave">Pruebe un precio nuevo o cantidades nuevas en la ficha y mire el % de costo, el margen y el efecto sobre el % teórico del área
        con las ventas del {fechaC(desde)} al {fechaC(hasta)}. Nada cambia en la carta hasta que apruebe una propuesta.</p>
      <form method="get" className="no-imprimir" style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {prod && <input type="hidden" name="producto" value={prod.generico_id} />}
        <label className="m-0">Ventas desde<input type="date" name="desde" defaultValue={desde} /></label>
        <label className="m-0">Hasta<input type="date" name="hasta" defaultValue={hasta} /></label>
        <button type="submit" className="secundario chico">Cambiar referencia</button>
      </form>
      <ElegirProducto opciones={opciones} actual={prod?.generico_id ?? ''} desde={desde} hasta={hasta} />
      {prod ? (
        <Simulador key={prod.generico_id} producto={{ generico_id: prod.generico_id, nombre: prod.nombre, area: prod.area, seccion: prod.seccion,
                                                      estado_ficha: prod.estado_ficha }}
                   base={productoSim(prod)} mezcla={mezcla} desde={desde} hasta={hasta} />
      ) : <p className="tarjeta">Escoja un producto de la carta para simular.</p>}
      <Exportar params={{}} bloques={[{ bloque: 'propuestas', t: 'Propuestas' }, { bloque: 'carta', t: 'Carta y margen' }]} />
      <Propuestas propuestas={(props ?? []) as Propuesta[]} />
    </>
  );
}
