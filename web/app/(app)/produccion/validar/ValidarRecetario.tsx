'use client';
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import VistaFiltrable, { type Columna, type Grupo } from '@/components/VistaFiltrable';
import { crearMpi, decidirIngredientes, elegirReceta, marcarMpi } from './acciones';

export type Resumen = {
  puede_editar: boolean;
  ingredientes: { total: number; confirmados: number; nuevos: number; excluidos: number; pendientes: number; exactos: number };
  mpi: { total: number; con_ficha: number; aprobadas: number; receta_elegida: number; sin_receta: number; no_es_mpi: number };
  recetas: { subrecetas: number; aprobadas: number; sin_mpi: number };
};
type Ing = {
  codigo: string; nombre: string; categoria: string | null; presentacion: string | null; unidad: string | null; area: string | null; estado: string;
  propuesto_id: string | null; propuesto: string | null; propuesto_tipo: string | null; propuesto_ub: string | null; similitud: number | null;
  generico_id: string | null; generico: string | null; generico_ub: string | null; usos: number; usos_subrecetas: number;
};
type Candidata = { codigo: string; nombre: string; similitud: number; rendimiento: number | null; unidad: string | null };
type Mpi = {
  generico_id: string; codigo: string; nombre: string; unidad_base: string; estado_catalogo: string; ficha_id: string | null; ficha_origen: string | null;
  revision: 'SIN_RECETA' | 'NO_ES_MPI' | null; nota: string | null;
  receta: { codigo: string; nombre: string; estado: string; rendimiento: number | null; unidad: string | null } | null; candidatas: Candidata[];
};
type Receta = {
  codigo: string; nombre: string; rendimiento: number | null; unidad: string | null; estado: string; generico_id: string | null; mpi: string | null;
  propuesto_id: string | null; similitud: number | null; propuesto: string | null; componentes: number; pasos: number;
};
type Gen = { id: string; nombre: string; tipo: string; unidad_base: string };
export type Datos = { mpis: Mpi[]; recetas: Receta[]; ingredientes: Ing[]; genericos: Gen[] };

const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const parecido = (s: number | null) => (s === null ? 'Sin propuesta' : s >= 0.99 ? 'Igual' : s >= 0.6 ? 'Muy parecido' : 'Dudoso');
const pillSim = (s: number | null) => s === null ? null
  : <span className={`pill ${s >= 0.99 ? 'ok' : s >= 0.6 ? 'info' : 'aviso'}`} title="Parecido del nombre">{Math.round(s * 100)} %</span>;
const rinde = (r: { rendimiento: number | null; unidad: string | null }) =>
  r.rendimiento ? `rinde ${Number(r.rendimiento).toLocaleString('es-CO')} ${r.unidad ?? ''}` : '';

