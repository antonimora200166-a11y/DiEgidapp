import Link from 'next/link';

// Pestañas de Calidad del catálogo (CAL-01): la bandeja y cada revisión, siempre a un toque.
export type PestanaCalidad = 'bandeja' | 'revision' | 'unidades' | 'clases' | 'verificar' | 'precios';
const PESTANAS: { k: PestanaCalidad; t: string; href: string; admin?: boolean }[] = [
  { k: 'bandeja', t: 'Bandeja', href: '/catalogo/calidad' },
  { k: 'verificar', t: 'Verificar A/B', href: '/catalogo/verificar' },
  { k: 'revision', t: 'Duplicados', href: '/catalogo/revision' },
  { k: 'unidades', t: 'Unidades', href: '/catalogo/unidades' },
  { k: 'clases', t: 'Clasificar', href: '/catalogo/clases' },
  { k: 'precios', t: 'Precios por foto', href: '/catalogo/precios', admin: true },
];

export default function PestanasCalidad({ activa, esAdmin }: { activa: PestanaCalidad; esAdmin: boolean }) {
  return (
    <>
      <p className="pagina-ancha migas"><Link href="/catalogo">Catálogo</Link> › Calidad del catálogo</p>
      <nav className="pestanas-consulta" aria-label="Calidad del catálogo">
        {PESTANAS.filter((p) => !p.admin || esAdmin).map((p) => (
          <Link key={p.k} href={p.href} aria-current={p.k === activa ? 'page' : undefined}>{p.t}</Link>
        ))}
      </nav>
    </>
  );
}
