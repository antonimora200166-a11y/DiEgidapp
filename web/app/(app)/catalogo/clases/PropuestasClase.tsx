'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import VistaFiltrable, { type Agrupar, type Columna, type Grupo } from '@/components/VistaFiltrable';
import { confirmar } from '@/components/Dialogo';
import { NOMBRE_CLASE, type Clase } from '@/lib/clases';
import { decidirClases } from './acciones';

export type PropuestaClase = {
  id: string; generico_id: string; codigo: string; generico: string; area: 'BAR' | 'COCINA'; categoria: string | null;
  clase: Clase; seguridad: 'ALTA' | 'MEDIA' | 'BAJA'; razon: string; estado: 'PENDIENTE' | 'ACEPTADA' | 'CORREGIDA' | 'RECHAZADA';
  aplicada: Clase | null; mensaje: string | null; decidido_por: string | null; decidido_en: string | null; productos: number;
};

const COLOR = { ALTA: 'var(--ok)', MEDIA: 'var(--aviso)', BAJA: 'var(--error)' };
const ESTADO: Record<string, string> = { PENDIENTE: 'Pendiente', ACEPTADA: 'Aplicada', CORREGIDA: 'Aplicada', RECHAZADA: 'Rechazada' };
const OPCIONES: Clase[] = ['DESECHABLE', 'ASEO', 'MENAJE', 'HERRAMIENTA'];

