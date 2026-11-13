'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { editarProveedor } from './acciones';
import { fecha } from '@/lib/formato';

export type FichaProveedor = {
  id: string; nombre: string; nit: string | null; activo: boolean; unido_en: string | null; alias: string[];
  productos: number; compras: number; ultima_compra: string | null; recepciones: number;
};

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

export default function Directorio({ proveedores, soloLectura }: { proveedores: FichaProveedor[]; soloLectura: boolean }) {
  const router = useRouter();
  const [enviando, iniciar] = useTransition();
  const [q, setQ] = useState('');
  const [ver, setVer] = useState<'activos' | 'inactivos' | 'unidos'>('activos');
  const [editando, setEditando] = useState<{ id: string; nombre: string; nit: string } | null>(null);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  const lista = useMemo(() => proveedores.filter((p) =>
    (ver === 'unidos' ? !!p.unido_en : ver === 'activos' ? p.activo : !p.activo && !p.unido_en)
    && (!q || normal(`${p.nombre} ${p.nit ?? ''} ${p.alias.join(' ')}`).includes(normal(q)))), [proveedores, q, ver]);
  const cuenta = { activos: proveedores.filter((p) => p.activo).length, inactivos: proveedores.filter((p) => !p.activo && !p.unido_en).length,
                   unidos: proveedores.filter((p) => p.unido_en).length };

  function guardar(p: FichaProveedor, cambios: { nombre?: string; nit?: string; activo?: boolean }, exito: string) {
    setMensaje(null);
    iniciar(async () => {
      const r = await editarProveedor(p.id, cambios.nombre ?? p.nombre, cambios.nit ?? p.nit ?? '', cambios.activo ?? p.activo);
      setMensaje(r.ok ? { ok: true, texto: exito } : { ok: false, texto: r.error });
      if (r.ok) { setEditando(null); router.refresh(); }
    });
  }

  return (
    <div className="pagina-ancha">
      <p className="suave">
        La lista de proveedores, para tenerla en orden: corrige el nombre y el NIT, y desactiva el que ya no se usa (sale de las listas de
        Recibir y de las fotos, pero su historia queda). Al cambiar un nombre, el viejo se sigue reconociendo en las facturas.
      </p>
      <div className="fila" style={{ marginBottom: '.5rem' }}>
        <input placeholder="Buscar por nombre, NIT u otro nombre…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={ver} onChange={(e) => setVer(e.target.value as typeof ver)} aria-label="Cuáles ver">
          <option value="activos">Activos ({cuenta.activos})</option>
          <option value="inactivos">Desactivados ({cuenta.inactivos})</option>
          <option value="unidos">Unidos a otro ({cuenta.unidos})</option>
        </select>
      </div>
      {mensaje && <div className={mensaje.ok ? 'exito' : 'aviso'} role="status">{mensaje.texto}</div>}
      {lista.map((p) => (
        <section key={p.id} className="tarjeta" style={{ marginBottom: '.5rem', display: 'grid', gap: '.3rem' }}>
          {editando?.id === p.id ? (
            <>
              <div className="fila">
                <label style={{ margin: 0 }}>Nombre <input value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} /></label>
                <label style={{ margin: 0 }}>NIT <input value={editando.nit} inputMode="numeric" onChange={(e) => setEditando({ ...editando, nit: e.target.value })} /></label>
              </div>
              <div style={{ display: 'flex', gap: '.4rem' }}>
                <button type="button" disabled={enviando} onClick={() => guardar(p, { nombre: editando.nombre, nit: editando.nit }, 'Proveedor actualizado.')}>Guardar</button>
                <button type="button" className="secundario" onClick={() => setEditando(null)}>Cancelar</button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
              <div>
                <strong>{p.nombre}</strong>{p.nit && <span className="suave"> · NIT {p.nit}</span>}
                {p.unido_en && <span className="etiqueta" style={{ marginLeft: '.4rem' }}>unido a {p.unido_en}</span>}
                {p.alias.length > 0 && <div className="suave" style={{ fontSize: '.8rem' }}>También se escribe: {p.alias.join(' · ')}</div>}
                <div className="suave" style={{ fontSize: '.8rem' }}>
                  {p.productos} producto(s) · {p.compras} compra(s) · {p.recepciones} recepción(es) en la app · última compra {fecha(p.ultima_compra)}
                </div>
              </div>
              {!soloLectura && !p.unido_en && (
                <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <button type="button" className="secundario mini" disabled={enviando}
                          onClick={() => setEditando({ id: p.id, nombre: p.nombre, nit: p.nit ?? '' })}>Editar</button>
                  <button type="button" className="secundario mini" disabled={enviando}
                          onClick={() => guardar(p, { activo: !p.activo }, p.activo ? `«${p.nombre}» desactivado.` : `«${p.nombre}» activo de nuevo.`)}>
                    {p.activo ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      ))}
      {!lista.length && <p className="suave">Nada con estos filtros.</p>}
    </div>
  );
}
