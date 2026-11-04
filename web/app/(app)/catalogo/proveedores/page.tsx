import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { editaArea, type Area } from '@/lib/roles';
import ComprasProveedor, { type CompraProveedor } from './ComprasProveedor';

export const metadata = { title: 'Compras por proveedor' };

export default async function Proveedores() {
  const perfil = await perfilActual();
  const puede = perfil.rol === 'admin' || perfil.rol === 'auditor' || (['BAR', 'COCINA'] as Area[]).some((a) => editaArea(perfil, a));
  if (!puede) redirect('/catalogo');
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('compras_por_proveedor');
  if (error) throw new Error(error.message);

  return (
    <>
      <p className="pagina-ancha" style={{ margin: '0 0 .3rem' }}><Link href="/catalogo">← Catálogo</Link></p>
      <h1 className="pagina-ancha">Lo que le compramos a cada proveedor</h1>
      <p className="suave pagina-ancha">
        Se arma solo con cada recepción, cada foto de <Link href="/catalogo/precios">Precios desde fotos</Link> y las compras de los
        libros anteriores. Muestra cómo llama cada proveedor al producto en su factura, el último precio y cuántas veces se le ha comprado.
      </p>
      <ComprasProveedor filas={(data ?? []) as CompraProveedor[]} />
    </>
  );
}
