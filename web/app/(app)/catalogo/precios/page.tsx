import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { editaArea, type Area } from '@/lib/roles';
import PreciosFoto, { type ProductoPrecio } from './PreciosFoto';

export const metadata = { title: 'Precios desde fotos' };

export default async function Precios() {
  const perfil = await perfilActual();
  const areas = (['BAR', 'COCINA'] as Area[]).filter((a) => editaArea(perfil, a));
  if (!areas.length) redirect('/catalogo');
  const supabase = await supabaseServidor();
  const catalogos = await Promise.all(areas.map((a) => supabase.rpc('productos_recepcion', { p_area: a })));
  const productos: ProductoPrecio[] = [];
  catalogos.forEach((c, i) => {
    if (c.error) throw new Error(c.error.message);
    for (const p of (c.data ?? []) as Omit<ProductoPrecio, 'area' | 'costo_ref'>[]) productos.push({ ...p, area: areas[i], costo_ref: null });
  });
  // costo de referencia actual, para comparar con el precio de la foto
  const porId = new Map(productos.map((p) => [p.producto_id, p]));
  const ids = [...porId.keys()];
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from('costos_referencia').select('producto_id, costo_unitario_base').in('producto_id', ids.slice(i, i + 300));
    for (const c of data ?? []) {
      const p = porId.get(c.producto_id as string);
      if (p) p.costo_ref = Number(c.costo_unitario_base);
    }
  }

  return (
    <>
      <p className="pagina-ancha" style={{ margin: '0 0 .3rem' }}><Link href="/catalogo">← Catálogo</Link></p>
      <h1 className="pagina-ancha">Precios desde fotos</h1>
      <p className="suave pagina-ancha">
        Sube la foto de una factura, tiquete, lista de precios o cotización. La IA saca el nombre, la cantidad y el precio de cada
        producto; tú corriges lo que haga falta y guardas. <strong>No es una recepción:</strong> no entra nada al inventario ni al
        kardex. El precio queda como referencia de compra y, si lo marcas, como costo del producto.
      </p>
      <PreciosFoto areas={areas} productos={productos} />
    </>
  );
}
