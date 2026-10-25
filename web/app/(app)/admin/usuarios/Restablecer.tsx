'use client';
import { useActionState } from 'react';
import { restablecerClave, type EstadoRestablecer } from './acciones';

export default function Restablecer({ id, nombre }: { id: string; nombre: string }) {
  const [estado, accion, enviando] = useActionState<EstadoRestablecer, FormData>(restablecerClave, {});
  if (estado.clave) {
    return (
      <div className="aviso" role="status" style={{ margin: 0 }}>
        Temporal de {nombre.split(' ')[0]}: <strong className="cod" style={{ fontSize: '1rem', color: 'inherit' }}>{estado.clave}</strong>
        <div className="suave" style={{ fontSize: '.8rem' }}>Díctasela en persona. Solo se muestra esta vez; al entrar pondrá una suya.</div>
      </div>
    );
  }
  return (
    <form action={accion} onSubmit={(e) => { if (!confirm(`¿Darle una contraseña temporal a ${nombre}? La actual dejará de servir.`)) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="secundario" disabled={enviando}>{enviando ? '…' : 'Restablecer contraseña'}</button>
      {estado.error && <div className="error" role="alert">{estado.error}</div>}
    </form>
  );
}
