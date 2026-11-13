import Link from 'next/link';

// Pestañas fijas de Consulta (CONS-02): cualquier bloque a un toque y el período y el área se conservan al
// cambiar. Las de ventas y real vs. teórico son vistas de /consulta; inventario, compras, producción y
// pérdidas viven en /consulta/operacion.
export type PestanaConsulta = 'resumen' | 'ventas' | 'real' | 'inventario' | 'compras' | 'produccion' | 'perdidas' | 'alertas';
const PESTANAS: { k: PestanaConsulta; t: string; ruta: 'consulta' | 'operacion' }[] = [
  { k: 'resumen', t: 'Resumen', ruta: 'consulta' },
  { k: 'ventas', t: 'Ventas y margen', ruta: 'consulta' },
  { k: 'real', t: 'Real vs. teórico', ruta: 'consulta' },
  { k: 'inventario', t: 'Inventario', ruta: 'operacion' },
  { k: 'compras', t: 'Compras', ruta: 'operacion' },
  { k: 'produccion', t: 'Producción', ruta: 'operacion' },
  { k: 'perdidas', t: 'Pérdidas', ruta: 'operacion' },
  { k: 'alertas', t: 'Alertas', ruta: 'consulta' },
];

export default function PestanasConsulta({ activa, desde, hasta, area, alertas }: {
  activa: PestanaConsulta; desde: string; hasta: string; area: string; alertas?: number;
}) {
  return (
    <nav className="pestanas-consulta" aria-label="Bloques de Consulta">
      {PESTANAS.map((p) => {
        const q = new URLSearchParams({ desde, hasta, area, ...(p.ruta === 'operacion' ? { bloque: p.k } : p.k === 'resumen' ? {} : { vista: p.k }) });
        return (
          <Link key={p.k} href={`/consulta${p.ruta === 'operacion' ? '/operacion' : ''}?${q}`} aria-current={p.k === activa ? 'page' : undefined}>
            {p.t}{p.k === 'alertas' && !!alertas && <span className="pc-n">{alertas}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
