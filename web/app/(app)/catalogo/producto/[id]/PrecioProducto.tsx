'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fijarCosto } from '../../verificar/acciones';

type Por = 'COMPRA' | 'KILO' | 'BASE';

// «20.000» = 20000 · «2,5» = 2.5 · «$ 12.500» = 12500
const numero = (t: string) => {
  const x = t.replace(/[$\s]/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(x)) return Number(x.replace(/\./g, '').replace(',', '.'));
  return Number(x.replace(',', '.'));
};
const pesos = (n: number) => '$' + n.toLocaleString('es-CO', { maximumFractionDigits: n < 100 ? 2 : 0 });
const cant = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 3 });

// Precio a mano de una presentación (costo de referencia). Si ya tiene kardex, el costo lo pone la recepción.
export default function PrecioProducto({ id, unidadBase, unidadCompra, contenido, variable, hermanos, actual, conKardex }: {
  id: string; unidadBase: string; unidadCompra: string; contenido: number | null; variable: boolean; hermanos: number;
  actual: { cu: number; fuente: string; fecha: string | null; deKardex: boolean } | null; conKardex: boolean;
}) {
  const router = useRouter();
  const porCompra = !variable && !!contenido && contenido !== 1;   // «1 GR = 1 g» no aporta
  const [valor, setValor] = useState('');
  const [por, setPor] = useState<Por>(porCompra ? 'COMPRA' : unidadBase === 'und' ? 'BASE' : 'KILO');
  const [otras, setOtras] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [enviando, iniciar] = useTransition();

  const opciones: { v: Por; t: string }[] = [
    ...(porCompra ? [{ v: 'COMPRA' as const, t: `1 ${unidadCompra} (${cant(contenido!)} ${unidadBase})` }] : []),
    ...(unidadBase !== 'und' ? [{ v: 'KILO' as const, t: unidadBase === 'g' ? '1 kg' : '1 litro' }] : []),
    { v: 'BASE', t: `1 ${unidadBase}` },
  ];
  const v = numero(valor);
  const cu = !(v > 0) ? null : por === 'COMPRA' ? (porCompra ? v / contenido! : null) : por === 'KILO' ? v / 1000 : v;
  const enCompra = (c: number) => (porCompra ? ` · ${pesos(c * contenido!)} el ${unidadCompra.toLowerCase()}` : unidadBase !== 'und' ? ` · ${pesos(c * 1000)} el ${unidadBase === 'g' ? 'kg' : 'litro'}` : '');

  return (
    <div className="tarjeta" style={{ display: 'grid', gap: '.5rem' }}>
      <p style={{ margin: 0 }}>
        {actual
          ? <>Costo actual: <strong>{pesos(actual.cu)} por {unidadBase}</strong>{enCompra(actual.cu)}<br />
              <span className="suave" style={{ fontSize: '.85rem' }}>{actual.deKardex ? 'Del kardex (promedio de lo recibido)' : actual.fuente}{actual.fecha && ` · ${actual.fecha}`}</span></>
          : <span className="suave">Aún no tiene precio: las fichas que lo usan salen sin costo.</span>}
      </p>
      {conKardex
        ? <p className="suave" style={{ margin: 0, fontSize: '.88rem' }}>Ya tiene movimientos en el kardex: el precio nuevo entra con la próxima recepción.</p>
        : (
          <form onSubmit={(e) => {
            e.preventDefault();
            if (!(v > 0)) { setMsg({ ok: false, texto: 'Escribe el precio en pesos, mayor que cero.' }); return; }
            setMsg(null);
            iniciar(async () => {
              const r = await fijarCosto(id, v, por, otras);
              if (!r.ok) { setMsg({ ok: false, texto: r.error }); return; }
              setMsg({ ok: true, texto: ['Precio guardado.', ...(r.avisos ?? [])].join(' ') });
              setValor('');
              router.refresh();
            });
          }} style={{ display: 'grid', gap: '.4rem' }}>
            <div className="fila">
              <label style={{ marginTop: 0 }}>{actual ? 'Precio nuevo en pesos' : 'Precio en pesos'}
                <input inputMode="decimal" placeholder="Ej.: 20.000" value={valor} onChange={(e) => setValor(e.target.value)} />
              </label>
              <label style={{ marginTop: 0 }}>Por
                <select value={por} onChange={(e) => setPor(e.target.value as Por)}>
                  {opciones.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
                </select>
              </label>
            </div>
            {cu != null && <span className="suave">= {pesos(cu)} por {unidadBase}</span>}
            {hermanos > 0 && (
              <label style={{ margin: 0, display: 'flex', gap: '.4rem', alignItems: 'center', fontWeight: 400 }}>
                <input type="checkbox" checked={otras} style={{ width: 20, minHeight: 20 }} onChange={(e) => setOtras(e.target.checked)} />
                También a sus otras {hermanos} presentación(es) sin precio propio
              </label>
            )}
            <div className="acciones">
              <button type="submit" className="chico" disabled={enviando || !(v > 0)}>{enviando ? 'Guardando…' : 'Guardar precio'}</button>
              {msg && <span role="status" style={{ color: msg.ok ? 'var(--ok)' : 'var(--error)', alignSelf: 'center' }}>{msg.texto}</span>}
            </div>
          </form>
        )}
    </div>
  );
}
