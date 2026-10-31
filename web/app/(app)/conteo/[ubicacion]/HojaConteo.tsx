'use client';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { fmtCantidad } from '@/lib/catalogo';
import { entenderDictado, type Dictado } from '@/lib/voz';
import { registrarConteo, type LineaConteo, type ResultadoConteo } from '../acciones';
import { confirmar } from '@/components/Dialogo';

export type ProductoHoja = {
  producto_id: string; codigo: string; generico: string; marca: string; presentacion: string; categoria: string;
  unidad_base: 'g' | 'ml' | 'und'; unidad_compra: string; contenido_base: number | null; contenido_variable: boolean;
  tiene_tara: boolean; tiene_kardex: boolean; asignado: boolean; orden: number | null; estado: string;
  clase_abc: 'A' | 'B' | 'C' | null; ultimo_conteo: string | null; toca: boolean;
};
// Lo que se escribe por producto, como texto para no perder lo que la persona teclea
type Captura = { cerradas: string; suelto: string; peso: string };
const VACIA: Captura = { cerradas: '', suelto: '', peso: '' };

const num = (s: string) => { const n = Number(s.replace(',', '.')); return s.trim() === '' || !Number.isFinite(n) ? null : n; };
// Se cuenta por unidades cerradas cuando la presentación trae un contenido fijo mayor que 1 unidad base
const porCerradas = (p: ProductoHoja) => !p.contenido_variable && (p.contenido_base ?? 0) > 1;
const nombreDe = (p: ProductoHoja) => [p.generico, p.marca, p.presentacion].filter(Boolean).join(' · ');
// reconocimiento de voz del navegador (Chrome en Android y PC); sin él, el botón no aparece
type Reconocedor = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const crearReconocedor = (): Reconocedor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Reconocedor; webkitSpeechRecognition?: new () => Reconocedor };
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return C ? new C() : null;
};
const cuenta = (c?: Captura) => !!c && (c.cerradas.trim() !== '' || c.suelto.trim() !== '' || c.peso.trim() !== '');

