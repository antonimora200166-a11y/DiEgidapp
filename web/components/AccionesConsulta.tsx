import Link from 'next/link';

// Título de Consulta con el menú «Acciones» a la derecha (CONS-04): ver (pestañas y filtros) queda separado de
// hacer (cargar ventas, simular, redactar el informe, cerrar el período).
export default function AccionesConsulta({ area }: { area: string }) {
  return (
    <div className="cab-consulta pagina-ancha">
      <h1 className="titulo-gestion">Consulta</h1>
      <details className="menu-acciones">
        <summary>Acciones <span aria-hidden>▾</span></summary>
        <nav className="tarjeta" aria-label="Acciones de Consulta">
          <Link href="/consulta/ventas">Cargar ventas de Odoo<small>el reporte de la semana</small></Link>
          <Link href="/consulta/simulador">Simulador de carta<small>probar un precio o una receta</small></Link>
          <Link href="/consulta/informe">Informe quincenal<small>el resumen para gerencia</small></Link>
          <Link href={`/consulta/cerrar${area === 'BAR' || area === 'COCINA' ? `?area=${area}` : ''}`}>Cerrar un período<small>congela el costo real contra el teórico</small></Link>
        </nav>
      </details>
    </div>
  );
}
