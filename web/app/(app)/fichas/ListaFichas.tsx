'use client';
import Link from 'next/link';
import VistaFiltrable, { type Agrupar, type Columna, type Grupo } from '@/components/VistaFiltrable';

export type FilaFicha = {
  generico_id: string; nombre: string; tipo: string; unidad_base: string; area: 'BAR' | 'COCINA'; ficha_id: string | null; codigo: string | null;
  version: number | null; neto_esperado: number | null; lineas: number; faltan: number; primer_falta: string | null; lotes: number;
};
const TIPO: Record<string, string> = { MPI: 'Producción (MPI)', BEBIDA: 'Cóctel o bebida', PLATO: 'Plato' };
// Estado de la ficha para filtrar y agrupar
export const estadoFicha = (f: FilaFicha) =>
  !f.ficha_id ? 'Sin ficha' : f.faltan > 0 ? 'Líneas por completar' : f.tipo === 'MPI' && f.neto_esperado === null ? 'Sin neto esperado' : 'Completa';

export default function ListaFichas({ filas, variasAreas }: { filas: FilaFicha[]; variasAreas: boolean }) {
  const grupos: Grupo<FilaFicha>[] = [
    ...(variasAreas ? [{ clave: 'area', titulo: 'Área', valor: (f: FilaFicha) => f.area, opciones: [{ v: 'BAR', t: 'Bar' }, { v: 'COCINA', t: 'Cocina' }] }] : []),
    { clave: 'estado', titulo: 'Estado', valor: estadoFicha,
      opciones: ['Líneas por completar', 'Sin neto esperado', 'Sin ficha', 'Completa'].map((v) => ({ v, t: v })) },
    { clave: 'tipo', titulo: 'Tipo', valor: (f) => f.tipo, opciones: Object.entries(TIPO).map(([v, t]) => ({ v, t })) },
    { clave: 'lotes', titulo: 'Producción', unico: true, valor: (f) => (f.lotes > 0 ? 'con' : 'sin'),
      opciones: [{ v: 'con', t: 'Ya costeó lotes' }, { v: 'sin', t: 'Sin lotes' }] },
    { clave: 'unidad', titulo: 'Resultado en', valor: (f) => f.unidad_base },
  ];
  const agrupar: Agrupar<FilaFicha>[] = [
    { v: 'estado', t: 'Estado', valor: estadoFicha },
    { v: 'tipo', t: 'Tipo', valor: (f) => TIPO[f.tipo] ?? f.tipo },
    ...(variasAreas ? [{ v: 'area', t: 'Área', valor: (f: FilaFicha) => (f.area === 'BAR' ? 'Bar' : 'Cocina') }] : []),
  ];
  const columnas: Columna<FilaFicha>[] = [
    { k: 'codigo', t: 'Código', orden: (f) => f.codigo, ver: (f) => <span className="cod">{f.codigo ?? '—'}</span> },
    { k: 'nombre', t: 'Nombre', orden: (f) => f.nombre, ver: (f) => <Link href={`/fichas/${f.generico_id}`}><strong>{f.nombre}</strong></Link> },
    { k: 'area', t: 'Área', def: variasAreas, ver: (f) => (f.area === 'BAR' ? 'Bar' : 'Cocina') },
    { k: 'tipo', t: 'Tipo', orden: (f) => f.tipo, ver: (f) => TIPO[f.tipo] ?? f.tipo },
    { k: 'version', t: 'Versión', def: false, der: true, orden: (f) => f.version, ver: (f) => f.version ?? '—' },
    { k: 'lineas', t: 'Ingredientes', der: true, orden: (f) => f.lineas, ver: (f) => (f.ficha_id ? f.lineas : '—') },
    { k: 'neto', t: 'Rinde', der: true, orden: (f) => f.neto_esperado,
      ver: (f) => (f.neto_esperado === null ? <span className="suave">—</span> : `${Number(f.neto_esperado).toLocaleString('es-CO')} ${f.unidad_base}`) },
    { k: 'estado', t: 'Estado', orden: estadoFicha, ver: (f) => {
      const e = estadoFicha(f);
      return <span style={{ color: e === 'Completa' ? 'var(--ok)' : 'var(--aviso)', fontSize: '.88rem' }}>
        {e}{f.faltan > 0 && ` (${f.faltan})`}
        {f.primer_falta && <span className="suave" style={{ display: 'block', fontSize: '.8rem' }}>{f.primer_falta}</span>}
      </span>;
    } },
    { k: 'lotes', t: 'Lotes', der: true, orden: (f) => f.lotes, ver: (f) => f.lotes || '—' },
    { k: 'abrir', t: '', ver: (f) => <Link href={`/fichas/${f.generico_id}`} className="boton secundario" style={{ minHeight: 32, padding: '.1rem .6rem' }}>{f.ficha_id ? 'Abrir' : 'Crear ficha'}</Link> },
  ];
  return (
    <VistaFiltrable clave="fichas" filas={filas} id={(f) => f.generico_id} buscar={(f) => `${f.codigo ?? ''} ${f.nombre}`}
                    grupos={grupos} columnas={columnas} agrupar={agrupar} filtrosIniciales={{ estado: ['Líneas por completar', 'Sin neto esperado'] }}
                    vacio="No hay fichas con estos filtros. ✔" />
  );
}
