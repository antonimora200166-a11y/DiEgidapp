// Se muestra al instante al tocar un enlace, mientras el servidor arma la pantalla: la cabecera
// queda y el contenido aparece en cuanto llega.
export default function Cargando() {
  return (
    <div role="status" aria-label="Cargando" className="cargando">
      <div className="hueso" style={{ width: '45%', height: '1.8rem', marginBottom: '1rem' }} />
      <div className="hueso" style={{ width: '80%', height: '1rem', marginBottom: '1.4rem' }} />
      {[0, 1, 2, 3].map((i) => <div key={i} className="hueso" style={{ height: '4.5rem', marginBottom: '.7rem' }} />)}
    </div>
  );
}
