import { perfilActual } from '@/lib/sesion';
import { nombreRol } from '@/lib/roles';
import FormClave from './FormClave';
import Icono from '@/components/Icono';
import { salir } from '../../login/acciones';
import FormPin from './FormPin';
import { SelectorTema } from '@/components/Tema';
import { supabaseServidor } from '@/lib/supabase/server';

export const metadata = { title: 'Mi cuenta' };

export default async function Cuenta() {
  const perfil = await perfilActual();
  const supabase = await supabaseServidor();
  const [{ data: tienePin }, { data: exigePin }] = await Promise.all([supabase.rpc('tiene_pin'), supabase.rpc('exige_pin')]);
  const autoriza = ['admin', 'jefe_bar', 'chef'].includes(perfil.rol);
  return (
    <>
      <h1>Mi cuenta</h1>
      <p className="suave">{perfil.nombre} · usuario <span className="cod">{perfil.usuario ?? '—'}</span> · {nombreRol(perfil.rol)}</p>
      {perfil.debe_cambiar_clave && (
        <p className="aviso">Entró con una contraseña temporal. Antes de seguir, póngale una suya: lo que registre queda a su nombre.</p>
      )}
      <h2>Tema</h2>
      <SelectorTema />
      <p className="suave" style={{ fontSize: '.88rem' }}>Se guarda en este equipo. «Automático» sigue al celular o iPad; en la barra conviene «Oscuro».</p>
      <h2>Cambiar contraseña</h2>
      <FormClave temporal={perfil.debe_cambiar_clave} />
      <p className="suave" style={{ fontSize: '.88rem' }}>¿La olvidó? Pídale a administración que le dé una temporal desde la pantalla Usuarios.</p>
      {autoriza && (
        <>
          <h2>PIN para autorizar</h2>
          <p className="suave" style={{ fontSize: '.88rem', marginTop: 0 }}>
            {exigePin ? 'Se pide' : 'Cuando administración lo active, se pedirá'} al autorizar una cortesía y al anular un documento.
            {tienePin ? ' Ya tiene uno.' : ' Aún no tiene uno.'} ¿Lo olvidó? Administración lo borra y usted fija uno nuevo.
          </p>
          <FormPin tiene={tienePin === true} />
        </>
      )}
      <h2>Sesión</h2>
      <form action={salir}>
        <button type="submit" className="secundario peligro"><Icono nombre="salir" /> Salir de la app</button>
      </form>
      <p className="suave" style={{ fontSize: '.88rem' }}>En un celular compartido, salga al terminar el turno: lo que se registre después quedaría a su nombre.</p>
    </>
  );
}
