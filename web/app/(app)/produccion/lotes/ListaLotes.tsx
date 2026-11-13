'use client';
import Link from 'next/link';
import VistaFiltrable, { type Columna, type Grupo } from '@/components/VistaFiltrable';
import { pesos } from '@/lib/fichas';
import { ESTADO_LOTE, type EstadoLote as Estado } from '@/lib/lotes';
import { fecha as fmtFecha } from '@/lib/formato';

export type FilaLote = {
  id: string; codigo: string; fecha: string; registrado_en: string | null; generico_id: string; mpi: string; unidad_base: string; area: string;
  responsable: string | null; entrada_g: number | null; neto_g: number | null; merma_g: number | null; rendimiento: number | null; desvio_pp: number | null;
  costo_total: number | null; costo_gramo: number | null; estado_costo: string; vence: string | null; conservacion: string | null;
  restante: number | null; estado: Estado; origen: 'APP' | 'SGI-COSTOS';
};

const n = (x: number | null, d = 0) => (x === null || x === undefined ? '—' : Number(x).toLocaleString('es-CO', { maximumFractionDigits: d }));
const corta = (d: string) => fmtFecha(d);
const dias = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 864e5);

// vePesos: costo del lote y $/g solo para administración
export default function ListaLotes({ filas, hoy, vePesos }: { filas: FilaLote[]; hoy: string; vePesos: boolean }) {
  const periodo = (l: FilaLote) => { const d = dias(l.fecha, hoy); return d <= 7 ? '7' : d <= 30 ? '30' : d <= 90 ? '90' : 'mas'; };
  const grupos: Grupo<FilaLote>[] = [
    { clave: 'estado', titulo: 'Estado', valor: (l) => l.estado, opciones: Object.entries(ESTADO_LOTE).map(([v, x]) => ({ v, t: x.t })) },
    { clave: 'fecha', titulo: 'Fecha', valor: (l) => { const p = periodo(l); return p === '7' ? ['7', '30', '90'] : p === '30' ? ['30', '90'] : p === '90' ? ['90'] : []; },
      unico: true, opciones: [{ v: '7', t: 'Últimos 7 días' }, { v: '30', t: 'Últimos 30 días' }, { v: '90', t: 'Últimos 90 días' }] },
    { clave: 'mpi', titulo: 'MPI', valor: (l) => l.mpi },
    { clave: 'responsable', titulo: 'Responsable', valor: (l) => l.responsable ?? 'Sin dato (histórico)' },
    { clave: 'desvio', titulo: 'Rendimiento', unico: true, valor: (l) => (l.desvio_pp !== null && Math.abs(l.desvio_pp) > 5 ? 'fuera' : 'normal'),
      opciones: [{ v: 'fuera', t: 'Desvío mayor a ±5 pp' }] },
  ];
  const columnas: Columna<FilaLote>[] = [
    { k: 'codigo', t: 'Lote', orden: (l) => l.fecha + l.codigo, ver: (l) => (
      <Link href={`/produccion/lotes/${encodeURIComponent(l.codigo)}`} style={{ textDecoration: 'none' }}>
        <span className="cod" style={{ display: 'block' }}>{l.codigo}</span><span style={{ fontSize: '.85rem' }}>{corta(l.fecha)}</span>
      </Link>) },
    { k: 'mpi', t: 'MPI', orden: (l) => l.mpi, ver: (l) => <Link href={`/produccion/lotes/${encodeURIComponent(l.codigo)}`}><strong>{l.mpi}</strong></Link> },
    { k: 'resp', t: 'Responsable', orden: (l) => l.responsable, ver: (l) => l.responsable ?? <span className="suave">—</span> },
    { k: 'entrada', t: 'Entrada g', der: true, orden: (l) => l.entrada_g, ver: (l) => n(l.entrada_g) },
    { k: 'neto', t: 'Neto g', der: true, orden: (l) => l.neto_g, ver: (l) => n(l.neto_g) },
    { k: 'rend', t: 'Rend.', der: true, orden: (l) => l.rendimiento, ver: (l) => (l.rendimiento === null ? '—' : `${n(l.rendimiento * 100, 1)} %`) },
    { k: 'desvio', t: 'Desvío', der: true, orden: (l) => l.desvio_pp, ver: (l) => l.desvio_pp === null ? '—'
        : <span className={Math.abs(l.desvio_pp) > 5 ? 'pill aviso' : ''}>{l.desvio_pp > 0 ? '+' : ''}{n(l.desvio_pp, 1)} pp</span> },
    { k: 'costo', t: 'Costo', der: true, orden: (l) => l.costo_total, ver: (l) => <>{pesos(l.costo_total)}{l.estado_costo !== 'COMPLETO' && <span className="pill aviso" style={{ display: 'block', marginTop: 2 }}>parcial</span>}</> },
    { k: 'cg', t: '$/g', der: true, orden: (l) => l.costo_gramo, ver: (l) => pesos(l.costo_gramo, 2) },
    { k: 'vence', t: 'Vence', orden: (l) => l.vence, ver: (l) => (l.vence ? corta(l.vence) : '—') },
    { k: 'queda', t: 'Queda', der: true, orden: (l) => l.restante, ver: (l) => (l.restante === null ? '—' : `${n(l.restante)} ${l.unidad_base}`) },
    { k: 'estado', t: 'Estado', orden: (l) => l.estado, ver: (l) => <span className={`pill ${ESTADO_LOTE[l.estado].c}`}>{ESTADO_LOTE[l.estado].t}</span> },
  ];
  return (
    <VistaFiltrable clave="produccion-lotes" filas={filas} id={(l) => l.id} buscar={(l) => `${l.codigo} ${l.mpi} ${l.responsable ?? ''}`}
                    grupos={grupos} columnas={columnas.filter((c) => vePesos || !['costo', 'cg'].includes(c.k))}
                    pie={(v) => <p className="suave" style={{ fontSize: '.82rem' }}>{v.length} de {filas.length} lotes. Los «Histórico» vienen de SGI-COSTOS: solo consulta, sin existencia.</p>}
                    vacio="Ningún lote coincide con estos filtros." />
  );
}
