'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Cabecera (GEN-07): en Inicio, la marca; en cualquier otra pantalla, «‹» para volver y el nombre de la pantalla,
// para que siempre se sepa dónde está. El monograma D·É se queda como acento de marca y lleva a Inicio.
const TITULOS: [string, string][] = [
  ['/recibir', 'Recibir'], ['/producir', 'Producir'], ['/produccion/lotes', 'Lotes'], ['/produccion/validar', 'Validar fichas'],
  ['/produccion', 'Producción'], ['/fichas', 'Fichas técnicas'], ['/conteo', 'Contar'], ['/bajas', 'Reportar pérdida'],
  ['/trasladar', 'Trasladar'], ['/historial', 'Historial'], ['/existencias', 'Existencias'], ['/pedido', 'Pedido sugerido'],
  ['/proveedores', 'Proveedores'], ['/carta', 'Carta y margen'], ['/alertas', 'Alertas'], ['/consulta', 'Consulta'],
  ['/catalogo/calidad', 'Calidad del catálogo'], ['/catalogo/verificar', 'Calidad del catálogo'], ['/catalogo/revision', 'Calidad del catálogo'],
  ['/catalogo/unidades', 'Calidad del catálogo'], ['/catalogo/clases', 'Calidad del catálogo'], ['/catalogo/precios', 'Calidad del catálogo'],
  ['/catalogo/nuevo', 'Crear producto'], ['/catalogo', 'Catálogo'], ['/arranque', 'Listo para arrancar'], ['/admin/usuarios', 'Usuarios'],
  ['/admin/ia', 'IA de facturas'], ['/admin/registro', 'Registro'], ['/cuenta', 'Mi cuenta'], ['/l/', 'Lote'],
];
// a dónde lleva «volver»: la pantalla de arriba (en las de primer nivel, Inicio)
function arriba(ruta: string) {
  const partes = ruta.split('/').filter(Boolean);
  if (ruta.startsWith('/catalogo/') && ruta !== '/catalogo/calidad' && TITULOS.find(([r]) => ruta.startsWith(r))?.[1] === 'Calidad del catálogo') return '/catalogo/calidad';
  if (partes[0] === 'producir' || partes[0] === 'fichas') return partes.length > 1 ? `/${partes[0]}` : '/produccion';
  if (partes[0] === 'l') return '/produccion/lotes';
  return partes.length > 1 ? `/${partes.slice(0, -1).join('/')}` : '/';
}

export default function TituloBarra() {
  const ruta = usePathname();
  if (ruta === '/') {
    return (
      <Link href="/" className="marca" aria-label="Di Égida · Inicio">
        <span className="monograma" aria-hidden>D·É</span>
        <span className="marca-txt"><strong>Di Égida</strong><small>Tosca Bistró · SGI</small></span>
      </Link>
    );
  }
  const titulo = TITULOS.find(([r]) => ruta === r || ruta.startsWith(r.endsWith('/') ? r : `${r}/`) || ruta === r)?.[1] ?? 'Di Égida';
  return (
    <div className="marca">
      <Link href={arriba(ruta)} className="volver" aria-label="Volver">‹</Link>
      <Link href="/" className="monograma" aria-label="Inicio">D·É</Link>
      <span className="titulo-barra">{titulo}</span>
    </div>
  );
}
