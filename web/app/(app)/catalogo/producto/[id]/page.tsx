import { notFound, redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { editaArea, type Area } from '@/lib/roles';
import EditarProducto, { type Ficha } from './EditarProducto';
import EliminarProductos from '@/components/EliminarProductos';
import StockMinMax from './StockMinMax';
import PrecioProducto from './PrecioProducto';
import VerificarContenido from './VerificarContenido';
import { ENVASES } from '@/lib/catalogo';
import { fecha as fmtFecha } from '@/lib/formato';

export const metadata = { title: 'Producto' };

export default async function Producto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const perfil = await perfilActual();
  const supabase = await supabaseServidor();
  const { data } = await supabase.from('productos')
    .select(`id, codigo, estado, activo, marca, presentacion, unidad_compra, contenido_base, contenido_variable, contenido_verificado_en, nota, clase_abc, stock_minimo, stock_maximo,
             generico:genericos!inner(id, codigo, nombre, tipo, clase, categoria, unidad_base, conservacion, temp_max_llegada, estado, area)`)
    .eq('id', id).maybeSingle();
  if (!data) notFound();
  const fila = data as unknown as Ficha & { contenido_verificado_en: string | null; nota: string | null; clase_abc: string | null; stock_minimo: number | null; stock_maximo: number | null; generico: Ficha['generico'] & { id: string; area: Area } };
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
  const [{ data: ref }, { data: kardex }, { count: movsPropios }] = await Promise.all([
    supabase.from('costos_referencia').select('costo_unitario_base, fuente, calculado_en').eq('producto_id', fila.id).maybeSingle(),
    supabase.from('costos_producto').select('costo_promedio, actualizado_en').eq('producto_id', fila.id).maybeSingle(),
    supabase.from('movimientos').select('id', { count: 'exact', head: true }).eq('producto_id', fila.id),
  ]);
  const fechaCorta = (d: string) => fmtFecha(d.slice(0, 10));
  const actual = kardex?.costo_promedio != null
    ? { cu: Number(kardex.costo_promedio), fuente: '', fecha: fechaCorta(kardex.actualizado_en as string), deKardex: true }
    : ref ? { cu: Number(ref.costo_unitario_base), fuente: ref.fuente as string, fecha: ref.calculado_en ? fechaCorta(ref.calculado_en as string) : null, deKardex: false } : null;
  // las fichas guardan su propia unidad y se convierten al calcular: solo el kardex bloquea el cambio
  const ubBloqueada = (movs ?? 0) > 0 ? 'no se cambia: ya tiene movimientos en el kardex' : null;
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
      {fila.nota && <p className="suave texto-nota">{fila.nota}</p>}
      <EditarProducto ficha={fila} categorias={categorias ?? []} ubBloqueada={ubBloqueada} />
      {fila.contenido_base != null && !fila.contenido_variable && (
        <VerificarContenido id={fila.id}
          texto={`${Number(fila.contenido_base).toLocaleString('es-CO')} ${fila.generico.unidad_base} por ${(ENVASES.find((e) => e.unidad === fila.unidad_compra)?.etiqueta ?? 'unidad').toLowerCase()}`}
          verificado={fila.contenido_verificado_en ? fmtFecha(fila.contenido_verificado_en) : null} />
      )}
      {fila.generico.tipo === 'SIN_COSTO' && (
        <p className="suave texto-nota">Sin costo: no lleva precio y suma $0 en las fichas{(enFicha ?? 0) > 0 ? ` (está en ${enFicha} línea${enFicha === 1 ? '' : 's'} de ficha)` : ''}.</p>
      )}
      {fila.generico.tipo === 'MPe' && perfil.rol === 'admin' && (
        <>
          <h2>Precio</h2>
          <PrecioProducto id={fila.id} unidadBase={fila.generico.unidad_base} unidadCompra={fila.unidad_compra || 'und'}
            contenido={fila.contenido_base == null ? null : Number(fila.contenido_base)} variable={!!fila.contenido_variable}
            hermanos={nPres - 1} actual={actual} conKardex={(movsPropios ?? 0) > 0} />
        </>
      )}
      <h2>Pedido</h2>
      <p className="suave mt-0 texto-nota">Cuando lo que hay llega al mínimo, sale en el <a href="/pedido">pedido sugerido</a> con lo que falta para el máximo.</p>
      <StockMinMax id={fila.id} minimo={fila.stock_minimo === null ? null : Number(fila.stock_minimo)} maximo={fila.stock_maximo === null ? null : Number(fila.stock_maximo)} unidad={fila.unidad_compra || 'und'} />
      {perfil.rol === 'admin' && (
        <>
          <h2>Administración</h2>
          <p className="suave mt-0 texto-nota">
            Eliminar lo saca de todas las listas y pantallas; queda en la bitácora con el motivo y se puede reactivar.
            No se puede si tiene saldo en el kardex o si su genérico está en una ficha vigente.
          </p>
          <div className="acciones"><EliminarProductos productos={[{ id: fila.id, activo: fila.activo }]} etiqueta="Eliminar producto" /></div>
        </>
      )}
      {(alias?.length ?? 0) > 0 && (
        <>
          <h2>Nombres con que aparece</h2>
          <p className="suave mt-0 texto-nota">En facturas, inventarios y fichas. La búsqueda los reconoce.</p>
          <ul className="lista">
            {alias!.map((a) => <li key={a.fuente + a.alias}>{a.alias} <span className="cod">· {a.fuente.toLowerCase()}</span></li>)}
          </ul>
        </>
      )}
    </>
  );
}
