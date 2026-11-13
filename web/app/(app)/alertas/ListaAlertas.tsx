'use client';
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { accionAlerta, historialAlerta, revisarAlertas, type Evento } from './acciones';
import { pesos, fecha } from '@/lib/formato';

export type Alerta = {
  id: string; regla: string; area: 'BAR' | 'COCINA' | null; titulo: string; detalle: string | null; enlace: string | null;
  impacto: number | null; estado: 'ABIERTA' | 'EN_CURSO' | 'RESUELTA'; responsable_id: string | null; responsable: string | null;
  fecha_compromiso: string | null; causa: string | null; vigente: boolean; detectada_en: string; ultima_deteccion: string;
  periodo_desde: string | null; periodo_hasta: string | null; eventos: number;
};
export type Responsable = { id: string; nombre: string; rol: string };

export const REGLA: Record<string, string> = {
  VARIACION_ROJA: 'Real vs. teórico en rojo', FALTANTE_INSUMO: 'Faltante no explicado', SOBRE_META: 'Sobre la meta de costo',
  SUBIDA_PRECIO: 'Subida de precio', RENDIMIENTO: 'Rendimiento fuera de banda', PERDIDAS_ALTAS: 'Pérdidas sobre el promedio',
  VENTAS_SIN_FICHA: 'Ventas sin ficha', CONTROL_CAMBIADO: 'Control cambiado',
};
const ESTADO = { ABIERTA: 'Abierta', EN_CURSO: 'En curso', RESUELTA: 'Resuelta' } as const;
const COLOR_ESTADO = { ABIERTA: 'var(--error)', EN_CURSO: 'var(--aviso)', RESUELTA: 'var(--ok)' } as const;
const ACCION: Record<string, string> = { CREADA: 'Detectada', ASIGNADA: 'Asignada a', COMENTARIO: 'Comentó', EN_CURSO: 'En curso', RESUELTA: 'Resuelta', REABIERTA: 'Reabierta', ACTUALIZADA: 'Actualizada' };
const ir = (e: string) => (e.startsWith('/fichas') ? 'Ir a la ficha' : e.startsWith('/produccion') ? 'Ir al lote' : e.startsWith('/historial/recepcion') ? 'Ir a la recepción'
  : e.startsWith('/consulta/ventas') ? 'Ir a Cargar ventas' : e.startsWith('/consulta') ? 'Ir al período' : e.startsWith('/catalogo') ? 'Ir al insumo' : 'Abrir');

