import FormLogin from './FormLogin';

export const metadata = { title: 'Entrar' };

export default async function Login({ searchParams }: { searchParams: Promise<{ volver?: string; error?: string; inactividad?: string }> }) {
  const { volver, error, inactividad } = await searchParams;
  return (
    <main className="centrado">
      <div className="tarjeta login">
        {/* monograma y tagline del sistema gráfico */}
        <div className="login-marca" aria-hidden>
          <span className="monograma">D·É</span>
          <span className="tagline">Territorio · Ritual · Elegancia</span>
        </div>
        <h1>SGI Di Égida</h1>
        <p className="suave">Cada persona entra con su usuario: lo que registra queda a su nombre.</p>
        <FormLogin volver={volver || '/'}
                   aviso={error === 'sin-perfil' ? 'Su usuario no tiene un perfil activo. Pídale a administración que lo active.'
                     : inactividad ? 'La sesión se cerró por inactividad. Entre de nuevo: lo que tenía a medias sigue guardado en este equipo.' : undefined} />
      </div>
    </main>
  );
}
