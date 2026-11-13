import Link from 'next/link';

// Reportar pérdida tiene dos caminos, siempre a la vista: lo que se dañó o venció (insumos) y
// las cortesías o mal hechos (productos de la carta, que descargan su ficha).
export default function PestanasPerdida({ activa, area }: { activa: 'insumos' | 'carta'; area?: string }) {
  const q = area ? `?area=${area}` : '';
  const items = [
    { k: 'insumos', href: `/bajas${q}`, t: 'Se dañó o venció', d: 'insumos que se botan' },
    { k: 'carta', href: `/bajas/carta${q}`, t: 'Cortesía o mal hecho', d: 'cóctel o plato de la carta' },
  ] as const;
  return (
    <nav className="pestanas-prod dos" aria-label="Tipo de pérdida">
      {items.map((i) => (
        <Link key={i.k} href={i.href} aria-current={activa === i.k ? 'page' : undefined}>
          <span>{i.t}</span><small>{i.d}</small>
        </Link>
      ))}
    </nav>
  );
}
