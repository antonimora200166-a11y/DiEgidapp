import { notFound, redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { editaArea, type Area } from '@/lib/roles';
import EditarProducto, { type Ficha } from './EditarProducto';
import EliminarProductos from '@/components/EliminarProductos';

export const metadata = { title: 'Producto' };

export default async function Producto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const perfil = await perfilActual();
  const supabase = await supabaseServidor();
  const { data } = await supabase.from('productos')
    .select(`id, codigo, estado, activo, marca, presentacion, unidad_compra, contenido_base, contenido_variable, nota, clase_abc,
             generico:genericos!inner(id, codigo, nombre, tipo, categoria, unidad_base, conservacion, temp_max_llegada, estado, area)`)
    .eq('id', id).maybeSingle();
  if (!data) notFound();
  const fila = data as unknown as Ficha & { nota: string | null; clase_abc: string | null; generico: Ficha['generico'] & { id: string; area: Area } };
  if (!editaArea(perfil, fila.generico.area)) redirect('/catalogo');

  // presentaciones del genérico: la unidad base solo cambia si ninguna tiene movimientos (igual que la RPC)
  const { data: presentaciones } = await supabase.from('productos').select('id').eq('generico_id', fila.generico.id);
  const idsPres = (presentaciones ?? []).map((p) => p.id);
  const [{ data: categorias }, { count: movs }, { count: enFicha }, { data: alias }] = await Promise.all([
    supabase.from('categorias').select('codigo, nombre').eq('area', fila.generico.area).eq('activo', true).order('nombre'),
    supabase.from('movimientos').select('id', { count: 'exact', head: true }).in('producto_id', idsPres),
    supabase.from('ficha_lineas').select('id', { count: 'exact', head: true }).eq('generico_id', fila.generico.id),
    supabase.from('alias').select('fuente, alias').eq('generico_id', fila.generico.id).order('fuente').limit(20),
  ]);
  const ubBloqueada = (movs ?? 0) > 0 ? 'ya tiene movimientos en el kardex' : (enFicha ?? 0) > 0 ? 'está en una ficha técnica' : null;
  const nPres = idsPres.length || 1;

  return (
    <>
      <h1>{fila.generico.nombre}{fila.marca && ` · ${fila.marca}`}</h1>
      <p className="suave">
        <span className={`etiqueta ${fila.activo ? fila.estado.toLowerCase() : 'inactivo'}`}>{fila.activo ? fila.estado : 'INACTIVO'}</span>
        {' '}{fila.generico.area === 'BAR' ? 'Bar' : 'Cocina'}
        {fila.clase_abc && <> · clase {fila.clase_abc}</>}
        {nPres > 1 && <> · el genérico tiene {nPres} presentaciones</>}
      </p>
      {fila.nota && <p className="suave" style={{ fontSize: '.88rem' }}>{fila.nota}</p>}
      <EditarProducto ficha={fila} categorias={categorias ?? []} ubBloqueada={ubBloqueada} />
      {perfil.rol === 'admin' && (
        <>
          <h2>Administración</h2>
          <p className="suave" style={{ marginTop: 0, fontSize: '.88rem' }}>
            Eliminar lo saca de todas las listas y pantallas; queda en la bitácora con el motivo y se puede reactivar.
            No se puede si tiene saldo en el kardex o si su genérico está en una ficha vigente.
          </p>
          <div className="acciones"><EliminarProductos productos={[{ id: fila.id, activo: fila.activo }]} etiqueta="Eliminar producto" /></div>
        </>
      )}
      {(alias?.length ?? 0) > 0 && (
        <>
          <h2>Nombres con que aparece</h2>
          <p className="suave" style={{ marginTop: 0, fontSize: '.88rem' }}>En facturas, inventarios y fichas. La búsqueda los reconoce.</p>
          <ul className="lista">
            {alias!.map((a) => <li key={a.fuente + a.alias}>{a.alias} <span className="cod">· {a.fuente.toLowerCase()}</span></li>)}
          </ul>
        </>
      )}
    </>
  );
}
