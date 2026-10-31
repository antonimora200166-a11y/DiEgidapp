'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { eliminarProductos, reactivarProductos, type ResultadoEliminar } from '@/lib/productos';
import { confirmar, pedirTexto } from '@/components/Dialogo';

// Botones de administración para dar de baja (o reactivar) los productos elegidos. Se muestran
// solo a administración; la base vuelve a revisar el permiso.
export default function EliminarProductos({ productos, alTerminar, etiqueta }: {
  productos: { id: string; activo?: boolean }[]; alTerminar?: () => void; etiqueta?: string;
}) {
  const router = useRouter();
  const [resultado, setResultado] = useState<ResultadoEliminar | { error: string } | null>(null);
  const [enviando, iniciar] = useTransition();
  const activos = productos.filter((p) => p.activo !== false);
  const inactivos = productos.filter((p) => p.activo === false);

  async function eliminar() {
    const motivo = await pedirTexto(`Salen de todas las listas y quedan en la bitácora; se pueden reactivar. ¿Por qué se eliminan?`,
      { titulo: `Eliminar ${activos.length} producto(s)`, aceptar: 'Eliminar', peligro: true, min: 5, placeholder: 'Ej.: duplicado, ya no se compra' });
    if (motivo === null) return;
    iniciar(async () => {
      const r = await eliminarProductos(activos.map((p) => p.id), motivo.trim());
      setResultado(r);
      if (!('error' in r)) { alTerminar?.(); router.refresh(); }
    });
  }
  async function reactivar() {
    if (!(await confirmar(`Vuelven a las listas y pantallas de trabajo.`, { titulo: `¿Reactivar ${inactivos.length} producto(s)?`, aceptar: 'Reactivar' }))) return;
    iniciar(async () => {
      const r = await reactivarProductos(inactivos.map((p) => p.id));
      setResultado(r);
      if (!('error' in r)) { alTerminar?.(); router.refresh(); }
    });
  }

  return (
    <>
      {activos.length > 0 && (
        <button type="button" className="secundario peligro" disabled={enviando} onClick={eliminar}>
          {enviando ? 'Eliminando…' : etiqueta ?? `Eliminar (${activos.length})`}
        </button>
      )}
      {inactivos.length > 0 && (
        <button type="button" className="secundario" disabled={enviando} onClick={reactivar}>Reactivar ({inactivos.length})</button>
      )}
      {resultado && (
        <div className={'error' in resultado || resultado.fallidos ? 'aviso' : 'exito'} role="status" style={{ flexBasis: '100%', margin: '.4rem 0 0' }}>
          {'error' in resultado ? resultado.error : (
            <>
              {resultado.ok} producto(s) listo(s){resultado.fallidos ? `; ${resultado.fallidos} no:` : '.'}
              {resultado.fallidos > 0 && <ul>{resultado.detalle.filter((d) => !d.ok).map((d) => <li key={d.id}><span className="cod">{d.codigo}</span>: {d.mensaje}</li>)}</ul>}
            </>
          )}
        </div>
      )}
    </>
  );
}
