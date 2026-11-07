'use client';
import Link from 'next/link';
import VistaFiltrable, { type Columna, type Grupo } from '@/components/VistaFiltrable';
import { pesos, pct, vidaUtil, type Almacenamiento } from '@/lib/fichas';

export type FilaProd = {
  generico_id: string; generico_codigo: string; nombre: string; unidad_base: string;
  ficha_id: string | null; ficha_codigo: string | null; version: number | null; vigente_desde: string | null; origen: string | null;
  neto_esperado: number | null; entrada_esperada: number | null; rendimiento: number | null;
  costo_tanda: number | null; costo_unidad: number | null; costo_completo: boolean; estimado: boolean;
  faltan: number; primer_falta: string | null; lineas: number; pasos: number; puntos: number; alergenos: string[];
  almacenamientos: Almacenamiento[]; lotes: number; estado: 'VIGENTE' | 'INCOMPLETA' | 'SIN_FICHA';
};
const ESTADO: Record<FilaProd['estado'], { t: string; c: string }> = {
  VIGENTE: { t: 'Vigente', c: 'ok' }, INCOMPLETA: { t: 'Incompleta', c: 'aviso' }, SIN_FICHA: { t: 'Sin ficha', c: 'error' },
};
// lo que le falta a una ficha para ser útil a quien produce
const pendientes = (f: FilaProd) => f.estado === 'SIN_FICHA' ? [] : [
  ...(f.puntos === 0 ? ['Sin puntos críticos'] : []),
  ...(f.pasos === 0 ? ['Sin procedimiento'] : []),
  ...(f.almacenamientos.length === 0 ? ['Sin vida útil'] : []),
];

// vePesos: costo de la tanda y $/unidad solo para administración
export default function ListaFichasProduccion({ filas, vePesos }: { filas: FilaProd[]; vePesos: boolean }) {
  const grupos: Grupo<FilaProd>[] = [
    { clave: 'estado', titulo: 'Estado', valor: (f) => f.estado, opciones: Object.entries(ESTADO).map(([v, x]) => ({ v, t: x.t })) },
    { clave: 'falta', titulo: 'Le falta', valor: pendientes,
      opciones: ['Sin puntos críticos', 'Sin procedimiento', 'Sin vida útil'].map((v) => ({ v, t: v })) },
    { clave: 'lotes', titulo: 'Producción', unico: true, valor: (f) => (f.lotes > 0 ? 'con' : 'sin'),
      opciones: [{ v: 'con', t: 'Ya tiene lotes' }, { v: 'sin', t: 'Sin lotes' }] },
  ];
  const columnas: Columna<FilaProd>[] = [
    { k: 'nombre', t: 'MPI', orden: (f) => f.nombre, ver: (f) => (
      <Link href={`/fichas/${f.generico_id}`} style={{ textDecoration: 'none' }}>
        <strong style={{ display: 'block' }}>{f.nombre}</strong>
        <span className="cod">{f.generico_codigo}{f.ficha_codigo ? ` · ficha ${f.ficha_codigo}` : ''}</span>
      </Link>) },
    { k: 'rend', t: 'Rend. esp.', der: true, orden: (f) => f.rendimiento, ver: (f) => pct(f.rendimiento) },
    { k: 'neto', t: 'Neto esp.', der: true, orden: (f) => f.neto_esperado,
      ver: (f) => (f.neto_esperado === null ? '—' : `${Number(f.neto_esperado).toLocaleString('es-CO')} ${f.unidad_base}`) },
    { k: 'costo', t: 'Costo tanda', der: true, orden: (f) => (f.costo_completo ? f.costo_tanda : null),
      ver: (f) => (f.ficha_id && f.costo_completo ? <>{pesos(f.costo_tanda)}{f.estimado && <span className="suave" title="Sin kardex: usa precios de referencia"> *</span>}</> : '—') },
    { k: 'cg', t: `$/unidad`, der: true, orden: (f) => f.costo_unidad,
      ver: (f) => (f.costo_unidad === null ? '—' : `${pesos(f.costo_unidad, 2)}/${f.unidad_base}`) },
    { k: 'vida', t: 'Vida útil', orden: (f) => f.almacenamientos[0]?.vida_util_dias ?? null, ver: (f) => vidaUtil(f.almacenamientos) || '—' },
    { k: 'version', t: 'Versión', der: true, orden: (f) => f.version, ver: (f) => (f.version ? `v${f.version}` : '—') },
    { k: 'estado', t: 'Estado', orden: (f) => f.estado, ver: (f) => {
      const p = pendientes(f);
      return <>
        <span className={`pill ${ESTADO[f.estado].c}`}>{ESTADO[f.estado].t}</span>
        {f.estado === 'INCOMPLETA' && f.primer_falta && <span className="suave" style={{ display: 'block', fontSize: '.78rem', marginTop: '.15rem' }}>{f.primer_falta}</span>}
        {f.estado === 'INCOMPLETA' && !f.primer_falta && f.neto_esperado === null && <span className="suave" style={{ display: 'block', fontSize: '.78rem', marginTop: '.15rem' }}>Falta el neto esperado</span>}
        {p.length > 0 && <span className="suave" style={{ display: 'block', fontSize: '.78rem', marginTop: '.15rem' }}>{p.join(' · ')}</span>}
      </>;
    } },
    { k: 'lotes', t: 'Lotes', der: true, def: false, orden: (f) => f.lotes, ver: (f) => f.lotes || '—' },
  ];
  return (
    <VistaFiltrable clave="produccion-fichas" filas={filas} id={(f) => f.generico_id}
                    buscar={(f) => `${f.generico_codigo} ${f.ficha_codigo ?? ''} ${f.nombre}`}
                    grupos={grupos} columnas={columnas.filter((c) => vePesos || !['costo', 'cg'].includes(c.k))}
                    pie={(v) => <p className="suave" style={{ fontSize: '.82rem' }}>
                      {v.length} de {filas.length} MPI.
                      {vePesos && ' Costo de tanda = Σ cantidad de la ficha × costo promedio vigente; lo que no se compra (agua) vale $0.'}
                      {vePesos && v.some((f) => f.estimado) && ' * Estimado: aún sin kardex, usa precios de referencia.'}</p>}
                    vacio="Ninguna ficha coincide con estos filtros." />
  );
}
