'use client';
import Link from 'next/link';
import VistaFiltrable, { type Agrupar, type Columna, type Grupo } from '@/components/VistaFiltrable';
import { NOMBRE_TIPO, pesos } from './comun';

export type FilaHistorial = { tipo: string; id: string; codigo: string; fecha: string; registrado_en: string; detalle: string; lineas: number;
                              valor: number | null; usuario: string | null; forzado: boolean; anulado: boolean; area: 'BAR' | 'COCINA' };
const estado = (f: FilaHistorial) => (f.anulado ? 'Anulado' : f.forzado ? 'Forzado' : 'Normal');
const mes = (f: FilaHistorial) => new Date(f.fecha + 'T12:00:00').toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });

export default function ListaHistorial({ filas, variasAreas }: { filas: FilaHistorial[]; variasAreas: boolean }) {
  const grupos: Grupo<FilaHistorial>[] = [
    { clave: 'tipo', titulo: 'Documento', valor: (f) => f.tipo, opciones: Object.entries(NOMBRE_TIPO).map(([v, n]) => ({ v, t: n.plural })) },
    ...(variasAreas ? [{ clave: 'area', titulo: 'Área', valor: (f: FilaHistorial) => f.area, opciones: [{ v: 'BAR', t: 'Bar' }, { v: 'COCINA', t: 'Cocina' }] }] : []),
    { clave: 'estado', titulo: 'Estado', valor: estado, opciones: ['Normal', 'Forzado', 'Anulado'].map((v) => ({ v, t: v })) },
    { clave: 'usuario', titulo: 'Registró', valor: (f) => f.usuario ?? '—' },
    { clave: 'mes', titulo: 'Mes', valor: mes },
  ];
  const agrupar: Agrupar<FilaHistorial>[] = [
    { v: 'fecha', t: 'Fecha', valor: (f) => f.fecha },
    { v: 'tipo', t: 'Documento', valor: (f) => NOMBRE_TIPO[f.tipo]?.plural ?? f.tipo },
    { v: 'usuario', t: 'Quién lo registró', valor: (f) => f.usuario ?? '—' },
    ...(variasAreas ? [{ v: 'area', t: 'Área', valor: (f: FilaHistorial) => (f.area === 'BAR' ? 'Bar' : 'Cocina') }] : []),
  ];
  const columnas: Columna<FilaHistorial>[] = [
    { k: 'fecha', t: 'Fecha', orden: (f) => f.registrado_en, ver: (f) => <span style={{ whiteSpace: 'nowrap' }}>{new Date(f.fecha + 'T12:00:00').toLocaleDateString('es-CO')}</span> },
    { k: 'tipo', t: 'Documento', orden: (f) => f.tipo, ver: (f) => NOMBRE_TIPO[f.tipo]?.singular ?? f.tipo },
    { k: 'codigo', t: 'Código', orden: (f) => f.codigo, ver: (f) => <Link href={`/historial/${f.tipo.toLowerCase()}/${f.id}`} className="cod">{f.codigo}</Link> },
    { k: 'detalle', t: 'Detalle', ver: (f) => <span style={f.anulado ? { textDecoration: 'line-through' } : undefined}>{f.detalle}</span> },
    { k: 'area', t: 'Área', def: variasAreas, ver: (f) => (f.area === 'BAR' ? 'Bar' : 'Cocina') },
    { k: 'lineas', t: 'Líneas', der: true, orden: (f) => f.lineas, ver: (f) => f.lineas },
    { k: 'valor', t: 'Valor', der: true, orden: (f) => f.valor, ver: (f) => (f.valor === null ? '—' : pesos(Number(f.valor))) },
    { k: 'usuario', t: 'Registró', orden: (f) => f.usuario, ver: (f) => f.usuario ?? '—' },
    { k: 'estado', t: 'Estado', orden: estado, ver: (f) => (f.anulado ? <span className="etiqueta inactivo">anulado</span>
      : f.forzado ? <span className="etiqueta provisional">forzado</span> : <span className="suave">—</span>) },
    { k: 'abrir', t: '', ver: (f) => <Link href={`/historial/${f.tipo.toLowerCase()}/${f.id}`} className="boton secundario" style={{ minHeight: 32, padding: '.1rem .6rem' }}>Abrir</Link> },
  ];
  return (
    <VistaFiltrable clave="historial" filas={filas} id={(f) => f.tipo + f.id} buscar={(f) => `${f.codigo} ${f.detalle} ${f.usuario ?? ''}`}
                    grupos={grupos} columnas={columnas} agrupar={agrupar} vacio="No hay documentos con estos filtros." />
  );
}
