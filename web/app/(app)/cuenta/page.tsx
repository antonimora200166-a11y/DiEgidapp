import { perfilActual } from '@/lib/sesion';
import { nombreRol } from '@/lib/roles';
import FormClave from './FormClave';

export const metadata = { title: 'Mi cuenta' };

export default async function Cuenta() {
  const perfil = await perfilActual();
  return (
    <>
      <h1>Mi cuenta</h1>
      <p className="suave">{perfil.nombre} · usuario <span className="cod">{perfil.usuario ?? '—'}</span> · {nombreRol(perfil.rol)}</p>
      {perfil.debe_cambiar_clave && (
        <p className="aviso">Entraste con una contraseña temporal. Antes de seguir, ponle una tuya: lo que registres queda a tu nombre.</p>
      )}
      <h2>Cambiar contraseña</h2>
      <FormClave temporal={perfil.debe_cambiar_clave} />
      <p className="suave" style={{ fontSize: '.88rem' }}>¿La olvidaste? Pídele a administración que te dé una temporal desde la pantalla Usuarios.</p>
    </>
  );
}
