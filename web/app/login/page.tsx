import FormLogin from './FormLogin';

export const metadata = { title: 'Entrar' };

export default async function Login({ searchParams }: { searchParams: Promise<{ volver?: string; error?: string; inactividad?: string }> }) {
  const { volver, error, inactividad } = await searchParams;
  return (
    <main className="centrado">
      <div className="tarjeta login">
        <h1>SGI Di Égida</h1>
        <p className="suave">Cada persona entra con su usuario: lo que registras queda a tu nombre.</p>
        <FormLogin volver={volver || '/'}
                   aviso={error === 'sin-perfil' ? 'Tu usuario no tiene un perfil activo. Pídele a administración que lo active.'
                     : inactividad ? 'La sesión se cerró por inactividad. Entra de nuevo: lo que tenías a medias sigue guardado en este equipo.' : undefined} />
      </div>
    </main>
  );
}
