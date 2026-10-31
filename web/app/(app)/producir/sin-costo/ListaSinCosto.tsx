'use client';
import VistaFiltrable, { type Agrupar, type Columna, type Grupo } from '@/components/VistaFiltrable';

export type LoteSinCosto = {
  origen: 'APP' | 'HISTÓRICO'; id: string; codigo: string; fecha: string; mpi: string; unidad: string; neto: number | null;
  costo_total: number | null; estado_costo: string; estado_lote: string; motivos: string[];
};

// Qué tipo de faltante es cada motivo: sirve para ver qué arreglo destraba más lotes.
function tipoMotivo(m: string) {
  const s = m.toLowerCase();
  if (s.includes('sin compras registradas')) return 'Insumo sin compras';
  if (s.includes('sin factor')) return 'Compra sin factor de conversión';
  if (s.includes('falta parámetro')) return 'Falta una conversión (densidad)';
  if (s.includes('mpi sin lote costeado')) return 'MPI usado sin costo';
  if (s.includes('kardex')) return 'Sin costo en el kardex';
  if (s.includes('peso neto')) return 'Sin peso neto';
  if (s.includes('ingredientes')) return 'Sin ingredientes';
  if (s.includes('por revisar')) return 'Líneas por revisar';
  return 'Sin costo';
}
const insumo = (m: string) => (m.includes(': ') && !m.startsWith('El ') && !m.startsWith('No ') ? m.split(': ')[0] : null);
const pesos = (n: number) => n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

export default function ListaSinCosto({ filas }: { filas: LoteSinCosto[] }) {
  const grupos: Grupo<LoteSinCosto>[] = [
    { clave: 'origen', titulo: 'Origen', valor: (f) => f.origen, opciones: [{ v: 'APP', t: 'Registrado en la app' }, { v: 'HISTÓRICO', t: 'Histórico (Sheets)' }] },
    { clave: 'estado', titulo: 'Estado del costo', valor: (f) => f.estado_costo },
    { clave: 'motivo', titulo: 'Por qué', valor: (f) => [...new Set(f.motivos.map(tipoMotivo))] },
    { clave: 'insumo', titulo: 'Insumo que falta', valor: (f) => f.motivos.map(insumo).filter(Boolean) as string[] },
    { clave: 'mpi', titulo: 'MPI', valor: (f) => f.mpi },
    { clave: 'lote', titulo: 'Lote', valor: (f) => (f.estado_lote === 'ACTIVA' ? 'Activo' : f.estado_lote === 'REVISAR' ? 'Por revisar' : 'Anulado') },
  ];
  const agrupar: Agrupar<LoteSinCosto>[] = [
    { v: 'mpi', t: 'MPI', valor: (f) => f.mpi },
    { v: 'estado', t: 'Estado del costo', valor: (f) => f.estado_costo },
    { v: 'origen', t: 'Origen', valor: (f) => (f.origen === 'APP' ? 'Registrado en la app' : 'Histórico (Sheets)') },
  ];
  const columnas: Columna<LoteSinCosto>[] = [
    { k: 'codigo', t: 'Lote', orden: (f) => f.codigo, ver: (f) => <span className="cod">{f.codigo}</span> },
    { k: 'fecha', t: 'Fecha', orden: (f) => f.fecha, ver: (f) => <span style={{ whiteSpace: 'nowrap' }}>{new Date(f.fecha + 'T12:00:00').toLocaleDateString('es-CO')}</span> },
    { k: 'mpi', t: 'MPI', orden: (f) => f.mpi, ver: (f) => <strong>{f.mpi}</strong> },
    { k: 'neto', t: 'Neto', der: true, orden: (f) => f.neto, ver: (f) => (f.neto ? `${Number(f.neto).toLocaleString('es-CO')} ${f.unidad}` : '—') },
    { k: 'costo', t: 'Costo parcial', der: true, orden: (f) => f.costo_total, ver: (f) => (f.costo_total ? pesos(Number(f.costo_total)) : '—') },
    { k: 'estado', t: 'Estado', orden: (f) => f.estado_costo, ver: (f) => <span className="etiqueta provisional">{f.estado_costo.toLowerCase()}</span> },
    { k: 'motivos', t: 'Por qué', ver: (f) => (
      <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '.88rem' }}>{f.motivos.map((m) => <li key={m}>{m}</li>)}</ul>
    ) },
    { k: 'origen', t: 'Origen', def: false, orden: (f) => f.origen, ver: (f) => (f.origen === 'APP' ? 'App' : 'Histórico') },
  ];
  return (
    <VistaFiltrable clave="lotes-sin-costo" filas={filas} id={(f) => f.origen + f.id} buscar={(f) => `${f.codigo} ${f.mpi} ${f.motivos.join(' ')}`}
                    grupos={grupos} columnas={columnas} agrupar={agrupar} vacio="Ningún lote sin costo con estos filtros. ✔" />
  );
}
