'use client';
import { useMemo, useState } from 'react';
import { fmtCantidad } from '@/lib/catalogo';

// Líneas de productos que salen de una zona: las comparten Bajas y Trasladar.
// Cada línea se escribe en unidades de compra (botellas, bolsas) o en la unidad base, y la
// pantalla manda siempre la unidad base. Muestra lo que hay en la zona y lo que vale.

export type ProductoSaldo = {
  producto_id: string; codigo: string; generico: string; marca: string; presentacion: string; tipo: string;
  unidad_base: 'g' | 'ml' | 'und'; unidad_compra: string; contenido_base: number | null; contenido_variable: boolean;
  costo_promedio: number | null; saldos: Record<string, number>; estado: string;
};
export type LineaInv = { clave: string; producto_id: string; cantidad: string; modo: 'compra' | 'base' };

const num = (s: string) => { const n = Number(s.replace(',', '.')); return s.trim() === '' || !Number.isFinite(n) ? null : n; };
const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const pesos = (n: number) => n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
export const porCompra = (p: ProductoSaldo) => !p.contenido_variable && (p.contenido_base ?? 0) > 1;
export const saldoEn = (p: ProductoSaldo | undefined, zona: string) => (p && zona ? Number(p.saldos[zona] ?? 0) : 0);

// Cantidad en unidad base de una línea (null si no es un número positivo)
export function baseDe(l: LineaInv, p: ProductoSaldo | undefined): number | null {
  const q = num(l.cantidad);
  if (!p || q === null || q <= 0) return null;
  return l.modo === 'compra' && porCompra(p) ? q * p.contenido_base! : q;
}
export const valorDe = (l: LineaInv, p: ProductoSaldo | undefined) => {
  const b = baseDe(l, p);
  return b !== null && p?.costo_promedio != null ? b * p.costo_promedio : null;
};

export default function LineasInventario({ productos, zona, lineas, setLineas, ofrecerTodo }: {
  productos: ProductoSaldo[]; zona: string; lineas: LineaInv[]; setLineas: (f: (ls: LineaInv[]) => LineaInv[]) => void; ofrecerTodo?: boolean;
}) {
  const porId = useMemo(() => new Map(productos.map((p) => [p.producto_id, p])), [productos]);
  const [buscar, setBuscar] = useState('');
  const opciones = useMemo(() => {
    const f = sinTildes(buscar.trim());
    if (f.length < 2) return [];
    const ps = f.split(/\s+/);
    return productos
      .filter((p) => !lineas.some((l) => l.producto_id === p.producto_id)
        && ps.every((w) => sinTildes(`${p.generico} ${p.marca} ${p.presentacion} ${p.codigo}`).includes(w)))
      .sort((a, b) => saldoEn(b, zona) - saldoEn(a, zona))   // primero lo que hay en la zona
      .slice(0, 8);
  }, [buscar, productos, lineas, zona]);

  const poner = (k: string, cambio: Partial<LineaInv>) => setLineas((ls) => ls.map((l) => (l.clave === k ? { ...l, ...cambio } : l)));
  const agregar = (p: ProductoSaldo) => {
    setLineas((ls) => [...ls, { clave: crypto.randomUUID(), producto_id: p.producto_id, cantidad: '', modo: porCompra(p) ? 'compra' : 'base' }]);
    setBuscar('');
  };

  return (
    <>
      <ul className="lista">
        {lineas.map((l) => {
          const p = porId.get(l.producto_id);
          if (!p) return null;
          const b = baseDe(l, p), hay = saldoEn(p, zona), v = valorDe(l, p);
          return (
            <li key={l.clave} style={b !== null && b > hay ? { borderColor: 'var(--aviso)', borderWidth: 2 } : undefined}>
              <div className="linea" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{p.generico}</strong>{p.marca && ` · ${p.marca}`}
                  <div className="suave" style={{ fontSize: '.85rem' }}>{p.presentacion}{p.estado === 'PROVISIONAL' && ' · provisional'}</div>
                </div>
                <button type="button" className="secundario" style={{ minHeight: 36, padding: '.3rem .7rem' }} aria-label={`Quitar ${p.generico}`}
                        onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}>Quitar</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '.5rem', marginTop: '.5rem', alignItems: 'end' }}>
                <label style={{ margin: 0, fontWeight: 400, fontSize: '.85rem' }}>Cantidad
                  <input inputMode="decimal" value={l.cantidad} onChange={(e) => poner(l.clave, { cantidad: e.target.value })} />
                </label>
                {porCompra(p) ? (
                  <div className="segmentos" role="radiogroup" aria-label={`Unidad de ${p.generico}`}>
                    <label><input type="radio" name={`modo-${l.clave}`} checked={l.modo === 'compra'} onChange={() => poner(l.clave, { modo: 'compra' })} /><span>{p.unidad_compra.toLowerCase()}</span></label>
                    <label><input type="radio" name={`modo-${l.clave}`} checked={l.modo === 'base'} onChange={() => poner(l.clave, { modo: 'base' })} /><span>{p.unidad_base}</span></label>
                  </div>
                ) : <span className="suave" style={{ paddingBottom: '.7rem' }}>{p.unidad_base}</span>}
              </div>
              <div className="suave" style={{ fontSize: '.82rem', marginTop: '.3rem' }}>
                {b !== null && l.modo === 'compra' && porCompra(p) && <>= {fmtCantidad(b)} {p.unidad_base} · </>}
                {zona ? <>en la zona hay {fmtCantidad(hay)} {p.unidad_base}</> : 'elige la zona para ver el saldo'}
                {v !== null && <> · vale {pesos(v)}</>}
                {ofrecerTodo && hay > 0 && (
                  <> · <button type="button" className="secundario" style={{ minHeight: 0, padding: '.1rem .5rem', fontSize: '.82rem' }}
                               onClick={() => poner(l.clave, { cantidad: String(hay), modo: 'base' })}>todo</button></>
                )}
              </div>
              {b !== null && zona && b > hay && (
                <div className="aviso" style={{ margin: '.5rem 0 0', padding: '.4rem .6rem', fontSize: '.85rem' }}>
                  El kardex no tiene tanto en esta zona: al guardar te pedirá un motivo.
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <label htmlFor="buscar-producto">Agregar producto</label>
      <input id="buscar-producto" placeholder="Buscar en el catálogo…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      {opciones.length > 0 && (
        <ul className="lista" style={{ marginTop: '.4rem' }}>
          {opciones.map((p) => (
            <li key={p.producto_id} style={{ padding: 0 }}>
              <button type="button" className="secundario" style={{ width: '100%', textAlign: 'left', border: 0, color: 'inherit' }} onClick={() => agregar(p)}>
                <strong>{p.generico}</strong> <span className="suave">· {[p.marca, p.presentacion].filter(Boolean).join(' · ')}
                  {zona && saldoEn(p, zona) !== 0 && ` · hay ${fmtCantidad(saldoEn(p, zona))} ${p.unidad_base}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {buscar.trim().length >= 2 && !opciones.length && <p className="suave" style={{ fontSize: '.85rem' }}>Nada coincide.</p>}
    </>
  );
}
