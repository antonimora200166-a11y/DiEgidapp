'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { editarEnBloque, type ResultadoBloque } from './acciones';
import EliminarProductos from '@/components/EliminarProductos';
import { confirmar } from '@/components/Dialogo';

export type Categoria = { codigo: string; nombre: string; area: string };
const NO = '';   // «no cambiar»
const num = (s: string) => { const n = Number(s.replace(',', '.')); return s.trim() === '' || !Number.isFinite(n) ? null : n; };

// Barra de acciones para los productos seleccionados (vista de lista y de tarjetas): validar de
// corrido o aplicar el mismo cambio a todos con public.editar_productos.
export default function BarraBloque({ elegidos, categorias, setSel, esAdmin }: {
  elegidos: { id: string; area: string; activo?: boolean }[]; categorias: Categoria[]; setSel: (s: Set<string>) => void; esAdmin?: boolean;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState(false);
  const [ub, setUb] = useState(NO);
  const [cat, setCat] = useState(NO);
  const [cons, setCons] = useState(NO);
  const [ucompra, setUcompra] = useState('');
  const [contenido, setContenido] = useState('');
  const [validar, setValidar] = useState(true);
  const [resultado, setResultado] = useState<ResultadoBloque | { error: string } | null>(null);
  const [enviando, iniciar] = useTransition();
  const areasSel = [...new Set(elegidos.map((f) => f.area))];

  async function aplicar(soloValidar: boolean) {
    const generico: Record<string, string> = {};
    const producto: Record<string, string | number> = {};
    if (!soloValidar) {
      if (ub) generico.unidad_base = ub;
      if (cat) generico.categoria = cat;
      if (cons) generico.conservacion = cons;
      if (ucompra.trim()) producto.unidad_compra = ucompra.trim().toUpperCase();
      if (num(contenido) !== null) producto.contenido_base = num(contenido)!;
    }
    const cambios = { ...(Object.keys(generico).length ? { generico } : {}), ...(Object.keys(producto).length ? { producto } : {}) };
    const conValidar = soloValidar || validar;
    if (!Object.keys(cambios).length && !conValidar) return;
    const que = [ub && `unidad base a ${ub}`, cat && `categoría ${categorias.find((c) => c.codigo === cat)?.nombre ?? cat}`,
                 cons && `conservación ${cons.toLowerCase()}`, ucompra.trim() && `unidad de compra ${ucompra.trim().toUpperCase()}`,
                 num(contenido) !== null && `contenido ${contenido}`].filter(Boolean);
    const texto = soloValidar ? `¿Validar ${elegidos.length} producto(s)?`
      : `¿Aplicar a ${elegidos.length} producto(s): ${que.join(', ') || 'ningún cambio'}${conValidar ? ', y validarlos' : ''}?`;
    if (!(await confirmar(texto, { aceptar: soloValidar ? 'Validar' : 'Aplicar' }))) return;
    setResultado(null);
    iniciar(async () => {
      const r = await editarEnBloque(elegidos.map((f) => f.id), cambios, conValidar);
      setResultado(r);
      if (!('error' in r)) {
        // los que quedaron bien salen de la selección; los que no, siguen marcados para corregirlos
        setSel(new Set(r.detalle.filter((d) => !d.ok).map((d) => d.id)));
        if (!r.fallidos) { setPanel(false); setUb(NO); setCat(NO); setCons(NO); setUcompra(''); setContenido(''); }
        router.refresh();
      }
    });
  }

  return (
    <>
      {resultado && (
        'error' in resultado ? <div className="error" role="alert">{resultado.error}</div> : (
          <div className={resultado.fallidos ? 'aviso' : 'exito'} role="status">
            <strong>{resultado.ok} producto(s) quedaron listos{resultado.fallidos ? `; ${resultado.fallidos} no se pudieron cambiar (siguen seleccionados):` : '.'}</strong>
            {resultado.fallidos > 0 && (
              <ul>{resultado.detalle.filter((d) => !d.ok).map((d) => <li key={d.id}><span className="cod">{d.codigo}</span>: {d.mensajes.join(' ')}</li>)}</ul>
            )}
          </div>
        )
      )}
      {elegidos.length > 0 && (
        <div className="barra-bloque">
          <div className="linea" style={{ flexWrap: 'wrap' }}>
            <strong>{elegidos.length} seleccionado(s)</strong>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
              <button type="button" disabled={enviando} onClick={() => aplicar(true)}>{enviando ? 'Aplicando…' : `Validar (${elegidos.length})`}</button>
              <button type="button" className="secundario" disabled={enviando} onClick={() => setPanel((x) => !x)}>{panel ? 'Ocultar cambios' : 'Cambiar…'}</button>
              {esAdmin && <EliminarProductos productos={elegidos} alTerminar={() => setSel(new Set())} />}
              <button type="button" className="secundario" disabled={enviando} onClick={() => { setSel(new Set()); setResultado(null); }}>Quitar selección</button>
            </div>
          </div>
          {panel && (
            <>
              <div style={{ display: 'grid', gap: '.6rem', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', marginTop: '.4rem' }}>
                <label style={{ margin: 0 }}>Unidad base
                  <select value={ub} onChange={(e) => setUb(e.target.value)}>
                    <option value={NO}>— no cambiar —</option><option value="g">g (peso)</option><option value="ml">ml (volumen)</option><option value="und">und (unidades)</option>
                  </select>
                </label>
                <label style={{ margin: 0 }}>Categoría
                  <select value={cat} onChange={(e) => setCat(e.target.value)}>
                    <option value={NO}>— no cambiar —</option>
                    {categorias.filter((c) => areasSel.length !== 1 || c.area === areasSel[0]).map((c) => (
                      <option key={c.codigo} value={c.codigo}>{c.nombre}{areasSel.length !== 1 ? ` (${c.area === 'BAR' ? 'bar' : 'cocina'})` : ''}</option>
                    ))}
                  </select>
                </label>
                <label style={{ margin: 0 }}>Conservación
                  <select value={cons} onChange={(e) => setCons(e.target.value)}>
                    <option value={NO}>— no cambiar —</option><option>Ambiente</option><option>Refrigerado</option><option>Congelado</option>
                  </select>
                </label>
                <label style={{ margin: 0 }}>Unidad de compra
                  <input value={ucompra} onChange={(e) => setUcompra(e.target.value)} placeholder="— no cambiar — (KG, UND, BOT…)" />
                </label>
                <label style={{ margin: 0 }}>Contenido por unidad de compra
                  <input inputMode="decimal" value={contenido} onChange={(e) => setContenido(e.target.value)} placeholder="— no cambiar — (1000, 750…)" />
                </label>
              </div>
              {ub && <p className="ayuda" style={{ marginTop: '.4rem' }}>Cambiar la unidad base no convierte el contenido: si pasas de und a g, pon también el contenido en g. No se cambia si el producto ya tiene kardex o está en una ficha.</p>}
              <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center', fontWeight: 400, margin: '.6rem 0 0' }}>
                <input type="checkbox" checked={validar} onChange={(e) => setValidar(e.target.checked)} style={{ width: 22, minHeight: 22 }} />
                Y validarlos de una vez
              </label>
              <div className="acciones" style={{ marginTop: '.6rem' }}>
                <button type="button" disabled={enviando || (!ub && !cat && !cons && !ucompra.trim() && num(contenido) === null && !validar)} onClick={() => aplicar(false)}>
                  {enviando ? 'Aplicando…' : `Aplicar a ${elegidos.length}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
