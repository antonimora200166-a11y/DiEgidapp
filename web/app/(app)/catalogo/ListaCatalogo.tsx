'use client';
import { useState } from 'react';
import Link from 'next/link';
import { validarProducto } from './acciones';
import BarraBloque, { type Categoria } from './BarraBloque';
import { faltasDe, type ProductoCatalogo } from './tipos';

// Vista de tarjetas: cómoda en el celular. La de lista (TablaCatalogo) es la de trabajo en el PC.
export default function ListaCatalogo({ filas, categorias, esAdmin }: { filas: ProductoCatalogo[]; categorias: Categoria[]; esAdmin?: boolean }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const editables = filas.filter((f) => f.edita);
  const cambia = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const todas = editables.length > 0 && editables.every((f) => sel.has(f.id));

  return (
    <>
      {editables.length > 0 && (
        <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center', fontWeight: 500, margin: '0 0 .6rem' }}>
          <input type="checkbox" checked={todas} style={{ width: 22, minHeight: 22 }}
                 onChange={() => setSel(todas ? new Set() : new Set(editables.map((f) => f.id)))} />
          Seleccionar los {editables.length} de esta página
        </label>
      )}
      <ul className="rejilla">
        {filas.map((p) => {
          const faltas = faltasDe(p);
          return (
            <li key={p.id} className={sel.has(p.id) ? 'elegido' : undefined}>
              <div style={{ display: 'flex', gap: '.55rem', alignItems: 'flex-start' }}>
                {p.edita && (
                  <input type="checkbox" aria-label={`Seleccionar ${p.generico}`} checked={sel.has(p.id)} onChange={() => cambia(p.id)}
                         style={{ width: 22, minHeight: 22, marginTop: '.1rem', flex: 'none' }} />
                )}
                <div style={{ minWidth: 0 }}>
                  {p.edita
                    ? <Link href={`/catalogo/producto/${p.id}`}><strong>{p.generico}</strong>{p.marca && ` · ${p.marca}`}</Link>
                    : <><strong>{p.generico}</strong>{p.marca && ` · ${p.marca}`}</>}
                  <div className="suave" style={{ fontSize: '.88rem' }}>{p.presentacion}</div>
                </div>
              </div>
              <div className="cod">
                {p.codigo} · {p.area} · {p.tipo} · <span className={`etiqueta ${p.activo ? p.estado.toLowerCase() : 'inactivo'}`}>{p.activo ? p.estado : 'INACTIVO'}</span>
                {p.clase_abc && <> · clase {p.clase_abc}</>}
              </div>
              <div className="suave" style={{ fontSize: '.82rem' }}>
                {p.categoria_nombre ?? 'Sin categoría'} · base {p.unidad_base} · compra {p.unidad_compra || '—'}
                {p.contenido_variable ? ' · contenido variable' : p.contenido_base ? ` de ${Number(p.contenido_base).toLocaleString('es-CO')} ${p.unidad_base}` : ''}
              </div>
              {faltas.length > 0 && <div style={{ fontSize: '.82rem', color: 'var(--aviso)' }}>Falta: {faltas.join(' · ')}</div>}
              {p.edita && (
                <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '.3rem' }}>
                  <Link href={`/catalogo/producto/${p.id}`} className={`boton chico${p.estado === 'PROVISIONAL' ? '' : ' secundario'}`}>
                    {p.estado === 'PROVISIONAL' ? 'Revisar' : 'Editar'}
                  </Link>
                  {p.estado === 'PROVISIONAL' && (
                    <form action={validarProducto}>
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" className="secundario chico" title="Validar sin cambios">Validar</button>
                    </form>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <BarraBloque elegidos={filas.filter((f) => sel.has(f.id))} categorias={categorias} setSel={setSel} esAdmin={esAdmin} />
    </>
  );
}
