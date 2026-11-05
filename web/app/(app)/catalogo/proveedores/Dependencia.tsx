'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { analizarRiesgos, type AnalisisGuardado } from './acciones';

export type DatosDependencia = {
  desde: string; hasta: string; total: number; n_proveedores: number; hhi: number | null;
  proveedores: { id: string; nombre: string; gasto: number; participacion: number; compras: number; insumos: number;
                 insumos_solo_el: number; ultima: string; categorias: string[] }[];
  categorias: { area: string; categoria: string; gasto: number; proveedores: number; mayor: string | null; participacion_mayor: number | null }[];
  un_solo_proveedor: { insumo: string; area: string; categoria: string; proveedor: string; gasto: number; compras: number }[];
};

const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;
// fechas sin hora («2026-11-04»): se leen en UTC para no correrse un día por la zona horaria
const fechaCorta = (s: string) => new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fechaHora = (s: string) => new Date(s).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
const COLOR = { alto: 'var(--error)', medio: 'var(--aviso)', bajo: 'var(--ok)' };
const TIPO: Record<string, string> = { concentracion: 'Dependencia', temporada: 'Temporada', clima: 'Clima', logistica: 'Transporte y vías',
                                       precio: 'Precios', regulatorio: 'Normas e impuestos', calidad: 'Calidad', otro: 'Otro' };
const lecturaHHI = (h: number | null) => (h == null ? '—' : h > 2500 ? 'muy concentrado' : h > 1500 ? 'concentración moderada' : 'diversificado');

