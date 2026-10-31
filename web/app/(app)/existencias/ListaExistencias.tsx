'use client';
import VistaFiltrable, { type Agrupar, type Columna, type Grupo } from '@/components/VistaFiltrable';
import { fmtCantidad } from '@/lib/catalogo';

export type FilaExistencia = {
  producto_id: string; producto_codigo: string; generico: string; marca: string; presentacion: string; unidad_base: string;
  area: 'BAR' | 'COCINA'; ubicacion: string; zona: string; cantidad: number; costo_promedio: number | null; valor: number | null;
};
const pesos = (n: number, dec = 0) => n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: dec, minimumFractionDigits: dec });

export default function ListaExistencias({ filas, zonaInicial, variasAreas }: { filas: FilaExistencia[]; zonaInicial: string | null; variasAreas: boolean }) {
  const grupos: Grupo<FilaExistencia>[] = [
    ...(variasAreas ? [{ clave: 'area', titulo: 'Área', valor: (f: FilaExistencia) => f.area, opciones: [{ v: 'BAR', t: 'Bar' }, { v: 'COCINA', t: 'Cocina' }] }] : []),
    { clave: 'zona', titulo: 'Zona', valor: (f) => f.zona },
    { clave: 'unidad', titulo: 'Unidad', valor: (f) => f.unidad_base },
    { clave: 'estado', titulo: 'Revisar', valor: (f) => [f.costo_promedio === null && 'sin', f.cantidad < 0 && 'neg'].filter(Boolean) as string[],
      opciones: [{ v: 'sin', t: 'Sin costo todavía' }, { v: 'neg', t: 'Saldo negativo' }] },
  ];
  const agrupar: Agrupar<FilaExistencia>[] = [
    { v: 'zona', t: 'Zona', valor: (f) => f.zona },
    ...(variasAreas ? [{ v: 'area', t: 'Área', valor: (f: FilaExistencia) => (f.area === 'BAR' ? 'Bar' : 'Cocina') }] : []),
    { v: 'unidad', t: 'Unidad', valor: (f) => f.unidad_base },
  ];
  const columnas: Columna<FilaExistencia>[] = [
    { k: 'producto', t: 'Producto', orden: (f) => f.generico, ver: (f) => (
      <div style={{ minWidth: 180 }}>{f.generico}{f.marca && ` · ${f.marca}`}<div className="suave" style={{ fontSize: '.8rem' }}>{f.presentacion}</div></div>) },
    { k: 'codigo', t: 'Código', def: false, orden: (f) => f.producto_codigo, ver: (f) => <span className="cod">{f.producto_codigo}</span> },
    { k: 'zona', t: 'Zona', orden: (f) => f.zona, ver: (f) => <span className="suave" style={{ fontSize: '.88rem' }}>{f.zona}</span> },
    { k: 'area', t: 'Área', def: false, ver: (f) => (f.area === 'BAR' ? 'Bar' : 'Cocina') },
    { k: 'cantidad', t: 'Cantidad', der: true, orden: (f) => Number(f.cantidad),
      ver: (f) => <span style={{ color: f.cantidad < 0 ? 'var(--error)' : undefined }}>{fmtCantidad(Number(f.cantidad))} {f.unidad_base}</span> },
    { k: 'costo', t: 'Costo promedio', der: true, def: false, orden: (f) => f.costo_promedio,
      ver: (f) => (f.costo_promedio === null ? '—' : `${pesos(Number(f.costo_promedio), Number(f.costo_promedio) < 100 ? 2 : 0)}/${f.unidad_base}`) },
    { k: 'valor', t: 'Valor', der: true, orden: (f) => f.valor, ver: (f) => (f.valor === null ? <span className="suave">sin costo</span> : pesos(Number(f.valor))) },
  ];
  return (
    <VistaFiltrable clave="existencias" filas={filas} id={(f) => f.producto_id + f.ubicacion}
                    buscar={(f) => `${f.generico} ${f.marca} ${f.presentacion} ${f.producto_codigo}`}
                    grupos={grupos} columnas={columnas} agrupar={agrupar}
                    filtrosIniciales={zonaInicial ? { zona: [zonaInicial] } : undefined}
                    pie={(vis) => {
                      const total = vis.reduce((t, f) => t + Number(f.valor ?? 0), 0);
                      return (
                        <div className="tarjeta" style={{ marginTop: '.8rem' }}>
                          <div className="suave" style={{ fontSize: '.85rem' }}>Valor de lo filtrado</div>
                          <strong style={{ fontSize: '1.4rem' }}>{pesos(total)}</strong>
                          <div className="suave" style={{ fontSize: '.85rem' }}>
                            {vis.length} línea(s){vis.some((f) => f.costo_promedio === null) && ` · ${vis.filter((f) => f.costo_promedio === null).length} sin costo todavía`}
                            {vis.some((f) => f.cantidad < 0) && ` · ${vis.filter((f) => f.cantidad < 0).length} en negativo`}
                          </div>
                        </div>
                      );
                    }} />
  );
}
