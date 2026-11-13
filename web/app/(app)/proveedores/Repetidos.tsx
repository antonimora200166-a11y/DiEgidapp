'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { marcarDistintos, unirProveedores } from './acciones';

export type Par = { a_id: string; a_nombre: string; a_compras: number; b_id: string; b_nombre: string; b_compras: number; parecido: number; motivo: string };

export default function Repetidos({ pares, soloLectura }: { pares: Par[]; soloLectura: boolean }) {
  const router = useRouter();
  const [enviando, iniciar] = useTransition();
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  // por defecto queda el nombre más completo (el más largo), que suele ser el de la factura
  const [queda, setQueda] = useState<Record<string, string>>({});
  const clave = (p: Par) => `${p.a_id}|${p.b_id}`;
  const elegido = (p: Par) => queda[clave(p)] ?? (p.a_nombre.length >= p.b_nombre.length ? p.a_id : p.b_id);

  function correr(fn: () => Promise<{ ok: true; mensaje?: string } | { ok: false; error: string }>, exito: string) {
    setMensaje(null);
    iniciar(async () => {
      const r = await fn();
      setMensaje(r.ok ? { ok: true, texto: r.mensaje || exito } : { ok: false, texto: r.error });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="pagina-ancha">
      <p className="suave">
        Proveedores que podrían ser el mismo, escrito de formas distintas. Al unirlos, el que sale queda como otro nombre del que queda:
        sus compras pasan a contarse juntas y, cuando una factura o foto traiga ese nombre, se reconoce solo. Las recepciones viejas no cambian.
      </p>
      {mensaje && <div className={mensaje.ok ? 'exito' : 'aviso'} role="status">{mensaje.texto}</div>}
      {!pares.length && <p>No hay proveedores parecidos por revisar. ✔</p>}
      {pares.map((p) => {
        const q = elegido(p);
        const [nq, nv] = q === p.a_id ? [p.a_nombre, p.b_nombre] : [p.b_nombre, p.a_nombre];
        return (
          <section key={clave(p)} className="tarjeta" style={{ marginBottom: '.5rem', display: 'grid', gap: '.4rem' }}>
            <div className="suave texto-mini">{p.motivo} · parecido {Math.round(p.parecido * 100)} %</div>
            {[{ id: p.a_id, nombre: p.a_nombre, compras: p.a_compras }, { id: p.b_id, nombre: p.b_nombre, compras: p.b_compras }].map((x) => (
              <label className="check" key={x.id}>
                {!soloLectura && <input type="radio" name={clave(p)} checked={q === x.id}
                                        onChange={() => setQueda((s) => ({ ...s, [clave(p)]: x.id }))} />}
                <strong>{x.nombre}</strong> <span className="suave">· {x.compras} compra(s) registradas</span>
              </label>
            ))}
            {!soloLectura && (
              <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                <button type="button" disabled={enviando}
                        onClick={() => correr(() => unirProveedores(q, q === p.a_id ? p.b_id : p.a_id), `«${nv}» ahora es «${nq}».`)}>
                  Son el mismo: queda «{nq}»
                </button>
                <button type="button" className="secundario" disabled={enviando}
                        onClick={() => correr(() => marcarDistintos(p.a_id, p.b_id), 'Anotado: no vuelven a salir como repetidos.')}>
                  No son el mismo
                </button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
