'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Resultado } from '@/lib/catalogo';
import { guardarFicha } from '../acciones';

type UB = 'g' | 'ml' | 'und';
type Ingrediente = { id: string; nombre: string; tipo: string; unidad_base: UB; unidades: string[] };
export type DatosFicha = {
  resultado: { id: string; codigo: string; nombre: string; tipo: string; unidad_base: UB; area: 'BAR' | 'COCINA' };
  puede_editar: boolean;
  ficha: { id: string; codigo: string; version: number; neto_esperado: number | null; nota: string | null; vigente_desde: string; lotes: number } | null;
  lineas: { generico_id: string; generico: string; tipo: string; unidad_base: UB; cantidad: number | null; unidad: string; nota: string | null;
            factor: number | null; costo: number | null; falta: string | null }[];
  ingredientes: Ingrediente[];
};
// Una línea: lo que la persona escribe va como texto
type Linea = { clave: string; generico_id: string; cantidad: string; unidad: string; nota: string; factor: string };

const EXTRA = ['cda', 'cdta', 'taza', 'gota', 'dash', 'pizca', 'und'];
const num = (s: string) => { const n = Number(s.replace(',', '.')); return s.trim() === '' || !Number.isFinite(n) ? null : n; };
const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const TRAZA = ['dash', 'gota', 'gts'];

// Unidades que ya se convierten a la unidad base del ingrediente, sin pedir nada
function convierte(i: Ingrediente, u: string) {
  return u === i.unidad_base || (u === 'kg' && i.unidad_base === 'g') || (u === 'l' && i.unidad_base === 'ml')
    || (i.unidad_base === 'und' && ['bot', 'lata', 'unidad'].includes(u)) || i.unidades.includes(u)
    || (i.tipo === 'SIN_COSTO' && ['g', 'ml'].includes(u) && i.unidad_base !== 'und');
}

