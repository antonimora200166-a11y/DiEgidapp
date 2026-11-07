import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { editaArea, type Area } from '@/lib/roles';
import Hoja, { type Fila } from './Hoja';

export const metadata = { title: 'Verificar A/B' };

export default async function Verificar() {
  const perfil = await perfilActual();
  const admin = perfil.rol === 'admin' || perfil.rol === 'auditor';
  const areas = (['BAR', 'COCINA'] as Area[]).filter((a) => admin || editaArea(perfil, a));
  if (!areas.length) redirect('/catalogo');
  const supabase = await supabaseServidor();
  const resultados = await Promise.all(areas.map((a) => supabase.rpc('lista_verificacion', { p_area: a })));
  const filas: Fila[] = [];
  resultados.forEach((r, i) => {
    if (r.error) throw new Error(r.error.message);
    for (const f of (r.data ?? []) as Omit<Fila, 'area'>[]) filas.push({ ...f, area: areas[i] });
  });

  return (
    <>
      <p className="pagina-ancha" style={{ margin: '0 0 .3rem' }}><Link href="/catalogo">← Catálogo</Link></p>
      <h1 className="pagina-ancha">Verificar insumos A/B</h1>
      <p className="suave pagina-ancha">
        Con el empaque en la mano, de arriba abajo: los primeros son los que más pesan en la compra. Mira que la <strong>unidad</strong>,
        el <strong>contenido</strong> y el <strong>precio de una unidad de compra</strong> sean los reales. Si está bien, <em>Verificado</em>;
        si no, <em>Corregir</em>. Si un parecido es el mismo insumo, mándalo a <Link href="/catalogo/revision">Revisar duplicados</Link> para unirlos.
      </p>
      <Hoja filas={filas} soloLectura={perfil.rol === 'auditor'} vePesos={perfil.rol === 'admin'} />
    </>
  );
}
