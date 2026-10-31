import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, type Area } from '@/lib/roles';
import Pedido, { type LineaPedido } from './Pedido';

export const metadata = { title: 'Pedido sugerido' };

export default async function PaginaPedido({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const perfil = await perfilActual();
  const areas = areasDe(perfil);
  if (!areas.length || perfil.rol === 'servicio') redirect('/');
  const pedida = (await searchParams).area as Area | undefined;
  const area: Area = pedida && areas.includes(pedida) ? pedida : areas[0];
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('pedido_sugerido', { p_area: area });
  if (error) throw new Error(error.message);
  const lineas = (data ?? []) as LineaPedido[];
  const sinKardex = lineas.filter((l) => !l.tiene_kardex).length;

  return (
    <>
      <h1>Pedido sugerido</h1>
      {areas.length > 1 && (
        <nav className="segmentos" style={{ marginBottom: '1rem' }}>
          {areas.map((a) => (
            <Link key={a} href={`/pedido?area=${a}`}>
              <span style={a === area ? { background: 'var(--marca)', color: 'var(--marca-texto)', borderColor: 'var(--marca)' } : undefined}>
                {a === 'BAR' ? 'Bar' : 'Cocina'}
              </span>
            </Link>
          ))}
        </nav>
      )}
      <p className="suave">
        Lo que está en su mínimo o por debajo, con lo que hay que pedir para llegar al máximo (o al doble del mínimo si no tiene máximo),
        agrupado por el proveedor de la última compra. Ajusta las cantidades y copia el pedido para mandarlo.
      </p>
      {sinKardex > 0 && (
        <p className="aviso">
          {sinKardex} de estos productos todavía no tienen conteo inicial: salen con 0 en existencia. Después del
          {' '}<Link href="/conteo">conteo inicial</Link> el pedido usa lo que de verdad hay.
        </p>
      )}
      {lineas.length ? <Pedido lineas={lineas} /> : <p className="exito">Nada está en el mínimo. ✔</p>}
      <p className="suave" style={{ fontSize: '.85rem' }}>Los mínimos y máximos se cambian en la ficha de cada producto del catálogo.</p>
    </>
  );
}