export default function PropuestasClase({ filas, soloLectura }: { filas: PropuestaClase[]; soloLectura: boolean }) {
  const router = useRouter();
  const [enviando, iniciar] = useTransition();
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string; lista?: string[] } | null>(null);
  const pendientes = filas.filter((p) => p.estado === 'PENDIENTE');

  async function decidir(ids: string[], decision: 'ACEPTAR' | 'RECHAZAR', clase: Clase | null = null, limpiar?: () => void) {
    if (!ids.length) return;
    if (ids.length > 1 && !(await confirmar(`¿${decision === 'ACEPTAR' ? 'Aceptar' : 'Rechazar'} ${ids.length} propuesta(s)?`,
      { aceptar: decision === 'ACEPTAR' ? 'Aceptar' : 'Rechazar', peligro: decision === 'RECHAZAR' }))) return;
    setMensaje(null);
    iniciar(async () => {
      const r = await decidirClases(ids, decision, clase);
      if ('error' in r) { setMensaje({ ok: false, texto: r.error }); return; }
      setMensaje({ ok: !r.fallidos, texto: `${r.ok} ${decision === 'ACEPTAR' ? 'aplicada(s)' : 'rechazada(s): siguen como materia prima'}${r.fallidos ? `; ${r.fallidos} no se pudieron:` : '.'}`,
                   lista: r.detalle.filter((d) => !d.ok).map((d) => `${d.nombre}: ${d.mensaje ?? ''}`) });
      limpiar?.();
      router.refresh();
    });
  }

  const grupos: Grupo<PropuestaClase>[] = [
    { clave: 'estado', titulo: 'Estado', valor: (p) => ESTADO[p.estado], opciones: ['Pendiente', 'Aplicada', 'Rechazada'].map((v) => ({ v, t: v })) },
    { clave: 'clase', titulo: 'Clase propuesta', valor: (p) => p.clase, opciones: OPCIONES.map((v) => ({ v, t: NOMBRE_CLASE[v] })) },
    { clave: 'seguridad', titulo: 'Seguridad', valor: (p) => p.seguridad, opciones: [{ v: 'ALTA', t: 'Alta' }, { v: 'MEDIA', t: 'Media' }, { v: 'BAJA', t: 'Baja (revisar)' }] },
    { clave: 'area', titulo: 'Área', valor: (p) => p.area, opciones: [{ v: 'BAR', t: 'Bar' }, { v: 'COCINA', t: 'Cocina' }] },
  ];
  const agrupar: Agrupar<PropuestaClase>[] = [
    { v: 'clase', t: 'Clase propuesta', valor: (p) => NOMBRE_CLASE[p.clase] },
    { v: 'area', t: 'Área', valor: (p) => (p.area === 'BAR' ? 'Bar' : 'Cocina') },
    { v: 'seguridad', t: 'Seguridad', valor: (p) => p.seguridad },
  ];
  const columnas: Columna<PropuestaClase>[] = [
    { k: 'generico', t: 'Insumo', orden: (p) => p.generico, ver: (p) => (
      <div style={{ minWidth: 170 }}>
        <strong>{p.generico}</strong>
        <div className="suave" style={{ fontSize: '.82rem' }}><span className="cod">{p.codigo}</span> · {p.area === 'BAR' ? 'Bar' : 'Cocina'} · {p.categoria ?? 'sin categoría'}</div>
      </div>) },
    { k: 'clase', t: 'Clase propuesta', orden: (p) => p.clase, ver: (p) => (
      soloLectura || p.estado !== 'PENDIENTE'
        ? <strong>{NOMBRE_CLASE[p.aplicada ?? p.clase]}</strong>
        : (
          <select value={p.clase} disabled={enviando} aria-label={`Clase de ${p.generico}`}
                  onChange={(e) => decidir([p.id], 'ACEPTAR', e.target.value as Clase)}>
            {OPCIONES.map((c) => <option key={c} value={c}>{NOMBRE_CLASE[c]}{c === p.clase ? ' (propuesta)' : ''}</option>)}
          </select>
        )) },
    { k: 'seguridad', t: 'Seguridad', orden: (p) => ({ ALTA: 0, MEDIA: 1, BAJA: 2 })[p.seguridad],
      ver: (p) => <span className="etiqueta" style={{ color: COLOR[p.seguridad] }}>{p.seguridad.toLowerCase()}</span> },
    { k: 'razon', t: 'Por qué', ver: (p) => (
      <div style={{ fontSize: '.85rem', minWidth: 180 }}>
        {p.razon}
        {p.mensaje && <div style={{ color: 'var(--error)', marginTop: '.2rem' }}>{p.mensaje}</div>}
        {p.estado !== 'PENDIENTE' && <div className="suave" style={{ marginTop: '.2rem' }}>{ESTADO[p.estado].toLowerCase()}{p.decidido_por ? ` · ${p.decidido_por}` : ''}</div>}
      </div>) },
    { k: 'acciones', t: '', ver: (p) => (!soloLectura && p.estado === 'PENDIENTE' ? (
      <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
        <button className="mini" type="button" disabled={enviando} onClick={() => decidir([p.id], 'ACEPTAR')}>Aceptar</button>
        <button type="button" className="secundario mini" disabled={enviando} onClick={() => decidir([p.id], 'RECHAZAR')}>Es materia prima</button>
      </div>) : null) },
  ];

  return (
    <>
      <p className="pagina-ancha" style={{ margin: '0 0 .4rem' }}>
        <strong>{pendientes.length}</strong> pendientes de {filas.length}
        <span className="suave"> · {OPCIONES.map((c) => `${NOMBRE_CLASE[c].toLowerCase()} ${pendientes.filter((p) => p.clase === c).length}`).join(' · ')}</span>
        {' '}· <Link href="/catalogo/verificar">Hoja de verificación →</Link>
      </p>
      {mensaje && (
        <div className={mensaje.ok ? 'exito' : 'aviso'} role="status">
          {mensaje.texto}{mensaje.lista && mensaje.lista.length > 0 && <ul>{mensaje.lista.map((m) => <li key={m}>{m}</li>)}</ul>}
        </div>
      )}
      <VistaFiltrable clave="propuestas-clase" filas={filas} id={(p) => p.id}
                      buscar={(p) => `${p.generico} ${p.codigo} ${p.categoria ?? ''} ${p.razon}`}
                      grupos={grupos} columnas={columnas} agrupar={agrupar} filtrosIniciales={{ estado: ['Pendiente'] }}
                      seleccionable={soloLectura ? undefined : (p) => p.estado === 'PENDIENTE'}
                      vacio="No quedan propuestas con estos filtros. ✔"
                      acciones={(elegidas, limpiar) => (
                        <div className="barra-bloque">
                          <div className="linea" style={{ flexWrap: 'wrap' }}>
                            <strong>{elegidas.length} seleccionada(s)</strong>
                            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                              <button type="button" disabled={enviando} onClick={() => decidir(elegidas.map((p) => p.id), 'ACEPTAR', null, limpiar)}>{enviando ? 'Aplicando…' : `Aceptar ${elegidas.length}`}</button>
                              <button type="button" className="secundario" disabled={enviando} onClick={() => decidir(elegidas.map((p) => p.id), 'RECHAZAR', null, limpiar)}>Son materia prima</button>
                              <button type="button" className="secundario" disabled={enviando} onClick={limpiar}>Quitar selección</button>
                            </div>
                          </div>
                        </div>
                      )} />
    </>
  );
}
