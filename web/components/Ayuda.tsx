// Ayuda plegable (GEN-11): las explicaciones largas quedan a un toque y no ocupan pantalla a quien ya sabe.
export default function Ayuda({ titulo = '¿Cómo funciona?', children }: { titulo?: string; children: React.ReactNode }) {
  return (
    <details className="ayuda-plegable">
      <summary><span aria-hidden className="ap-i">i</span>{titulo}</summary>
      <div className="ap-cuerpo">{children}</div>
    </details>
  );
}