export default function HojaConteo({ ubicacion, productos, haceInicial }: { ubicacion: string; productos: ProductoHoja[]; haceInicial: boolean }) {
  const sinKardex = productos.filter((p) => !p.tiene_kardex);
  const conKardex = productos.filter((p) => p.tiene_kardex);
  // si nada tiene kardex y quien cuenta es jefe, el conteo que corresponde es el inicial
  const [inicial, setInicial] = useState(haceInicial && sinKardex.length > 0 && conKardex.length === 0);
  const lista = inicial ? sinKardex : conKardex;
  const clave = `sgi-conteo:${ubicacion}:${inicial ? 'inicial' : 'normal'}`;

  const [capturas, setCapturas] = useState<Record<string, Captura>>({});
  const [obs, setObs] = useState('');
  const [filtro, setFiltro] = useState('');
  const [soloFaltan, setSoloFaltan] = useState(false);
  const tocan = inicial ? 0 : lista.filter((p) => p.toca).length;
  const [soloTocan, setSoloTocan] = useState(tocan > 0);
  // productos que hay que recontar → lo que dio el primer conteo (se guarda con el reconteo)
  const [recontar, setRecontar] = useState<Record<string, number>>({});
  const [vozDisponible, setVozDisponible] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const [oido, setOido] = useState<{ texto: string; d?: Dictado; antes?: Captura; error?: string } | null>(null);
  const reconocedor = useRef<Reconocedor | null>(null);
  const [resultado, setResultado] = useState<ResultadoConteo | null>(null);
  const [enviando, iniciar] = useTransition();

  // borrador en este equipo: recargar la página o bloquear el celular no borra lo contado.
  // Solo se guarda bajo la clave ya cargada: al cambiar de inicial a normal no se pisa un borrador con el otro.
  const [cargadoDe, setCargadoDe] = useState<string | null>(null);
  useEffect(() => {
    try { setCapturas(JSON.parse(localStorage.getItem(clave) || '{}')); } catch { setCapturas({}); }
    try { setRecontar(JSON.parse(localStorage.getItem(`${clave}:recontar`) || '{}')); } catch { setRecontar({}); }
    setCargadoDe(clave);
    setResultado(null);
  }, [clave]);
  useEffect(() => {
    if (cargadoDe !== clave) return;
    try { localStorage.setItem(clave, JSON.stringify(capturas)); localStorage.setItem(`${clave}:recontar`, JSON.stringify(recontar)); } catch { /* sin almacenamiento: sigue en memoria */ }
  }, [clave, cargadoDe, capturas, recontar]);
  useEffect(() => { setVozDisponible(!!crearReconocedor()); }, []);

  const poner = (id: string, campo: keyof Captura, valor: string) =>
    setCapturas((c) => ({ ...c, [id]: { ...(c[id] ?? VACIA), [campo]: valor } }));
  const contados = lista.filter((p) => cuenta(capturas[p.producto_id]));

  const visibles = useMemo(() => {
    const f = filtro.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return lista.filter((p) => (!soloFaltan || !cuenta(capturas[p.producto_id])) && (!soloTocan || p.toca || p.producto_id in recontar)
      && (!f || `${p.generico} ${p.marca} ${p.presentacion} ${p.codigo}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(f)));
  }, [lista, filtro, soloFaltan, soloTocan, capturas, recontar]);

  function total(p: ProductoHoja, c?: Captura) {
    if (!c) return null;
    const cerr = num(c.cerradas), sue = num(c.suelto);
    if (cerr === null && sue === null) return null;
    return (cerr ?? 0) * (porCerradas(p) ? p.contenido_base! : 0) + (sue ?? 0);
  }

  async function guardar() {
    const lineas: LineaConteo[] = [];
    const malos: string[] = [];
    for (const p of contados) {
      const c = capturas[p.producto_id]!;
      const cerr = num(c.cerradas), sue = num(c.suelto), peso = num(c.peso);
      if ([c.cerradas, c.suelto, c.peso].some((s) => s.trim() !== '' && num(s) === null) || [cerr, sue, peso].some((n) => n !== null && n < 0)) {
        malos.push(p.generico);
        continue;
      }
      const l: LineaConteo = { producto_id: p.producto_id };
      if (p.producto_id in recontar) { l.recontado = true; l.primer_conteo = recontar[p.producto_id]; }
      if (cerr !== null && porCerradas(p)) l.unidades_compra = cerr;
      if (sue !== null) l.cantidad = sue;
      if (peso !== null) l.peso_bruto_g = peso;
      lineas.push(l);
    }
    if (malos.length) {
      setResultado({ ok: false, id: null, codigo: null, fatales: [`Revisa los números de: ${malos.join(', ')}.`], bloqueos: [], avisos: [] });
      return;
    }
    const faltan = lista.length - lineas.length;
    const aviso = inicial
      ? `Vas a abrir el kardex de ${lineas.length} producto(s) en esta zona.${faltan ? ` ${faltan} sin contar quedan para después.` : ''}`
      : `Vas a guardar ${lineas.length} producto(s). Las diferencias con el kardex quedan como ajuste.${faltan ? ` Los ${faltan} que no contaste no cambian.` : ''}`;
    if (!(await confirmar(aviso, { titulo: '¿Guardar el conteo?', aceptar: 'Guardar' }))) return;
    iniciar(async () => {
      const r = await registrarConteo(ubicacion, inicial, lineas, obs);
      setResultado(r);
      if (!r.ok && r.recontar?.length) {
        // se cuentan otra vez sin ver el primer número: se borra lo escrito de esos productos
        setRecontar((x) => ({ ...x, ...Object.fromEntries(r.recontar!.map((c) => [c.producto_id, Number(c.contada)])) }));
        setCapturas((x) => { const n = { ...x }; for (const c of r.recontar!) delete n[c.producto_id]; return n; });
        setSoloFaltan(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      if (r.ok) {
        try { localStorage.removeItem(clave); localStorage.removeItem(`${clave}:recontar`); } catch { /* nada */ }
        setCapturas({});
        setRecontar({});
        setObs('');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  function dictar() {
    if (escuchando) { reconocedor.current?.stop(); return; }
    const rec = crearReconocedor();
    if (!rec) return;
    rec.lang = 'es-CO'; rec.continuous = true; rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const texto = e.results[i][0].transcript.trim();
        const d = entenderDictado(texto, lista.map((p) => ({ id: p.producto_id, nombre: nombreDe(p), cerradas: porCerradas(p), tara: p.tiene_tara })));
        if ('error' in d) { setOido({ texto, error: d.error }); continue; }
        setCapturas((x) => {
          setOido({ texto, d, antes: x[d.id] });
          return { ...x, [d.id]: { ...(x[d.id] ?? VACIA), [d.campo]: d.valor } };
        });
      }
    };
    rec.onerror = (e) => setOido({ texto: '', error: e.error === 'not-allowed' ? 'El navegador no dejó usar el micrófono.' : 'No se pudo escuchar. Intenta de nuevo.' });
    rec.onend = () => setEscuchando(false);
    reconocedor.current = rec;
    rec.start();
    setEscuchando(true);
  }
  function deshacerDictado() {
    if (!oido?.d) return;
    const { id } = oido.d;
    setCapturas((x) => { const n = { ...x }; if (oido.antes) n[id] = oido.antes; else delete n[id]; return n; });
    setOido(null);
  }

  if (resultado?.ok) {
    return (
      <div className="tarjeta">
        <p className="exito" role="status" style={{ marginTop: 0 }}>
          <strong>Conteo guardado: {resultado.codigo}</strong><br />
          {inicial ? `${resultado.ajustes ?? 0} producto(s) abrieron su kardex.` : `${resultado.ajustes ?? 0} diferencia(s) quedaron como ajuste.`}
        </p>
        {resultado.avisos.length > 0 && <div className="aviso"><ul style={{ margin: 0 }}>{resultado.avisos.map((m) => <li key={m}>{m}</li>)}</ul></div>}
        <div className="acciones">
          <Link className="boton" href="/existencias">Ver existencias</Link>
          <Link className="boton secundario" href="/conteo">Contar otra zona</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {haceInicial && sinKardex.length > 0 && (
        <div className="segmentos" role="radiogroup" aria-label="Tipo de conteo" style={{ marginBottom: '.8rem' }}>
          <label><input type="radio" checked={inicial} onChange={() => setInicial(true)} /><span>Conteo inicial ({sinKardex.length})</span></label>
          <label><input type="radio" checked={!inicial} onChange={() => setInicial(false)} /><span>Conteo normal ({conKardex.length})</span></label>
        </div>
      )}
      {inicial ? (
        <p className="aviso">Conteo inicial: lo que cuentes abre el kardex de cada producto y se valoriza con su costo de referencia. Cuenta con cuidado: es el punto de partida.</p>
      ) : !conKardex.length ? (
        <p className="aviso">
          Esta zona todavía no tiene conteo inicial: ningún producto tiene kardex.
          {haceInicial ? ' Elige «Conteo inicial» arriba.' : ' Lo hace el jefe del área o administración; después ya se puede contar aquí.'}
        </p>
      ) : sinKardex.length > 0 && (
        <p className="suave" style={{ fontSize: '.88rem' }}>{sinKardex.length} producto(s) de esta zona aún no tienen kardex: entran en el conteo inicial.</p>
      )}

      {Object.keys(recontar).length > 0 && (
        <p className="aviso" role="status">
          <strong>Recuenta {Object.keys(recontar).length} producto(s)</strong> (marcados en rojo): lo contado se aparta mucho de lo esperado.
          Cuéntalos otra vez con calma, escríbelos y guarda. Lo que salga en el segundo conteo es lo que queda.
        </p>
      )}
      {lista.length > 0 && (
        <>
          <div style={{ position: 'sticky', top: 56, zIndex: 5, background: 'var(--fondo)', padding: '.5rem 0' }}>
            <div className="fila" style={{ gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
              <input aria-label="Buscar en la hoja" placeholder="Buscar en esta zona…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
              <label style={{ margin: 0, fontWeight: 400, display: 'flex', gap: '.4rem', alignItems: 'center', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={soloFaltan} onChange={(e) => setSoloFaltan(e.target.checked)} style={{ width: 22, minHeight: 22 }} />
                Solo sin contar
              </label>
            </div>
            {(tocan > 0 || vozDisponible) && (
              <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '.4rem' }}>
                {tocan > 0 && (
                  <label style={{ margin: 0, fontWeight: 400, display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                    <input type="checkbox" checked={soloTocan} onChange={(e) => setSoloTocan(e.target.checked)} style={{ width: 22, minHeight: 22 }} />
                    Solo los que toca contar hoy ({tocan})
                  </label>
                )}
                {vozDisponible && (
                  <button type="button" className={escuchando ? 'chico' : 'secundario chico'} onClick={dictar}
                          aria-pressed={escuchando}>
                    {escuchando ? '■ Dejar de escuchar' : '🎤 Contar por voz'}
                  </button>
                )}
              </div>
            )}
            {escuchando && !oido && <div className="suave" style={{ fontSize: '.85rem', marginTop: '.3rem' }}>Di el producto y la cantidad: «ginebra tres botellas», «limón 1500», «ron pesa 820».</div>}
            {oido && (
              <div className={oido.error ? 'aviso' : 'exito'} style={{ margin: '.4rem 0 0', padding: '.4rem .6rem', fontSize: '.88rem' }} role="status">
                {oido.error ? oido.error : <>✔ {oido.d!.nombre} → {oido.d!.valor} {oido.d!.campo === 'cerradas' ? 'cerradas' : oido.d!.campo === 'peso' ? 'g (peso)' : ''}</>}
                {oido.texto && <span className="suave"> · oí «{oido.texto}»</span>}
                {oido.d && <button type="button" className="secundario mini" onClick={deshacerDictado} style={{ marginLeft: '.5rem' }}>Deshacer</button>}
              </div>
            )}
            <div style={{ height: 6, background: 'var(--borde)', borderRadius: 99, overflow: 'hidden', marginTop: '.5rem' }} aria-hidden>
              <div style={{ width: `${Math.round((contados.length / lista.length) * 100)}%`, height: '100%', background: 'var(--ok)' }} />
            </div>
            <div className="suave" style={{ fontSize: '.85rem', marginTop: '.2rem' }}>{contados.length} de {lista.length} contados</div>
          </div>

          <ul className="lista">
            {visibles.map((p) => {
              const c = capturas[p.producto_id];
              const t = total(p, c);
              return (
                <li key={p.producto_id} style={p.producto_id in recontar ? { borderColor: 'var(--error)', borderWidth: 2 } : cuenta(c) ? { borderColor: 'var(--ok)' } : undefined}>
                  <div className="linea" style={{ alignItems: 'flex-start' }}>
                    <div>
                      <strong>{p.generico}</strong>{p.marca && ` · ${p.marca}`}
                      <div className="suave" style={{ fontSize: '.85rem' }}>
                        {p.presentacion}{p.estado === 'PROVISIONAL' && ' · provisional'}
                        {!inicial && p.clase_abc && <> · clase {p.clase_abc}</>}
                        {!inicial && (p.ultimo_conteo ? <> · contado el {new Date(p.ultimo_conteo + 'T12:00:00').toLocaleDateString('es-CO')}</> : p.tiene_kardex && <> · sin contar aquí</>)}
                      </div>
                      {p.producto_id in recontar && <div style={{ color: 'var(--error)', fontSize: '.85rem', fontWeight: 600 }}>Recuéntalo</div>}
                      {!inicial && p.toca && !(p.producto_id in recontar) && <span className="etiqueta provisional" style={{ fontSize: '.75rem' }}>toca hoy</span>}
                    </div>
                    <button type="button" className="secundario chico"
                            onClick={() => setCapturas((x) => ({ ...x, [p.producto_id]: { cerradas: '', suelto: '0', peso: '' } }))}>
                      No hay
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${1 + (porCerradas(p) ? 1 : 0) + (p.tiene_tara ? 1 : 0)}, minmax(0, 1fr))`, gap: '.5rem', marginTop: '.5rem' }}>
                    {porCerradas(p) && (
                      <label style={{ margin: 0, fontWeight: 400, fontSize: '.85rem' }}>
                        Cerradas ({p.unidad_compra.toLowerCase()} de {fmtCantidad(p.contenido_base!)} {p.unidad_base})
                        <input inputMode="decimal" value={c?.cerradas ?? ''} onChange={(e) => poner(p.producto_id, 'cerradas', e.target.value)} />
                      </label>
                    )}
                    <label style={{ margin: 0, fontWeight: 400, fontSize: '.85rem' }}>
                      {porCerradas(p) ? `Abierto / suelto (${p.unidad_base})` : `Cantidad (${p.unidad_base})`}
                      <input inputMode="decimal" value={c?.suelto ?? ''} onChange={(e) => poner(p.producto_id, 'suelto', e.target.value)} />
                    </label>
                    {p.tiene_tara && (
                      <label style={{ margin: 0, fontWeight: 400, fontSize: '.85rem' }}>
                        Botella abierta: peso (g)
                        <input inputMode="decimal" value={c?.peso ?? ''} onChange={(e) => poner(p.producto_id, 'peso', e.target.value)} />
                      </label>
                    )}
                  </div>
                  {t !== null && (
                    <div className="suave" style={{ fontSize: '.82rem', marginTop: '.3rem' }}>
                      = {fmtCantidad(t)} {p.unidad_base}{num(c?.peso ?? '') !== null && ' + la botella pesada'}
                    </div>
                  )}
                </li>
              );
            })}
            {!visibles.length && <li className="suave">Nada coincide con el filtro.</li>}
          </ul>

          <label htmlFor="obs">Observaciones <span className="ayuda">opcional</span></label>
          <textarea id="obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />

          {resultado && !resultado.ok && resultado.fatales.some((m) => !m.startsWith('F10')) && (
            <div className="error" role="alert">
              <strong>No se guardó:</strong>
              <ul>{[...resultado.fatales.filter((m) => !m.startsWith('F10')), ...resultado.bloqueos, ...resultado.avisos].map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}
          <div className="acciones barra-guardar">
            <button type="button" onClick={guardar} disabled={enviando || !contados.length}>
              {enviando ? 'Guardando…' : `Guardar conteo (${contados.length})`}
            </button>
            {contados.length > 0 && (
              <button type="button" className="secundario" disabled={enviando}
                      onClick={async () => { if (await confirmar('¿Borrar todo lo que has contado en esta zona?', { aceptar: 'Borrar', peligro: true })) setCapturas({}); }}>
                Empezar de nuevo
              </button>
            )}
          </div>
          <p className="suave" style={{ fontSize: '.82rem' }}>Lo que vas contando se guarda en este equipo hasta que guardes el conteo, aunque cierres la página.</p>
        </>
      )}
    </>
  );
}
