'use client';
import { useActionState } from 'react';
import { entrar, type EstadoLogin } from './acciones';

export default function FormLogin({ volver, aviso }: { volver: string; aviso?: string }) {
  const [estado, accion, enviando] = useActionState<EstadoLogin, FormData>(entrar, {});
  return (
    <form action={accion}>
      <input type="hidden" name="volver" value={volver} />
      <label htmlFor="usuario">Usuario</label>
      <input id="usuario" name="usuario" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
      <label htmlFor="clave">Contraseña</label>
      <input id="clave" name="clave" type="password" autoComplete="current-password" required />
      {(estado.error || aviso) && <p className="error" role="alert">{estado.error || aviso}</p>}
      <div className="acciones">
        <button type="submit" disabled={enviando} style={{ width: '100%' }}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </div>
    </form>
  );
}