export default function Dependencia({ datos, analisis, puedeAnalizar }: { datos: DatosDependencia; analisis: AnalisisGuardado[]; puedeAnalizar: boolean }) {
  const router = useRouter();
  const [lista, setLista] = useState(analisis);
  const [verId, setVerId] = useState<string | null>(analisis[0]?.id ?? null);
  const [analizando, setAnalizando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actual = lista.find((a) => a.id === verId) ?? null;
  const concentradas = datos.categorias.filter((c) => c.proveedores === 1 || (c.participacion_mayor ?? 0) >= 70);

  async function analizar() {
    setAnalizando(true);
    setError(null);
    const r = await analizarRiesgos(12);
    setAnalizando(false);
    if (!r.ok) { setError(r.error); return; }
    setLista((xs) => [r.analisis, ...xs]);
    setVerId(r.analisis.id);
    router.refresh();
  }

  return (
    <div className="pagina-ancha">
      <p className="suave">Compras de los últimos 12 meses ({fechaCorta(datos.desde)} a {fechaCorta(datos.hasta)}): recepciones, fotos de precios y libros anteriores.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.5rem', marginBottom: '.8rem' }}>
        <div className="tarjeta"><div className="suave" style={{ fontSize: '.8rem' }}>Comprado</div><strong style={{ fontSize: '1.2rem' }}>{pesos(datos.total)}</strong></div>
        <div className="tarjeta"><div className="suave" style={{ fontSize: '.8rem' }}>Proveedores</div><strong style={{ fontSize: '1.2rem' }}>{datos.n_proveedores}</strong></div>
        <div className="tarjeta"><div className="suave" style={{ fontSize: '.8rem' }}>Concentración (HHI)</div><strong style={{ fontSize: '1.2rem' }}>{datos.hhi ?? '—'}</strong>
          <div className="suave" style={{ fontSize: '.78rem' }}>{lecturaHHI(datos.hhi)}</div></div>
        <div className="tarjeta"><div className="suave" style={{ fontSize: '.8rem' }}>Insumos con un solo proveedor</div><strong style={{ fontSize: '1.2rem' }}>{datos.un_solo_proveedor.length}{datos.un_solo_proveedor.length >= 40 ? '+' : ''}</strong></div>
      </div>

      {/* ------------------------------------------------ riesgos con IA: cada vez que se pide */}
      <section className="tarjeta" style={{ marginBottom: '.8rem', display: 'grid', gap: '.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Riesgos de abastecimiento</h2>
          {puedeAnalizar && (
            <button type="button" disabled={analizando} onClick={analizar}>
              {analizando ? 'Analizando… (1 a 3 minutos)' : '🔎 Analizar riesgos ahora'}
            </button>
          )}
        </div>
        <span className="suave" style={{ fontSize: '.85rem' }}>
          Cada vez que tocas el botón, la IA busca en la web lo que está pasando hoy (clima, vías, paros, vedas, temporadas, precios)
          y lo cruza con la dependencia de proveedores de arriba. Cada análisis queda guardado con su fecha.
        </span>
        {error && <div className="aviso" role="status">{error}</div>}
        {lista.length > 1 && (
          <label style={{ margin: 0 }}>Análisis
            <select value={verId ?? ''} onChange={(e) => setVerId(e.target.value)}>
              {lista.map((a, i) => <option key={a.id} value={a.id}>{fechaHora(a.creado_en)}{i === 0 ? ' (el más reciente)' : ''}</option>)}
            </select>
          </label>
        )}
        {!actual && !analizando && <p className="suave">Todavía no hay ningún análisis. {puedeAnalizar ? 'Toca «Analizar riesgos ahora».' : ''}</p>}
        {actual && (
          <>
            <p style={{ margin: 0 }}><span className="suave">{actual.resultado.fecha} · </span>{actual.resultado.resumen}</p>
            {actual.resultado.riesgos.map((r, i) => (
              <div key={i} style={{ borderLeft: `4px solid ${COLOR[r.nivel]}`, padding: '.3rem .6rem', display: 'grid', gap: '.2rem' }}>
                <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <strong>{r.titulo}</strong>
                  <span className="etiqueta" style={{ color: COLOR[r.nivel] }}>{r.nivel}</span>
                  <span className="etiqueta">{TIPO[r.tipo] ?? r.tipo}</span>
                  <span className="suave" style={{ fontSize: '.82rem' }}>{r.cuando}</span>
                </div>
                <span style={{ fontSize: '.9rem' }}>{r.por_que}</span>
                {r.afecta.length > 0 && <span className="suave" style={{ fontSize: '.82rem' }}>Afecta: {r.afecta.join(', ')}</span>}
                <span style={{ fontSize: '.9rem' }}><strong>Qué hacer:</strong> {r.que_hacer}</span>
              </div>
            ))}
            {actual.resultado.calendario.length > 0 && (
              <details>
                <summary><strong>Calendario de los próximos meses</strong></summary>
                <ul style={{ margin: '.3rem 0' }}>
                  {actual.resultado.calendario.map((c, i) => <li key={i}><strong>{c.cuando}:</strong> {c.evento} — <span className="suave">{c.efecto}</span></li>)}
                </ul>
              </details>
            )}
            {actual.resultado.fuentes.length > 0 && (
              <details>
                <summary className="suave">Fuentes consultadas ({actual.resultado.fuentes.length})</summary>
                <ul style={{ margin: '.3rem 0', fontSize: '.85rem' }}>
                  {actual.resultado.fuentes.map((f) => <li key={f.url}><a href={f.url} target="_blank" rel="noreferrer">{f.titulo || f.url}</a></li>)}
                </ul>
              </details>
            )}
          </>
        )}
      </section>

      {/* ------------------------------------------------ dependencia (datos de la app) */}
      <section className="tarjeta" style={{ marginBottom: '.8rem' }}>
        <h2 style={{ marginTop: 0 }}>Cuánto pesa cada proveedor</h2>
        {datos.proveedores.map((p) => (
          <div key={p.id} style={{ padding: '.35rem 0', borderTop: '1px solid var(--borde)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
              <strong>{p.nombre}</strong>
              <span>{p.participacion} % · {pesos(p.gasto)}</span>
            </div>
            <div style={{ height: 6, background: 'var(--borde)', borderRadius: 3, margin: '.2rem 0' }}>
              <div style={{ width: `${Math.min(100, p.participacion)}%`, height: '100%', background: p.participacion >= 25 ? 'var(--error)' : 'var(--marca)', borderRadius: 3 }} />
            </div>
            <div className="suave" style={{ fontSize: '.8rem' }}>
              {p.insumos} insumo(s){p.insumos_solo_el ? ` · ${p.insumos_solo_el} solo se los compramos a él` : ''} · {p.compras} compra(s) · última {fechaCorta(p.ultima)}
              {p.categorias?.length ? ` · ${p.categorias.join(', ')}` : ''}
            </div>
          </div>
        ))}
      </section>

      {concentradas.length > 0 && (
        <section className="tarjeta" style={{ marginBottom: '.8rem' }}>
          <h2 style={{ marginTop: 0 }}>Categorías que dependen de un proveedor</h2>
          {concentradas.map((c) => (
            <div key={`${c.area}-${c.categoria}`} style={{ padding: '.3rem 0', borderTop: '1px solid var(--borde)' }}>
              <strong>{c.categoria}</strong> <span className="suave">({c.area === 'BAR' ? 'bar' : 'cocina'})</span>
              {' '}· {c.proveedores === 1 ? <>todo a <strong>{c.mayor}</strong></> : <>{c.participacion_mayor} % a <strong>{c.mayor}</strong> entre {c.proveedores} proveedores</>}
              <span className="suave"> · {pesos(c.gasto)}</span>
            </div>
          ))}
        </section>
      )}

      <section className="tarjeta">
        <h2 style={{ marginTop: 0 }}>Insumos que solo trae un proveedor</h2>
        <p className="suave" style={{ marginTop: 0, fontSize: '.85rem' }}>Los que más se compran primero. Si ese proveedor falla, no hay a quién llamar.</p>
        {datos.un_solo_proveedor.map((u) => (
          <div key={`${u.insumo}-${u.proveedor}`} style={{ padding: '.25rem 0', borderTop: '1px solid var(--borde)', display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
            <span><strong>{u.insumo}</strong> <span className="suave">· {u.categoria}</span></span>
            <span className="suave">{u.proveedor} · {pesos(u.gasto)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
