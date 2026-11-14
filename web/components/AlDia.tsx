import Link from 'next/link';

// Estado «al día» de una revisión del catálogo (CAL-03): se celebra lo terminado y se ofrece el siguiente paso,
// para seguir el flujo sin volver atrás.
export default function AlDia({ titulo, detalle, siguiente = { href: '/catalogo/calidad', t: 'Ver qué más falta en la bandeja' } }: {
  titulo: string; detalle?: string; siguiente?: { href: string; t: string };
}) {
  return (
    <div className="al-dia tarjeta" role="status">
      <span className="al-dia-marca" aria-hidden>✓</span>
      <strong>{titulo}</strong>
      {detalle && <span className="suave">{detalle}</span>}
      <Link href={siguiente.href} className="boton">{siguiente.t} ›</Link>
    </div>
  );
}
