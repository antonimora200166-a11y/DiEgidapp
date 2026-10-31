'use client';
import { useActionState, useRef } from 'react';
import { restablecerClave, type EstadoRestablecer } from './acciones';
import { confirmar } from '@/components/Dialogo';

export default function Restablecer({ id, nombre }: { id: string; nombre: string }) {
  const [estado, accion, enviando] = useActionState<EstadoRestablecer, FormData>(restablecerClave, {});
  const confirmado = useRef(false);
  if (estado.clave) {
    return (
      <div className="aviso" role="status" style={{ margin: 0 }}>
        Temporal de {nombre.split(' ')[0]}: <strong className="cod" style={{ fontSize: '1rem', color: 'inherit' }}>{estado.clave}</strong>
        <div className="suave" style={{ fontSize: '.8rem' }}>Díctasela en persona. Solo se muestra esta vez; al entrar pondrá una suya.</div>
      </div>
    );
  }
  return (
    <form action={accion} onSubmit={async (e) => {
      if (confirmado.current) { confirmado.current = false; return; }
      e.preventDefault();
      const form = e.currentTarget;
      if (await confirmar(`¿Darle una contraseña temporal a ${nombre}? La actual dejará de servir.`, { aceptar: 'Restablecer' })) {
        confirmado.current = true; form.requestSubmit();
      }
    }}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="secundario" disabled={enviando}>{enviando ? '…' : 'Restablecer contraseña'}</button>
      {estado.error && <div className="error" role="alert">{estado.error}</div>}
    </form>
  );
}
