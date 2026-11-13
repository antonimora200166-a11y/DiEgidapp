import Link from 'next/link';

// Fichas técnicas es una sola pantalla con cuatro vistas (FICH-01): todas, cócteles y bebidas, platos, y las MPI
// para producir (con su costo por tanda y vida útil, en /produccion). Así nadie se pregunta cuál es «la buena».
export type VistaFichas = 'todas' | 'BEBIDA' | 'PLATO' | 'MPI';
export default function SegmentoFichas({ activa, area }: { activa: VistaFichas; area?: string }) {
  const items: { k: VistaFichas; t: string; href: string }[] = [
    { k: 'todas', t: 'Todas', href: '/fichas' },
    { k: 'BEBIDA', t: 'Cócteles y bebidas', href: '/fichas?tipo=BEBIDA' },
    { k: 'PLATO', t: 'Platos', href: '/fichas?tipo=PLATO' },
    { k: 'MPI', t: 'MPI para producir', href: `/produccion${area ? `?area=${area}` : ''}` },
  ];
  return (
    <nav className="segmentos mb-3" aria-label="Vistas de fichas técnicas">
      {items.map((i) => (
        <Link key={i.k} href={i.href} aria-current={i.k === activa ? 'true' : undefined}><span>{i.t}</span></Link>
      ))}
    </nav>
  );
}
