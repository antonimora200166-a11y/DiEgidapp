'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { fecha } from '@/lib/formato';

export type CompraProveedor = {
  proveedor_id: string; proveedor: string; nit: string | null; producto_id: string; codigo: string; generico: string; marca: string;
  presentacion: string; area: 'BAR' | 'COCINA'; unidad_base: 'g' | 'ml' | 'und'; nombre_factura: string | null;
  ultimo_costo_base: number | null; ultima_fecha: string; primera_fecha: string; veces: number; origen: 'RECEPCION' | 'FOTO' | 'SHEET';
};

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const pesos = (n: number | null) => (n == null ? '—' : `$${Number(n).toLocaleString('es-CO', { maximumFractionDigits: Math.abs(Number(n)) < 10 ? 2 : 0 })}`);
const ORIGEN = { RECEPCION: 'recepción', FOTO: 'foto', SHEET: 'libro anterior' };

export default function ComprasProveedor({ filas }: { filas: CompraProveedor[] }) {
  const [q, setQ] = useState('');
  const [area, setArea] = useState<'' | 'BAR' | 'COCINA'>('');
  const [abierto, setAbierto] = useState<string | null>(null);

  const grupos = useMemo(() => {
    const t = normal(q);
    const m = new Map<string, { id: string; nombre: string; nit: string | null; filas: CompraProveedor[] }>();
    for (const f of filas) {
      if (area && f.area !== area) continue;
      if (t && !normal(`${f.proveedor} ${f.generico} ${f.marca} ${f.presentacion} ${f.nombre_factura ?? ''}`).includes(t)) continue;
      if (!m.has(f.proveedor_id)) m.set(f.proveedor_id, { id: f.proveedor_id, nombre: f.proveedor, nit: f.nit, filas: [] });
      m.get(f.proveedor_id)!.filas.push(f);
    }
    return [...m.values()].sort((a, b) => b.filas.length - a.filas.length || a.nombre.localeCompare(b.nombre));
  }, [filas, q, area]);

  return (
    <>
      <div className="fila pagina-ancha" style={{ marginBottom: '.6rem' }}>
        <input placeholder="Buscar proveedor o producto…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={area} onChange={(e) => setArea(e.target.value as '' | 'BAR' | 'COCINA')} aria-label="Área">
          <option value="">Bar y cocina</option><option value="BAR">Bar</option><option value="COCINA">Cocina</option>
        </select>
      </div>
      <p className="suave pagina-ancha" style={{ margin: '0 0 .5rem' }}>{grupos.length} proveedor(es) · {grupos.reduce((s, g) => s + g.filas.length, 0)} producto(s)</p>
      {grupos.map((g) => {
        const ver = abierto === g.id || !!q;
        return (
          <section key={g.id} className="tarjeta pagina-ancha" style={{ marginBottom: '.5rem' }}>
            <button type="button" className="secundario" style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: '.5rem' }}
                    onClick={() => setAbierto(ver && !q ? null : g.id)} aria-expanded={ver}>
              <span><strong>{g.nombre}</strong>{g.nit && <span className="suave"> · NIT {g.nit}</span>}</span>
              <span className="suave">{g.filas.length} producto(s) {ver ? '▴' : '▾'}</span>
            </button>
            {ver && (
              <div className="mt-1">
                {g.filas.map((f) => (
                  <div key={f.producto_id} style={{ borderTop: '1px solid var(--borde)', padding: '.4rem 0', display: 'flex', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 200, flex: 1 }}>
                      <Link href={`/catalogo/producto/${f.producto_id}`}><strong>{f.generico}</strong>{f.marca && ` · ${f.marca}`}</Link>
                      <div className="suave texto-mini">
                        {f.presentacion} · {f.area === 'BAR' ? 'Bar' : 'Cocina'}
                        {f.nombre_factura && <> · en su factura: «{f.nombre_factura}»</>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: '.88rem' }}>
                      {pesos(f.ultimo_costo_base)} / {f.unidad_base}
                      <div className="suave texto-mini">
                        {f.veces} {f.veces === 1 ? 'vez' : 'veces'} · última {fecha(f.ultima_fecha)} ({ORIGEN[f.origen]})
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
