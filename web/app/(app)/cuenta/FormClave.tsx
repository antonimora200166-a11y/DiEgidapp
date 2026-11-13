'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { cambiarClave, type EstadoClave } from './acciones';

export default function FormClave({ temporal }: { temporal: boolean }) {
  const [estado, accion, enviando] = useActionState<EstadoClave, FormData>(cambiarClave, {});
  if (estado.ok) {
    return (
      <div className="tarjeta">
        <p className="exito mt-0" role="status">Listo: su contraseña cambió. Úsela la próxima vez que entre.</p>
        <Link className="boton" href="/">Ir al inicio</Link>
      </div>
    );
  }
  return (
    <form action={accion} className="tarjeta">
      <label htmlFor="actual">{temporal ? 'Contraseña temporal (la que le dio administración)' : 'Contraseña actual'}</label>
      <input id="actual" name="actual" type="password" autoComplete="current-password" required />
      <label htmlFor="nueva">Contraseña nueva <span className="ayuda">mínimo 8 caracteres; solo usted la conoce</span></label>
      <input id="nueva" name="nueva" type="password" autoComplete="new-password" minLength={8} required />
      <label htmlFor="repetida">Repita la contraseña nueva</label>
      <input id="repetida" name="repetida" type="password" autoComplete="new-password" minLength={8} required />
      {estado.error && <p className="error" role="alert">{estado.error}</p>}
      <div className="acciones"><button type="submit" disabled={enviando}>{enviando ? 'Cambiando…' : 'Cambiar contraseña'}</button></div>
    </form>
  );
}
