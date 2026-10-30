import Link from 'next/link';

export const metadata = { title: 'No encontrado' };

export default function NoEncontrado() {
  return (
    <div className="centrado" style={{ minHeight: '60dvh' }}>
      <div className="tarjeta login">
        <h1>No encontramos esa página</h1>
        <p className="suave">El enlace está mal escrito o el documento no existe.</p>
        <Link className="boton" href="/">Ir al inicio</Link>
      </div>
    </div>
  );
}
