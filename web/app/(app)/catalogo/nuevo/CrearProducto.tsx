'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { supabaseNavegador } from '@/lib/supabase/navegador';
import { ENVASES, UMBRAL_BLOQUEO, UNIDADES_CONTENIDO, fmtCantidad, type Parecido, type Resultado } from '@/lib/catalogo';
import type { Area } from '@/lib/roles';
import { crearProducto } from '../acciones';

type Categoria = { codigo: string; nombre: string; area: Area };
type Ub = 'g' | 'ml' | 'und';
type GenericoElegido = { id: string; nombre: string; ub: Ub } | null;

export default function CrearProducto({ areas, categorias }: { areas: Area[]; categorias: Categoria[] }) {
  const [area, setArea] = useState<Area>(areas[0]);
  const [busqueda, setBusqueda] = useState('');
  const [parecidos, setParecidos] = useState<Parecido[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [generico, setGenerico] = useState<GenericoElegido>(null);

  // genérico nuevo
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<'MPe' | 'MPI'>('MPe');
  const [ubNueva, setUbNueva] = useState<Ub>('g');
  const [categoria, setCategoria] = useState('');
  // producto
  const [marca, setMarca] = useState('');
  const [envase, setEnvase] = useState<string>('Botella');
  const [contenido, setContenido] = useState('');
  const [unidadContenido, setUnidadContenido] = useState('g');
  const [variable, setVariable] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [enviando, iniciar] = useTransition();

  const ub: Ub = generico?.ub ?? ubNueva;
  const granel = envase === 'Granel';
  const unidades = UNIDADES_CONTENIDO[ub];
  const factor = unidades.find((x) => x.u === unidadContenido)?.f ?? 1;
  const contenidoBase = granel ? 1 : ub === 'und' && envase === 'Unidad' ? 1 : Number(contenido.replace(',', '.')) * factor;
  const unidadCompra = granel ? { g: 'GR', ml: 'ML', und: 'UND' }[ub] : ENVASES.find((e) => e.etiqueta === envase)!.unidad;
  const presentacion = granel ? 'Granel'
    : variable || !(contenidoBase > 0) || (ub === 'und' && contenidoBase === 1) ? envase
    : `${envase} ${fmtCantidad(contenidoBase)} ${ub}`;

  useEffect(() => { setUnidadContenido(UNIDADES_CONTENIDO[ub][0].u); }, [ub]);
  useEffect(() => { setGenerico(null); setResultado(null); }, [area]);

  // búsqueda de parecidos mientras escribe (RLS: solo ve el catálogo si su perfil está activo)
  useEffect(() => {
    const q = busqueda.trim();
    if (q.length < 3) { setParecidos([]); return; }
    let vigente = true;
    setBuscando(true);
    const t = setTimeout(async () => {
      const { data } = await supabaseNavegador().rpc('buscar_productos', { p_texto: q, p_area: area, p_limite: 8 });
      if (vigente) { setParecidos((data as Parecido[]) ?? []); setBuscando(false); }
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [busqueda, area]);

  // genéricos distintos entre los parecidos: «es otra presentación de…»
  const genericosParecidos = useMemo(() => {
    const m = new Map<string, Parecido>();
    for (const p of parecidos) if (!m.has(p.generico_id)) m.set(p.generico_id, p);
    return [...m.values()];
  }, [parecidos]);
  const fuertes = parecidos.filter((p) => p.parecido >= UMBRAL_BLOQUEO);

  function elegirGenerico(p: Parecido | null) {
    setResultado(null);
    if (!p) { setGenerico(null); setNombre(busqueda.trim()); return; }
    // la unidad base viene del catálogo; se pide con el producto para no adivinarla
    supabaseNavegador().from('genericos').select('unidad_base').eq('id', p.generico_id).single()
      .then(({ data }: { data: { unidad_base: string } | null }) => setGenerico({ id: p.generico_id, nombre: p.generico, ub: (data?.unidad_base as Ub) ?? 'g' }));
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const datos: Record<string, unknown> = {
      area, marca: marca.trim(), presentacion, unidad_compra: unidadCompra,
      contenido_base: variable ? null : contenidoBase, contenido_variable: variable,
      motivo_forzado: motivo.trim() || null,
    };
    if (generico) datos.generico_id = generico.id;
    else datos.generico = { nombre: nombre.trim() || busqueda.trim(), tipo, unidad_base: ubNueva, categoria: categoria || null };
    iniciar(async () => setResultado(await crearProducto(datos)));
  }

  if (resultado?.ok) {
    return (
      <div className="tarjeta">
        <p className="exito" role="status"><strong>Creado: {resultado.codigo}</strong></p>
        <p>Queda <span className="etiqueta provisional">PROVISIONAL</span>: ya se puede recibir y contar, pero el jefe del área debe validarlo.</p>
        <div className="acciones">
          <button type="button" onClick={() => { setResultado(null); setBusqueda(''); setMarca(''); setContenido(''); setMotivo(''); setGenerico(null); }}>Crear otro</button>
          <Link className="boton secundario" href="/catalogo">Ir al catálogo</Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={enviar}>
      {areas.length > 1 && (
        <div className="segmentos" role="radiogroup" aria-label="Área">
          {areas.map((a) => (
            <label key={a}><input type="radio" name="area" checked={area === a} onChange={() => setArea(a)} /><span>{a === 'BAR' ? 'Bar' : 'Cocina'}</span></label>
          ))}
        </div>
      )}

      <label htmlFor="busqueda">¿Qué producto es? <span className="ayuda">Escribe como aparece en la factura: «Azúcar Manuelita 2500», «Ginebra Hendricks»</span></label>
      <input id="busqueda" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} autoComplete="off" autoFocus />

      {busqueda.trim().length >= 3 && (
        <section aria-live="polite" style={{ marginTop: '.75rem' }}>
          {buscando && !parecidos.length ? <p className="suave">Buscando parecidos…</p>
            : !parecidos.length ? <p className="suave">No hay nada parecido en {area === 'BAR' ? 'bar' : 'cocina'}: es un genérico nuevo.</p>
            : (
              <>
                {fuertes.length > 0 && <p className="aviso">Hay {fuertes.length} producto(s) muy parecido(s). Si es uno de estos, <strong>no lo crees</strong>: úsalo con su código.</p>}
                <ul className="lista">
                  {parecidos.map((p) => (
                    <li key={p.producto_id}>
                      <div className="linea">
                        <div>
                          <strong>{p.generico}</strong>{p.marca && ` · ${p.marca}`}{p.presentacion && ` · ${p.presentacion}`}
                          <div className="cod">
                            {p.codigo} · <span className={`etiqueta ${p.activo ? p.estado.toLowerCase() : 'inactivo'}`}>{p.activo ? p.estado : 'INACTIVO'}</span>
                            {p.coincide_con && p.coincide_con !== `${p.generico}${p.marca ? ' ' + p.marca : ''}` && <> · por «{p.coincide_con}»</>}
                          </div>
                        </div>
                        <span className="pct" title="Parecido">{Math.round(p.parecido * 100)} %</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
        </section>
      )}

      {busqueda.trim().length >= 3 && (
        <>
          <h2>No está: crear</h2>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="suave" style={{ marginBottom: '.4rem' }}>¿Es otra marca o presentación de un genérico que ya existe?</legend>
            <div className="segmentos">
              {genericosParecidos.map((p) => (
                <label key={p.generico_id}>
                  <input type="radio" name="gen" checked={generico?.id === p.generico_id} onChange={() => elegirGenerico(p)} />
                  <span>{p.generico}</span>
                </label>
              ))}
              <label><input type="radio" name="gen" checked={!generico} onChange={() => elegirGenerico(null)} /><span>Genérico nuevo</span></label>
            </div>
          </fieldset>

          {!generico && (
            <div className="tarjeta" style={{ marginTop: '1rem' }}>
              <label htmlFor="nombre">Nombre genérico <span className="ayuda">sin marca ni tamaño: «Azúcar morena», «Ginebra»</span></label>
              <input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={busqueda} />
              <div className="fila">
                <div>
                  <label htmlFor="tipo">Tipo</label>
                  <select id="tipo" value={tipo} onChange={(e) => setTipo(e.target.value as 'MPe' | 'MPI')}>
                    <option value="MPe">Se compra (MPe)</option>
                    <option value="MPI">Se produce aquí (MPI)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="ub">Unidad base <span className="ayuda">en qué se cuenta y costea</span></label>
                  <select id="ub" value={ubNueva} onChange={(e) => setUbNueva(e.target.value as Ub)}>
                    <option value="g">gramos (g)</option>
                    <option value="ml">mililitros (ml)</option>
                    <option value="und">unidades (und)</option>
                  </select>
                </div>
              </div>
              <label htmlFor="categoria">Categoría</label>
              <select id="categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                <option value="">— la asigna el jefe al validar —</option>
                {categorias.filter((c) => c.area === area).map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
              </select>
            </div>
          )}

          <div className="tarjeta" style={{ marginTop: '1rem' }}>
            <label htmlFor="marca">Marca <span className="ayuda">vacío si no tiene (fruver, granel)</span></label>
            <input id="marca" value={marca} onChange={(e) => setMarca(e.target.value)} />
            <div className="fila">
              <div>
                <label htmlFor="envase">Se compra en</label>
                <select id="envase" value={envase} onChange={(e) => setEnvase(e.target.value)}>
                  {ENVASES.map((x) => <option key={x.etiqueta} value={x.etiqueta}>{x.etiqueta}</option>)}
                </select>
              </div>
              {!granel && !(ub === 'und' && envase === 'Unidad') && (
                <div>
                  <label htmlFor="contenido">Cada {envase.toLowerCase()} trae <span className="ayuda">factor de compra</span></label>
                  <div style={{ display: 'flex', gap: '.4rem' }}>
                    <input id="contenido" inputMode="decimal" value={contenido} onChange={(e) => setContenido(e.target.value)}
                           disabled={variable} required={!variable} style={{ flex: 1 }} />
                    <select aria-label="Unidad del contenido" value={unidadContenido} onChange={(e) => setUnidadContenido(e.target.value)} disabled={variable} style={{ width: '5.5rem' }}>
                      {unidades.map((x) => <option key={x.u} value={x.u}>{x.u}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>
            {!granel && (
              <label style={{ fontWeight: 400, display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                <input type="checkbox" checked={variable} onChange={(e) => setVariable(e.target.checked)} style={{ width: 22, minHeight: 22 }} />
                El contenido cambia en cada compra (se pesa al recibir)
              </label>
            )}
            <p className="suave" style={{ marginBottom: 0 }}>
              Quedará: <strong>{generico?.nombre || nombre || busqueda}</strong>{marca && ` · ${marca}`} · {presentacion}
              {' '}— unidad de compra <span className="cod">{unidadCompra}</span>
              {!variable && contenidoBase > 0 && <> = {fmtCantidad(contenidoBase)} {ub}</>}
            </p>
          </div>

          {resultado && !resultado.ok && (
            <div className={resultado.fatales.length ? 'error' : 'aviso'} role="alert">
              <strong>{resultado.fatales.length ? 'No se puede crear:' : 'Antes de crear, revisa:'}</strong>
              <ul>{[...resultado.fatales, ...resultado.bloqueos, ...resultado.avisos].map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}
          {(resultado?.bloqueos.length ?? 0) > 0 && !resultado?.fatales.length && (
            <>
              <label htmlFor="motivo">¿Por qué es un producto distinto? <span className="ayuda">mínimo 15 caracteres; queda en la bitácora</span></label>
              <textarea id="motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </>
          )}

          <div className="acciones">
            <button type="submit" disabled={enviando}>{enviando ? 'Guardando…' : 'Crear como provisional'}</button>
          </div>
        </>
      )}
    </form>
  );
}