// Buscar un genérico del catálogo por nombre (para cambiar la propuesta)
function Buscador({ opciones, alElegir, placeholder }: { opciones: { id: string; nombre: string; extra?: string }[]; alElegir: (id: string) => void; placeholder: string }) {
  const [q, setQ] = useState('');
  const lista = useMemo(() => {
    const t = sinTildes(q.trim());
    if (t.length < 2) return [];
    const ps = t.split(/\s+/);
    return opciones.filter((o) => ps.every((p) => sinTildes(o.nombre).includes(p))).slice(0, 8);
  }, [q, opciones]);
  return (
    <div style={{ minWidth: 220 }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} autoFocus aria-label={placeholder} />
      {lista.length > 0 && (
        <ul className="lista" style={{ marginTop: '.3rem', gap: '.25rem' }}>
          {lista.map((o) => (
            <li key={o.id} style={{ padding: 0 }}>
              <button type="button" className="secundario" style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', border: 0, color: 'inherit' }}
                      onClick={() => { alElegir(o.id); setQ(''); }}>
                <strong>{o.nombre}</strong>{o.extra && <span className="suave">&nbsp;· {o.extra}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ValidarRecetario({ tab, datos, puedeEditar, exactos }: { tab: 'ingredientes' | 'mpi' | 'recetas'; datos: Datos; puedeEditar: boolean; exactos: number }) {
  const router = useRouter();
  const [enviando, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);   // fila con el buscador o el formulario abierto
  const [motivo, setMotivo] = useState('');
  const [bloqueo, setBloqueo] = useState<{ codigo: string; mensajes: string[] } | null>(null);

  const correr = (f: () => Promise<{ ok: boolean; error?: string }>, despues?: () => void) => {
    setError(null);
    iniciar(async () => {
      const r = await f();
      if (!r.ok) { setError(r.error ?? 'No se pudo guardar.'); return; }
      setAbierto(null);
      despues?.();
      router.refresh();
    });
  };
  const gens = useMemo(() => datos.genericos.map((g) => ({ id: g.id, nombre: g.nombre, extra: `${g.tipo === 'SIN_COSTO' ? 'sin costo' : g.tipo} · ${g.unidad_base}` })), [datos.genericos]);
  const mpisLibres = useMemo(() => datos.mpis.filter((m) => !m.ficha_id || m.ficha_origen !== 'RECETARIO COCINA')
    .map((m) => ({ id: m.generico_id, nombre: m.nombre, extra: m.receta ? `ya tiene ${m.receta.codigo}` : m.codigo })), [datos.mpis]);

  const aviso = error && <div className="error" role="alert">{error}</div>;

  // ---------------------------------------------------------------- 1. ingredientes
  if (tab === 'ingredientes') {
    const grupos: Grupo<Ing>[] = [
      { clave: 'estado', titulo: 'Estado', valor: (f) => f.estado,
        opciones: [{ v: 'PENDIENTE', t: 'Por decidir' }, { v: 'CONFIRMADO', t: 'Confirmado' }, { v: 'NUEVO', t: 'Nuevo (crear en catálogo)' }, { v: 'EXCLUIDO', t: 'Excluido' }] },
      { clave: 'parecido', titulo: 'Propuesta', valor: (f) => parecido(f.similitud), opciones: ['Igual', 'Muy parecido', 'Dudoso', 'Sin propuesta'].map((v) => ({ v, t: v })) },
      { clave: 'uso', titulo: 'Uso', unico: true, valor: (f) => (f.usos_subrecetas > 0 ? 'mpi' : 'platos'),
        opciones: [{ v: 'mpi', t: 'Lo usa alguna MPI' }, { v: 'platos', t: 'Solo platos' }] },
    ];
    const columnas: Columna<Ing>[] = [
      { k: 'nombre', t: 'En el recetario', orden: (f) => f.nombre, ver: (f) => <>
        <strong style={{ display: 'block' }}>{f.nombre}</strong>
        <span className="cod">{f.codigo}{f.presentacion ? ` · ${f.presentacion}` : ''}{f.unidad ? ` · en ${f.unidad}` : ''}</span></> },
      { k: 'usos', t: 'Recetas', der: true, orden: (f) => f.usos, ver: (f) => <span title={`${f.usos_subrecetas} MPI`}>{f.usos}</span> },
      { k: 'propuesta', t: 'En el catálogo', orden: (f) => f.similitud, ver: (f) => f.estado === 'CONFIRMADO'
          ? <><strong>{f.generico}</strong> <span className="suave">· {f.generico_ub}</span></>
          : f.propuesto ? <>{f.propuesto} <span className="suave">· {f.propuesto_ub}</span> {pillSim(f.similitud)}</> : <span className="suave">sin propuesta</span> },
      { k: 'estado', t: 'Estado', orden: (f) => f.estado, ver: (f) => (
        <span className={`pill ${f.estado === 'CONFIRMADO' ? 'ok' : f.estado === 'PENDIENTE' ? 'aviso' : 'gris'}`}>
          {f.estado === 'PENDIENTE' ? 'Por decidir' : f.estado === 'CONFIRMADO' ? 'Confirmado' : f.estado === 'NUEVO' ? 'Nuevo' : 'Excluido'}</span>) },
      ...(puedeEditar ? [{ k: 'acc', t: '', ver: (f: Ing) => abierto === f.codigo
        ? <div style={{ display: 'flex', gap: '.3rem', alignItems: 'flex-start' }}>
            <Buscador opciones={gens} placeholder="Buscar en el catálogo…" alElegir={(id) => correr(() => decidirIngredientes([f.codigo], 'CONFIRMAR', id))} />
            <button type="button" className="secundario mini" onClick={() => setAbierto(null)}>×</button>
          </div>
        : <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {f.estado === 'PENDIENTE' && f.propuesto_id && <button type="button" className="mini" disabled={enviando} onClick={() => correr(() => decidirIngredientes([f.codigo], 'CONFIRMAR'))}>Es este</button>}
            <button type="button" className="secundario mini" disabled={enviando} onClick={() => setAbierto(f.codigo)}>{f.estado === 'CONFIRMADO' ? 'Cambiar' : 'Otro'}</button>
            {f.estado === 'PENDIENTE' && <>
              <button type="button" className="secundario mini" disabled={enviando} onClick={() => correr(() => decidirIngredientes([f.codigo], 'NUEVO'))} title="No está en el catálogo: hay que crearlo">Nuevo</button>
              <button type="button" className="discreto mini" disabled={enviando} onClick={() => correr(() => decidirIngredientes([f.codigo], 'EXCLUIR'))}>Excluir</button>
            </>}
            {f.estado !== 'PENDIENTE' && <button type="button" className="discreto mini" disabled={enviando} onClick={() => correr(() => decidirIngredientes([f.codigo], 'PENDIENTE'))}>Reabrir</button>}
          </div> }] : []),
    ];
    return (
      <>
        {aviso}
        {puedeEditar && exactos > 0 && (
          <div className="aviso" style={{ display: 'flex', gap: '.6rem', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span><strong>{exactos} ingredientes</strong> tienen el mismo nombre en el catálogo.</span>
            <button type="button" disabled={enviando} onClick={() => correr(() => decidirIngredientes(
              datos.ingredientes.filter((i) => i.estado === 'PENDIENTE' && (i.similitud ?? 0) >= 0.99).map((i) => i.codigo), 'CONFIRMAR'))}>
              Confirmar los {exactos} iguales</button>
          </div>
        )}
        <VistaFiltrable clave="validar-ingredientes" filas={datos.ingredientes} id={(f) => f.codigo}
                        buscar={(f) => `${f.codigo} ${f.nombre} ${f.propuesto ?? ''} ${f.generico ?? ''}`}
                        grupos={grupos} columnas={columnas} filtrosIniciales={{ estado: ['PENDIENTE'] }}
                        seleccionable={puedeEditar ? (f) => f.estado === 'PENDIENTE' && !!f.propuesto_id : undefined}
                        acciones={(sel, limpiar) => <button type="button" disabled={enviando}
                          onClick={() => correr(() => decidirIngredientes(sel.map((f) => f.codigo), 'CONFIRMAR'), limpiar)}>Confirmar la propuesta de {sel.length}</button>}
                        vacio="No hay ingredientes con estos filtros." />
      </>
    );
  }

  // ---------------------------------------------------------------- 2. MPI
  if (tab === 'mpi') {
    const estado = (m: Mpi) => m.ficha_id ? 'CON_FICHA' : m.receta ? 'POR_APROBAR' : m.revision ?? (m.candidatas.length ? 'CON_CANDIDATA' : 'SIN_CANDIDATA');
    const ESTADOS: Record<string, { t: string; c: string }> = {
      CON_FICHA: { t: 'Con ficha', c: 'ok' }, POR_APROBAR: { t: 'Receta elegida', c: 'info' }, CON_CANDIDATA: { t: 'Por revisar', c: 'aviso' },
      SIN_CANDIDATA: { t: 'Sin receta parecida', c: 'aviso' }, SIN_RECETA: { t: 'Sin receta', c: 'gris' }, NO_ES_MPI: { t: 'No es MPI', c: 'gris' },
    };
    const grupos: Grupo<Mpi>[] = [
      { clave: 'estado', titulo: 'Estado', valor: estado, opciones: Object.entries(ESTADOS).map(([v, x]) => ({ v, t: x.t })) },
    ];
    const columnas: Columna<Mpi>[] = [
      { k: 'nombre', t: 'MPI', orden: (m) => m.nombre, ver: (m) => <>
        <Link href={`/fichas/${m.generico_id}`} style={{ textDecoration: 'none' }}><strong style={{ display: 'block' }}>{m.nombre}</strong></Link>
        <span className="cod">{m.codigo} · {m.unidad_base}{m.estado_catalogo === 'PROVISIONAL' ? ' · provisional' : ''}</span></> },
      { k: 'estado', t: 'Estado', orden: estado, ver: (m) => <>
        <span className={`pill ${ESTADOS[estado(m)].c}`}>{ESTADOS[estado(m)].t}</span>
        {m.nota && <span className="suave" style={{ display: 'block', fontSize: '.78rem' }}>{m.nota}</span>}</> },
      { k: 'receta', t: 'Receta del recetario', ver: (m) => {
        if (m.ficha_id) return <span className="suave">{m.ficha_origen === 'RECETARIO COCINA' ? 'Aprobada del recetario' : `Ficha de ${m.ficha_origen}`}</span>;
        if (m.receta) return <><strong>{m.receta.nombre}</strong> <span className="cod">{m.receta.codigo}</span><span className="suave" style={{ display: 'block', fontSize: '.8rem' }}>{rinde(m.receta)}</span></>;
        if (!m.candidatas.length) return <span className="suave">—</span>;
        const c = m.candidatas[0];
        return <>{c.nombre} <span className="cod">{c.codigo}</span> {pillSim(c.similitud)}
          {m.candidatas.length > 1 && <span className="suave" style={{ display: 'block', fontSize: '.78rem' }}>
            o {m.candidatas.slice(1).map((x) => `${x.nombre} (${Math.round(x.similitud * 100)} %)`).join(', ')}</span>}</>;
      } },
      ...(puedeEditar ? [{ k: 'acc', t: '', ver: (m: Mpi) => {
        if (m.ficha_id && m.ficha_origen === 'RECETARIO COCINA') return null;
        if (m.receta) return <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Link className="boton mini" href={`/produccion/validar/receta/${m.receta.codigo}`}>Revisar y aprobar</Link>
          <button type="button" className="discreto mini" disabled={enviando} onClick={() => correr(() => elegirReceta(m.receta!.codigo, null))}>No es esta</button>
        </div>;
        if (abierto === m.generico_id) return <div style={{ display: 'flex', gap: '.3rem', alignItems: 'flex-start' }}>
          <Buscador placeholder="Buscar receta…" alElegir={(cod) => correr(() => elegirReceta(cod, m.generico_id))}
                    opciones={datos.recetas.filter((r) => r.estado === 'PENDIENTE' && !r.generico_id).map((r) => ({ id: r.codigo, nombre: r.nombre, extra: `${r.codigo} · ${rinde(r)}` }))} />
          <button type="button" className="secundario mini" onClick={() => setAbierto(null)}>×</button>
        </div>;
        return <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {m.candidatas[0] && !m.revision && <button type="button" className="mini" disabled={enviando}
            onClick={() => correr(() => elegirReceta(m.candidatas[0].codigo, m.generico_id), () => router.push(`/produccion/validar/receta/${m.candidatas[0].codigo}`))}>Es esta</button>}
          <button type="button" className="secundario mini" disabled={enviando} onClick={() => setAbierto(m.generico_id)}>Otra receta</button>
          {m.revision
            ? <button type="button" className="discreto mini" disabled={enviando} onClick={() => correr(() => marcarMpi(m.generico_id, null))}>Quitar marca</button>
            : <>
                <button type="button" className="secundario mini" disabled={enviando} onClick={() => correr(() => marcarMpi(m.generico_id, 'SIN_RECETA'))} title="Existe pero el recetario no la trae: la ficha se escribe después">Sin receta</button>
                <button type="button" className="discreto mini" disabled={enviando} onClick={() => correr(() => marcarMpi(m.generico_id, 'NO_ES_MPI'))} title="Porción de plato, duplicado u obsoleto: queda propuesta para inactivar">No es MPI</button>
              </>}
        </div>;
      } }] : []),
    ];
    return (
      <>
        {aviso}
        <VistaFiltrable clave="validar-mpi" filas={datos.mpis} id={(m) => m.generico_id}
                        buscar={(m) => `${m.codigo} ${m.nombre} ${m.receta?.nombre ?? ''} ${m.candidatas.map((c) => c.nombre).join(' ')}`}
                        grupos={grupos} columnas={columnas} filtrosIniciales={{ estado: ['POR_APROBAR', 'CON_CANDIDATA', 'SIN_CANDIDATA'] }}
                        vacio="No hay MPI con estos filtros." />
      </>
    );
  }

  // ---------------------------------------------------------------- 3. recetas
  const estadoR = (r: Receta) => (r.estado === 'APROBADA' ? 'APROBADA' : r.generico_id ? 'CON_MPI' : 'SIN_MPI');
  const ESTR: Record<string, { t: string; c: string }> = { APROBADA: { t: 'Aprobada', c: 'ok' }, CON_MPI: { t: 'Con MPI, por aprobar', c: 'info' }, SIN_MPI: { t: 'Sin MPI', c: 'aviso' } };
  const grupos: Grupo<Receta>[] = [{ clave: 'estado', titulo: 'Estado', valor: estadoR, opciones: Object.entries(ESTR).map(([v, x]) => ({ v, t: x.t })) }];
  const columnas: Columna<Receta>[] = [
    { k: 'nombre', t: 'Receta', orden: (r) => r.nombre, ver: (r) => <>
      <Link href={`/produccion/validar/receta/${r.codigo}`} style={{ textDecoration: 'none' }}><strong style={{ display: 'block' }}>{r.nombre}</strong></Link>
      <span className="cod">{r.codigo} · {r.componentes} ingredientes · {r.pasos} pasos · {rinde(r)}</span></> },
    { k: 'estado', t: 'Estado', orden: estadoR, ver: (r) => <span className={`pill ${ESTR[estadoR(r)].c}`}>{ESTR[estadoR(r)].t}</span> },
    { k: 'mpi', t: 'MPI', ver: (r) => r.mpi ? <strong>{r.mpi}</strong>
        : r.propuesto ? <>{r.propuesto} {pillSim(r.similitud)}</> : <span className="suave">ninguna parecida</span> },
    ...(puedeEditar ? [{ k: 'acc', t: '', ver: (r: Receta) => {
      if (r.estado === 'APROBADA') return null;
      if (r.generico_id) return <Link className="boton mini" href={`/produccion/validar/receta/${r.codigo}`}>Revisar y aprobar</Link>;
      if (abierto === r.codigo) return <div style={{ display: 'grid', gap: '.4rem', minWidth: 240 }}>
        <Buscador placeholder="Buscar MPI…" opciones={mpisLibres} alElegir={(id) => correr(() => elegirReceta(r.codigo, id))} />
        <button type="button" className="secundario mini" onClick={() => setAbierto(null)}>Cancelar</button>
      </div>;
      return <div style={{ display: 'grid', gap: '.3rem', justifyItems: 'end' }}>
        <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {r.propuesto_id && <button type="button" className="mini" disabled={enviando} onClick={() => correr(() => elegirReceta(r.codigo, r.propuesto_id))}>Es esta MPI</button>}
          <button type="button" className="secundario mini" disabled={enviando} onClick={() => setAbierto(r.codigo)}>Otra MPI</button>
          <button type="button" className="secundario mini" disabled={enviando} onClick={() => {
            setError(null); setBloqueo(null);
            iniciar(async () => {
              const x = await crearMpi(r.codigo, bloqueo?.codigo === r.codigo ? motivo : undefined);
              if (x.ok) { setBloqueo(null); setMotivo(''); router.refresh(); return; }
              if (x.bloqueos.length) setBloqueo({ codigo: r.codigo, mensajes: x.bloqueos });
              else setError(x.fatales.join(' '));
            });
          }}>Crear MPI</button>
        </div>
        {bloqueo?.codigo === r.codigo && <div className="aviso" style={{ margin: 0, fontSize: '.85rem', maxWidth: 360 }}>
          {bloqueo.mensajes.map((m) => <div key={m}>{m}</div>)}
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="No es la misma porque…" style={{ marginTop: '.3rem' }} aria-label="Motivo para crearla igual" />
          <span className="suave">Escribe el motivo y toca «Crear MPI» otra vez.</span>
        </div>}
      </div>;
    } }] : []),
  ];
  return (
    <>
      {aviso}
      <VistaFiltrable clave="validar-recetas" filas={datos.recetas} id={(r) => r.codigo} buscar={(r) => `${r.codigo} ${r.nombre} ${r.mpi ?? ''} ${r.propuesto ?? ''}`}
                      grupos={grupos} columnas={columnas} filtrosIniciales={{ estado: ['SIN_MPI', 'CON_MPI'] }} vacio="No hay recetas con estos filtros." />
    </>
  );
}
