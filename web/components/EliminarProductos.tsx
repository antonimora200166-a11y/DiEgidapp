'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { eliminarProductos, reactivarProductos, type ResultadoEliminar } from '@/lib/productos';

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

  function eliminar() {
    const motivo = prompt(`Vas a eliminar ${activos.length} producto(s): salen de todas las listas y quedan en la bitácora; se pueden reactivar.\n\n¿Por qué se eliminan?`);
    if (motivo === null) return;
    if (motivo.trim().length < 5) { alert('Escribe el motivo (mínimo 5 caracteres).'); return; }
    iniciar(async () => {
      const r = await eliminarProductos(activos.map((p) => p.id), motivo.trim());
      setResultado(r);
      if (!('error' in r)) { alTerminar?.(); router.refresh(); }
    });
  }
  function reactivar() {
    if (!confirm(`¿Reactivar ${inactivos.length} producto(s)? Vuelven a las listas y pantallas de trabajo.`)) return;
    iniciar(async () => {
      const r = await reactivarProductos(inactivos.map((p) => p.id));
      setResultado(r);
      if (!('error' in r)) { alTerminar?.(); router.refresh(); }
    });
  }

  return (
    <>
      {activos.length > 0 && (
        <button type="button" className="secundario" disabled={enviando} onClick={eliminar} style={{ color: 'var(--error)', borderColor: 'var(--error)' }}>
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
