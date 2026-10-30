'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { editarEnBloque, validarProducto, type ResultadoBloque } from './acciones';

export type FilaCatalogo = {
  id: string; codigo: string; nombre: string; marca: string; presentacion: string; area: 'BAR' | 'COCINA'; estado: string;
  clase_abc: string | null; unidad_base: string; unidad_compra: string; contenido_base: number | null; contenido_variable: boolean;
  creador: string | null; faltas: string[]; edita: boolean;
};
type Categoria = { codigo: string; nombre: string; area: string };

const NO = '';   // «no cambiar»
const num = (s: string) => { const n = Number(s.replace(',', '.')); return s.trim() === '' || !Number.isFinite(n) ? null : n; };

export default function ListaCatalogo({ filas, categorias }: { filas: FilaCatalogo[]; categorias: Categoria[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState(false);
  const [ub, setUb] = useState(NO);
  const [cat, setCat] = useState(NO);
  const [cons, setCons] = useState(NO);
  const [ucompra, setUcompra] = useState('');
  const [contenido, setContenido] = useState('');
  const [validar, setValidar] = useState(true);
  const [resultado, setResultado] = useState<ResultadoBloque | { error: string } | null>(null);
  const [enviando, iniciar] = useTransition();

  const editables = filas.filter((f) => f.edita);
  const elegidas = filas.filter((f) => sel.has(f.id));
  const areasSel = [...new Set(elegidas.map((f) => f.area))];
  const cambia = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const todas = editables.length > 0 && editables.every((f) => sel.has(f.id));

  function aplicar(soloValidar: boolean) {
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
    const texto = soloValidar ? `¿Validar ${elegidas.length} producto(s)?`
      : `¿Aplicar a ${elegidas.length} producto(s): ${que.join(', ') || 'ningún cambio'}${conValidar ? ', y validarlos' : ''}?`;
    if (!confirm(texto)) return;
    setResultado(null);
    iniciar(async () => {
      const r = await editarEnBloque(elegidas.map((f) => f.id), cambios, conValidar);
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
      {editables.length > 0 && (
        <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center', fontWeight: 500, margin: '0 0 .6rem' }}>
          <input type="checkbox" checked={todas} style={{ width: 22, minHeight: 22 }}
                 onChange={() => setSel(todas ? new Set() : new Set(editables.map((f) => f.id)))} />
          Seleccionar los {editables.length} de esta página
        </label>
      )}
      <ul className="rejilla">
        {filas.map((p) => (
          <li key={p.id} className={sel.has(p.id) ? 'elegido' : undefined}>
            <div style={{ display: 'flex', gap: '.55rem', alignItems: 'flex-start' }}>
              {p.edita && (
                <input type="checkbox" aria-label={`Seleccionar ${p.nombre}`} checked={sel.has(p.id)} onChange={() => cambia(p.id)}
                       style={{ width: 22, minHeight: 22, marginTop: '.1rem', flex: 'none' }} />
              )}
              <div style={{ minWidth: 0 }}>
                {p.edita
                  ? <Link href={`/catalogo/producto/${p.id}`}><strong>{p.nombre}</strong>{p.marca && ` · ${p.marca}`}</Link>
                  : <><strong>{p.nombre}</strong>{p.marca && ` · ${p.marca}`}</>}
                <div className="suave" style={{ fontSize: '.88rem' }}>{p.presentacion}</div>
              </div>
            </div>
            <div className="cod">
              {p.codigo} · {p.area} · <span className={`etiqueta ${p.estado.toLowerCase()}`}>{p.estado}</span>
              {p.clase_abc && <> · clase {p.clase_abc}</>}
            </div>
            <div className="suave" style={{ fontSize: '.82rem' }}>
              Base {p.unidad_base} · compra {p.unidad_compra || '—'}
              {p.contenido_variable ? ' · contenido variable' : p.contenido_base ? ` de ${p.contenido_base.toLocaleString('es-CO')} ${p.unidad_base}` : ''}
              {p.estado === 'PROVISIONAL' && <> · {p.creador ?? 'migración'}</>}
            </div>
            {p.faltas.length > 0 && <div style={{ fontSize: '.82rem', color: 'var(--aviso)' }}>Falta: {p.faltas.join(' · ').toLowerCase()}</div>}
            {p.edita && (
              <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '.3rem' }}>
                <Link href={`/catalogo/producto/${p.id}`} className={`boton${p.estado === 'PROVISIONAL' ? '' : ' secundario'}`} style={{ minHeight: 38, padding: '.3rem .8rem' }}>
                  {p.estado === 'PROVISIONAL' ? 'Revisar' : 'Editar'}
                </Link>
                {p.estado === 'PROVISIONAL' && (
                  <form action={validarProducto}>
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="secundario" style={{ minHeight: 38, padding: '.3rem .8rem' }} title="Validar sin cambios">Validar</button>
                  </form>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {resultado && (
        'error' in resultado ? <div className="error" role="alert">{resultado.error}</div> : (
          <div className={resultado.fallidos ? 'aviso' : 'exito'} role="status">
            <strong>{resultado.ok} producto(s) quedaron listos{resultado.fallidos ? `; ${resultado.fallidos} no se pudieron cambiar (siguen seleccionados):` : '.'}</strong>
            {resultado.fallidos > 0 && (
              <ul>{resultado.detalle.filter((d) => !d.ok).map((d) => (
                <li key={d.id}><span className="cod">{d.codigo}</span>: {d.mensajes.join(' ')}</li>
              ))}</ul>
            )}
          </div>
        )
      )}

      {sel.size > 0 && (
        <div className="barra-bloque">
          <div className="linea" style={{ flexWrap: 'wrap' }}>
            <strong>{sel.size} seleccionado(s)</strong>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
              <button type="button" disabled={enviando} onClick={() => aplicar(true)}>{enviando ? 'Aplicando…' : `Validar (${sel.size})`}</button>
              <button type="button" className="secundario" disabled={enviando} onClick={() => setPanel((x) => !x)}>{panel ? 'Ocultar cambios' : 'Cambiar…'}</button>
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
                  {enviando ? 'Aplicando…' : `Aplicar a ${sel.size}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
