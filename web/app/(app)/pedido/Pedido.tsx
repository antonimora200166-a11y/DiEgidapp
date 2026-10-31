'use client';
import { useState } from 'react';

export type LineaPedido = {
  producto_id: string; codigo: string; generico: string; marca: string; presentacion: string; unidad_compra: string;
  saldo_unidades: number; minimo: number; maximo: number | null; pedir: number; tiene_kardex: boolean;
  proveedor: string | null; ultima_compra: string | null; costo_unidad: number | null;
};
const pesos = (n: number) => n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
// la marca no se repite cuando ya va en el nombre (o al revés)
const nombre = (l: LineaPedido) => {
  const g = l.generico.toLowerCase(), m = l.marca.toLowerCase();
  const base = !m || g.includes(m) ? l.generico : m.includes(g) ? l.marca : `${l.generico} · ${l.marca}`;
  return [base, l.presentacion].filter(Boolean).join(' · ');
};

// Pedido por proveedor: se ajusta la cantidad y se copia el texto para mandarlo por WhatsApp.
export default function Pedido({ lineas }: { lineas: LineaPedido[] }) {
  const [cant, setCant] = useState<Record<string, string>>(() => Object.fromEntries(lineas.map((l) => [l.producto_id, String(l.pedir)])));
  const [copiado, setCopiado] = useState<string | null>(null);
  const porProveedor = new Map<string, LineaPedido[]>();
  for (const l of lineas) porProveedor.set(l.proveedor ?? 'Sin proveedor conocido', [...(porProveedor.get(l.proveedor ?? 'Sin proveedor conocido') ?? []), l]);
  const n = (id: string) => { const x = Number((cant[id] ?? '').replace(',', '.')); return Number.isFinite(x) && x > 0 ? x : 0; };

  async function copiar(prov: string, ls: LineaPedido[]) {
    const texto = [`Pedido Di Égida — ${new Date().toLocaleDateString('es-CO')}`, '',
      ...ls.filter((l) => n(l.producto_id) > 0).map((l) => `• ${n(l.producto_id)} ${l.unidad_compra.toLowerCase()} — ${nombre(l)}`), '', 'Gracias.'].join('\n');
    try { await navigator.clipboard.writeText(texto); setCopiado(prov); setTimeout(() => setCopiado(null), 2500); }
    catch { window.prompt('Copia el pedido:', texto); }
  }

  return (
    <>
      {[...porProveedor.entries()].map(([prov, ls]) => {
        const total = ls.reduce((t, l) => t + n(l.producto_id) * Number(l.costo_unidad ?? 0), 0);
        return (
          <section key={prov} className="tarjeta" style={{ marginBottom: '1rem' }}>
            <div className="linea" style={{ display: 'flex', justifyContent: 'space-between', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>{prov} <span className="suave" style={{ fontWeight: 400, fontSize: '.9rem' }}>· {ls.length}</span></h2>
              <button type="button" className="chico" onClick={() => copiar(prov, ls)}>{copiado === prov ? '✔ Copiado' : 'Copiar pedido'}</button>
            </div>
            <ul className="lista" style={{ marginTop: '.7rem' }}>
              {ls.map((l) => (
                <li key={l.producto_id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem .75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 210px', minWidth: 0 }}>
                      <strong>{nombre(l)}</strong>
                      <div className="suave" style={{ fontSize: '.82rem' }}>
                        Hay {Number(l.saldo_unidades).toLocaleString('es-CO')} · mínimo {Number(l.minimo).toLocaleString('es-CO')}
                        {l.maximo !== null && ` · máximo ${Number(l.maximo).toLocaleString('es-CO')}`}
                        {l.costo_unidad !== null && ` · ${pesos(Number(l.costo_unidad))} c/u`}
                        {l.ultima_compra && ` · última compra ${new Date(l.ultima_compra + 'T12:00:00').toLocaleDateString('es-CO')}`}
                      </div>
                    </div>
                    <label style={{ margin: 0, fontWeight: 400, fontSize: '.8rem', display: 'flex', alignItems: 'center', gap: '.4rem', flex: 'none', marginLeft: 'auto' }}>
                      Pedir ({l.unidad_compra.toLowerCase()})
                      <input inputMode="decimal" value={cant[l.producto_id] ?? ''} onChange={(e) => setCant((c) => ({ ...c, [l.producto_id]: e.target.value }))}
                             style={{ width: 80, textAlign: 'right' }} aria-label={`Cantidad a pedir de ${nombre(l)}`} />
                    </label>
                  </div>
                </li>
              ))}
            </ul>
            {total > 0 && <p className="suave" style={{ margin: '.6rem 0 0', fontSize: '.88rem' }}>Valor aproximado con el último precio: <strong>{pesos(total)}</strong></p>}
          </section>
        );
      })}
    </>
  );
}
