'use client';
import { useActionState } from 'react';
import { fijarPin, type EstadoClave } from './acciones';

// PIN de 4 a 6 números para autorizar cortesías y anular: así una sesión abierta en el iPad
// no autoriza a nombre de otro. Para cambiarlo se pide el anterior.
export default function FormPin({ tiene }: { tiene: boolean }) {
  const [estado, accion, enviando] = useActionState<EstadoClave, FormData>(fijarPin, {});
  if (estado.ok) return <p className="exito" role="status">Listo: su PIN quedó guardado. No se lo diga a nadie.</p>;
  return (
    <form action={accion} className="tarjeta">
      {tiene && (
        <>
          <label className="mt-0" htmlFor="pin-anterior">PIN actual</label>
          <input id="pin-anterior" name="anterior" type="password" inputMode="numeric" autoComplete="off" maxLength={6} required />
        </>
      )}
      <label htmlFor="pin-nuevo" style={tiene ? undefined : { marginTop: 0 }}>
        {tiene ? 'PIN nuevo' : 'PIN'} <span className="ayuda">4 a 6 números, no seguidos ni repetidos</span>
      </label>
      <input id="pin-nuevo" name="pin" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4,6}" maxLength={6} required />
      <label htmlFor="pin-repetido">Repítalo</label>
      <input id="pin-repetido" name="repetido" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4,6}" maxLength={6} required />
      {estado.error && <p className="error" role="alert">{estado.error}</p>}
      <div className="acciones"><button type="submit" disabled={enviando}>{enviando ? 'Guardando…' : tiene ? 'Cambiar PIN' : 'Guardar PIN'}</button></div>
    </form>
  );
}