function Tarjeta({ a, admin, responsables }: { a: Alerta; admin: boolean; responsables: Responsable[] }) {
  const router = useRouter();
  const [panel, setPanel] = useState<'asignar' | 'comentar' | 'resolver' | 'historial' | null>(null);
  const [resp, setResp] = useState(a.responsable_id ?? '');
  const [fechaC, setFechaC] = useState(a.fecha_compromiso ?? '');
  const [texto, setTexto] = useState('');
  const [historial, setHistorial] = useState<Evento[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  const hacer = (p: Parameters<typeof accionAlerta>[0]) => iniciar(async () => {
    const r = await accionAlerta(p);
    if (r.ok) { setPanel(null); setTexto(''); setError(null); setHistorial(null); router.refresh(); } else setError(r.error ?? 'No se pudo guardar.');
  });
  const verHistorial = () => { if (panel === 'historial') { setPanel(null); return; } setPanel('historial'); iniciar(async () => setHistorial(await historialAlerta(a.id))); };
  const abierta = a.estado !== 'RESUELTA';
  const vencida = abierta && a.fecha_compromiso && a.fecha_compromiso < new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

  return (
    <li id={`alerta-${a.id}`} className="tarjeta alerta-item" style={{ display: 'grid', gap: '.45rem', borderLeft: `4px solid ${COLOR_ESTADO[a.estado]}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span className="suave texto-mini">{REGLA[a.regla] ?? a.regla}{a.area && ` · ${a.area === 'BAR' ? 'Bar' : 'Cocina'}`}
          {!a.vigente && abierta && ' · ya no se detecta'}</span>
        <span style={{ display: 'flex', gap: '.5rem', alignItems: 'baseline' }}>
          {admin && a.impacto !== null && <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{pesos(Number(a.impacto))}</strong>}
          <span className="etiqueta" style={{ color: COLOR_ESTADO[a.estado] }}>{ESTADO[a.estado]}</span>
        </span>
      </div>
      <strong>{a.titulo}</strong>
      {a.detalle && <span className="suave texto-nota">{a.detalle}</span>}
      <span className="suave texto-mini">
        {a.responsable ? <>Responsable: <strong style={{ color: 'var(--texto)' }}>{a.responsable}</strong></> : 'Sin responsable'}
        {a.fecha_compromiso && <span style={{ color: vencida ? 'var(--error)' : undefined }}> · para el {fecha(a.fecha_compromiso)}{vencida ? ' (vencida)' : ''}</span>}
        {' '}· detectada el {fecha(a.detectada_en)}
      </span>
      {a.causa && <span className="texto-nota"><strong>Causa:</strong> {a.causa}</span>}
      <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
        {a.enlace && <Link className="boton secundario mini" href={a.enlace}>{ir(a.enlace)}</Link>}
        {admin && abierta && <button type="button" className="secundario mini" onClick={() => setPanel(panel === 'asignar' ? null : 'asignar')}>Asignar</button>}
        <button type="button" className="secundario mini" onClick={() => setPanel(panel === 'comentar' ? null : 'comentar')}>Comentar</button>
        {a.estado === 'ABIERTA' && <button type="button" className="secundario mini" disabled={enviando} onClick={() => hacer({ id: a.id, accion: 'EN_CURSO' })}>En curso</button>}
        {abierta && <button type="button" className="mini" onClick={() => setPanel(panel === 'resolver' ? null : 'resolver')}>Resolver…</button>}
        {admin && !abierta && <button type="button" className="secundario mini" disabled={enviando} onClick={() => hacer({ id: a.id, accion: 'REABRIR' })}>Reabrir</button>}
        <button type="button" className="discreto mini" onClick={verHistorial}>Historial ({a.eventos})</button>
      </div>
      {panel === 'asignar' && (
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ margin: 0, flex: '1 1 180px' }}>Responsable
            <select value={resp} onChange={(e) => setResp(e.target.value)}><option value="">Escoja…</option>
              {responsables.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></label>
          <label className="m-0">Para el<input type="date" value={fechaC} onChange={(e) => setFechaC(e.target.value)} /></label>
          <button type="button" className="mini" disabled={enviando || !resp} onClick={() => hacer({ id: a.id, accion: 'ASIGNAR', responsable_id: resp, fecha: fechaC || null })}>Guardar</button>
        </div>
      )}
      {(panel === 'comentar' || panel === 'resolver') && (
        <div style={{ display: 'grid', gap: '.35rem' }}>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2}
                    placeholder={panel === 'resolver' ? 'Qué causa encontraste y qué se hizo' : 'Comentario'} aria-label={panel === 'resolver' ? 'Causa' : 'Comentario'} />
          <div><button type="button" className="mini" disabled={enviando || !texto.trim()}
                       onClick={() => hacer(panel === 'resolver' ? { id: a.id, accion: 'RESOLVER', causa: texto } : { id: a.id, accion: 'COMENTAR', texto })}>
            {panel === 'resolver' ? 'Marcar resuelta' : 'Guardar comentario'}</button></div>
        </div>
      )}
      {panel === 'historial' && (
        historial ? <ul className="renglones texto-nota">{historial.map((e, i) => (
          <li key={i}><span><strong>{ACCION[e.accion] ?? e.accion}</strong>{e.texto && <> · {e.texto}</>}</span>
            <span className="suave n">{e.usuario ?? 'Sistema'} · {fecha(e.en)}</span></li>))}</ul>
          : <span className="suave">Cargando…</span>
      )}
      {error && <span style={{ color: 'var(--error)', fontSize: '.85rem' }}>{error}</span>}
    </li>
  );
}

export default function ListaAlertas({ alertas, admin, responsables, revisar }: {
  alertas: Alerta[]; admin: boolean; responsables: Responsable[]; revisar: { desde: string; hasta: string } | null;
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<'abiertas' | 'curso' | 'resueltas' | 'todas'>('abiertas');
  const [regla, setRegla] = useState('');
  const [quien, setQuien] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  const vis = useMemo(() => alertas.filter((a) =>
    (estado === 'todas' || (estado === 'abiertas' && a.estado === 'ABIERTA') || (estado === 'curso' && a.estado === 'EN_CURSO') || (estado === 'resueltas' && a.estado === 'RESUELTA'))
    && (!regla || a.regla === regla) && (!quien || (quien === 'nadie' ? !a.responsable_id : a.responsable_id === quien))), [alertas, estado, regla, quien]);
  const total = vis.reduce((t, a) => t + Number(a.impacto ?? 0), 0);
  const cuenta = (e: Alerta['estado']) => alertas.filter((a) => a.estado === e).length;

  return (
    <>
      <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.6rem' }}>
        <nav className="segmentos" style={{ gap: '.35rem' }}>
          {([['abiertas', `Abiertas (${cuenta('ABIERTA')})`], ['curso', `En curso (${cuenta('EN_CURSO')})`], ['resueltas', `Resueltas (${cuenta('RESUELTA')})`], ['todas', 'Todas']] as const).map(([v, t]) => (
            <button key={v} type="button" className="chip-boton" onClick={() => setEstado(v)}
                    style={{ minHeight: 40, padding: '.4rem .8rem', borderRadius: 999, border: '1px solid var(--borde)',
                             background: estado === v ? 'var(--tinta)' : 'var(--tarjeta)', color: estado === v ? 'var(--marca-texto)' : 'var(--texto)' }}>{t}</button>
          ))}
        </nav>
        <select value={regla} onChange={(e) => setRegla(e.target.value)} aria-label="Tipo de alerta" style={{ width: 'auto' }}>
          <option value="">Todos los tipos</option>{Object.entries(REGLA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {admin && (
          <select value={quien} onChange={(e) => setQuien(e.target.value)} aria-label="Responsable" style={{ width: 'auto' }}>
            <option value="">Cualquier responsable</option><option value="nadie">Sin responsable</option>
            {responsables.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        )}
        {admin && revisar && (
          <button type="button" className="secundario ml-auto" disabled={enviando}
                  onClick={() => iniciar(async () => { const r = await revisarAlertas(revisar.desde, revisar.hasta);
                    setMsg(r.ok ? `Revisión hecha: ${r.nuevas} alerta(s) nueva(s).` : r.error ?? 'No se pudo revisar.'); router.refresh(); })}>
            {enviando ? 'Revisando…' : 'Revisar alertas ahora'}</button>
        )}
      </div>
      {msg && <p className="exito mt-0" role="status">{msg}</p>}
      {admin && <p className="suave texto-nota">{vis.length} alerta(s){total > 0 && <> · impacto estimado <strong>{pesos(total)}</strong></>}. Ordenadas por impacto.</p>}
      {vis.length ? (
        <ul className="pila" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{vis.map((a) => <Tarjeta key={a.id} a={a} admin={admin} responsables={responsables} />)}</ul>
      ) : <p className="tarjeta">{admin ? 'No hay alertas con estos filtros.' : 'No tiene alertas asignadas en este estado.'}</p>}
    </>
  );
}
