export const metadata = { title: 'Sin conexión' };

export default function SinConexion() {
  return (
    <main className="centrado">
      <div className="tarjeta login">
        <h1>Sin conexión</h1>
        <p>Este equipo no tiene internet. Nada de lo que registres se guarda sin conexión: espera a que vuelva la red e inténtalo otra vez.</p>
        <a className="boton" href="/">Reintentar</a>
      </div>
    </main>
  );
}