export default function EditorFicha({ datos }: { datos: DatosFicha }) {
  const router = useRouter();
  const porId = useMemo(() => new Map(datos.ingredientes.map((i) => [i.id, i])), [datos.ingredientes]);
  const [codigo, setCodigo] = useState(datos.ficha?.codigo ?? '');
  const [neto, setNeto] = useState(datos.ficha?.neto_esperado != null ? String(datos.ficha.neto_esperado) : '');
  const [nota, setNota] = useState(datos.ficha?.nota ?? '');
  const [lineas, setLineas] = useState<Linea[]>(() => datos.lineas.map((l) => ({
    clave: crypto.randomUUID(), generico_id: l.generico_id, cantidad: l.cantidad === null ? '' : String(l.cantidad),
    unidad: l.unidad, nota: l.nota ?? '', factor: '' })));
  const [buscar, setBuscar] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [enviando, iniciar] = useTransition();
  const lee = !datos.puede_editar;
  const ub = datos.resultado.unidad_base;

  const poner = (k: string, c: Partial<Linea>) => { setLineas((ls) => ls.map((l) => (l.clave === k ? { ...l, ...c } : l))); setResultado(null); };
  const mover = (i: number, d: number) => setLineas((ls) => { const n = [...ls]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  const opciones = useMemo(() => {
    const f = sinTildes(buscar.trim());
    if (f.length < 2) return [];
    const ps = f.split(/\s+/);
    return datos.ingredientes.filter((i) => ps.every((w) => sinTildes(i.nombre).includes(w))).slice(0, 10);
  }, [buscar, datos.ingredientes]);

  const pendientes = lineas.filter((l) => {
    const i = porId.get(l.generico_id);
    return !i || num(l.cantidad) === null || (!convierte(i, l.unidad) && !TRAZA.includes(l.unidad) && !(num(l.factor)! > 0));
  }).length;

  function guardar() {
    setResultado(null);
    iniciar(async () => {
      const r = await guardarFicha({
        generico_id: datos.resultado.id, codigo, neto_esperado: neto, nota,
        lineas: lineas.map((l) => ({ generico_id: l.generico_id, cantidad: l.cantidad, unidad: l.unidad, nota: l.nota,
                                     factor: num(l.factor) })),
      });
      setResultado(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <>
      {lee && <p className="aviso">Solo el jefe del área o administración corrigen fichas. Aquí puedes consultarla.</p>}
      {datos.ficha && Number(datos.ficha.lotes) > 0 && !lee && (
        <p className="suave" style={{ fontSize: '.9rem' }}>Esta versión ya costeó lotes: al guardar se crea una versión nueva y los lotes viejos conservan su receta.</p>
      )}
      <section className="tarjeta">
        <div className="fila">
          <div>
            <label htmlFor="codigo" style={{ marginTop: 0 }}>Código de la ficha</label>
            <input id="codigo" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="#5, C02…" disabled={lee} />
          </div>
          <div>
            <label htmlFor="neto" style={{ marginTop: 0 }}>Rinde (neto esperado, {ub})</label>
            <input id="neto" inputMode="decimal" value={neto} onChange={(e) => setNeto(e.target.value)} disabled={lee} />
          </div>
        </div>
        {datos.resultado.tipo === 'MPI' && <span className="ayuda">Lo que pesa la tanda completa ya terminada. Sin esto no hay costo estándar por {ub} ni comparación de rendimiento al producir.</span>}
        <label htmlFor="nota">Nota <span className="ayuda">procedimiento, observaciones</span></label>
        <textarea id="nota" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} disabled={lee} />
      </section>

      <h2>Ingredientes ({lineas.length})</h2>
      <ul className="lista">
        {lineas.map((l, idx) => {
          const i = porId.get(l.generico_id);
          const original = datos.lineas.find((x) => x.generico_id === l.generico_id);
          const nombre = i?.nombre ?? original?.generico ?? 'Ingrediente inactivo';
          const unidades = i ? [...new Set([i.unidad_base, i.unidad_base === 'g' ? 'kg' : i.unidad_base === 'ml' ? 'l' : '', ...i.unidades, ...EXTRA, l.unidad].filter(Boolean))] : [l.unidad];
          const sinConv = !!i && !convierte(i, l.unidad) && !TRAZA.includes(l.unidad);
          return (
            <li key={l.clave} style={!i || num(l.cantidad) === null || (sinConv && !(num(l.factor)! > 0)) ? { borderColor: 'var(--aviso)', borderWidth: 2 } : undefined}>
              <div className="linea" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <span className="suave" style={{ fontSize: '.8rem' }}>{idx + 1}. </span><strong>{nombre}</strong>
                  {i && <span className="suave" style={{ fontSize: '.82rem' }}> · {i.tipo === 'SIN_COSTO' ? 'sin costo' : i.tipo} · base {i.unidad_base}</span>}
                </div>
                {!lee && (
                  <div style={{ display: 'flex', gap: '.3rem' }}>
                    <button type="button" className="secundario" style={{ minHeight: 34, padding: '.2rem .55rem' }} disabled={idx === 0} onClick={() => mover(idx, -1)} aria-label="Subir">↑</button>
                    <button type="button" className="secundario" style={{ minHeight: 34, padding: '.2rem .55rem' }} disabled={idx === lineas.length - 1} onClick={() => mover(idx, 1)} aria-label="Bajar">↓</button>
                    <button type="button" className="secundario" style={{ minHeight: 34, padding: '.2rem .6rem' }} onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}>Quitar</button>
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 2fr)', gap: '.5rem', marginTop: '.45rem', alignItems: 'end' }}>
                <label style={{ margin: 0, fontWeight: 400, fontSize: '.85rem' }}>Cantidad
                  <input inputMode="decimal" value={l.cantidad} onChange={(e) => poner(l.clave, { cantidad: e.target.value })} disabled={lee} />
                </label>
                <label style={{ margin: 0, fontWeight: 400, fontSize: '.85rem' }}>Unidad
                  <select value={l.unidad} onChange={(e) => poner(l.clave, { unidad: e.target.value, factor: '' })} disabled={lee} style={{ minWidth: 84 }}>
                    {unidades.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </label>
                <label style={{ margin: 0, fontWeight: 400, fontSize: '.85rem' }}>Nota
                  <input value={l.nota} onChange={(e) => poner(l.clave, { nota: e.target.value })} disabled={lee} placeholder="en rodajas, para decorar…" />
                </label>
              </div>
              {sinConv && i && (
                <div className="aviso" style={{ margin: '.5rem 0 0', padding: '.45rem .6rem', fontSize: '.85rem' }}>
                  {nombre} no tiene conversión de {l.unidad} a {i.unidad_base}. Mídela una vez y la ficha podrá costearlo:
                  <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', marginTop: '.35rem' }}>
                    <span style={{ whiteSpace: 'nowrap' }}>1 {l.unidad} =</span>
                    <input inputMode="decimal" value={l.factor} onChange={(e) => poner(l.clave, { factor: e.target.value })} disabled={lee} style={{ maxWidth: 110 }} aria-label={`Equivalencia de ${l.unidad} en ${i.unidad_base}`} />
                    <span>{i.unidad_base}</span>
                  </div>
                </div>
              )}
              {TRAZA.includes(l.unidad) && !(i && convierte(i, l.unidad)) && (
                <div className="suave" style={{ fontSize: '.8rem', marginTop: '.3rem' }}>Traza: sin conversión medida cuenta como $0.</div>
              )}
              {num(l.cantidad) === null && <div style={{ fontSize: '.82rem', color: 'var(--aviso)', marginTop: '.3rem' }}>Sin cantidad: la ficha queda incompleta.</div>}
            </li>
          );
        })}
      </ul>

      {!lee && (
        <>
          <label htmlFor="ing">Agregar ingrediente</label>
          <input id="ing" placeholder="Buscar insumo, MPI o agua…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
          {opciones.length > 0 && (
            <ul className="lista" style={{ marginTop: '.4rem' }}>
              {opciones.map((i) => (
                <li key={i.id} style={{ padding: 0 }}>
                  <button type="button" className="secundario" style={{ width: '100%', textAlign: 'left', border: 0, color: 'inherit' }}
                          onClick={() => { setLineas((ls) => [...ls, { clave: crypto.randomUUID(), generico_id: i.id, cantidad: '', unidad: i.unidad_base, nota: '', factor: '' }]); setBuscar(''); }}>
                    <strong>{i.nombre}</strong> <span className="suave">· {i.tipo === 'SIN_COSTO' ? 'sin costo' : i.tipo} · {i.unidad_base}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {resultado && (
            resultado.ok
              ? <div className="exito" role="status"><strong>Ficha guardada.</strong>{resultado.avisos.length > 0 && <ul>{resultado.avisos.map((m) => <li key={m}>{m}</li>)}</ul>}</div>
              : <div className="error" role="alert"><strong>No se guardó:</strong><ul>{[...resultado.fatales, ...resultado.avisos].map((m) => <li key={m}>{m}</li>)}</ul></div>
          )}
          <div className="acciones" style={{ position: 'sticky', bottom: 0, background: 'var(--fondo)', padding: '.6rem 0 calc(.6rem + env(safe-area-inset-bottom))' }}>
            <button type="button" disabled={enviando || !codigo.trim() || !lineas.length} onClick={guardar}>
              {enviando ? 'Guardando…' : datos.ficha ? 'Guardar cambios' : 'Crear ficha'}
            </button>
            {pendientes > 0 && <span className="suave" style={{ fontSize: '.85rem', alignSelf: 'center' }}>{pendientes} línea(s) por completar: se puede guardar igual.</span>}
          </div>
        </>
      )}
    </>
  );
}
