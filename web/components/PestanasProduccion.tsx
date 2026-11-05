import Link from 'next/link';

// Las tres secciones de Producción, siempre arriba y del mismo tamaño: la ficha es el paso previo
// para producir, y cada lote queda en Lotes con su trazabilidad.
export default function PestanasProduccion({ activa, area }: { activa: 'fichas' | 'producir' | 'lotes'; area?: string }) {
  const q = area ? `?area=${area}` : '';
  const items = [
    { k: 'fichas', href: `/produccion${q}`, t: 'Fichas técnicas', d: 'consultar y crear' },
    { k: 'producir', href: `/producir${q}`, t: 'Producir', d: 'registrar un lote' },
    { k: 'lotes', href: `/produccion/lotes${q}`, t: 'Lotes', d: 'trazabilidad' },
  ] as const;
  return (
    <nav className="pestanas-prod" aria-label="Secciones de Producción">
      {items.map((i) => (
        <Link key={i.k} href={i.href} aria-current={activa === i.k ? 'page' : undefined}>
          <span>{i.t}</span><small>{i.d}</small>
        </Link>
      ))}
    </nav>
  );
}
