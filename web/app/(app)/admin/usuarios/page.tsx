import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { nombreRol, type Perfil } from '@/lib/roles';
import Link from 'next/link';
import FormUsuario from './FormUsuario';
import Restablecer from './Restablecer';
import { cambiarActivo } from './acciones';

export const metadata = { title: 'Usuarios' };

export default async function Usuarios() {
  const yo = await perfilActual();
  if (yo.rol !== 'admin') redirect('/');
  const supabase = await supabaseServidor();
  const { data } = await supabase.from('perfiles').select('id, nombre, usuario, rol, areas, activo, debe_cambiar_clave').order('activo', { ascending: false }).order('nombre');
  const perfiles = (data ?? []) as Perfil[];
  return (
    <>
      <h1>Usuarios</h1>
      <FormUsuario />
      <h2>Equipo ({perfiles.filter((p) => p.activo).length} activos)</h2>
      <div className="desborde">
        <table className="tabla">
          <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Áreas</th><th></th></tr></thead>
          <tbody>
            {perfiles.map((p) => (
              <tr key={p.id} className={p.activo ? '' : 'suave'}>
                <td>
                  {p.nombre}
                  {p.debe_cambiar_clave && p.activo && <div className="suave" style={{ fontSize: '.8rem' }}>con contraseña temporal</div>}
                </td>
                <td className="cod">{p.usuario ?? '—'}</td>
                <td>{nombreRol(p.rol)}</td>
                <td>{p.rol === 'admin' ? 'Todas' : p.areas.join(', ') || '—'}</td>
                <td>
                  {p.id === yo.id ? <Link href="/cuenta">Mi cuenta</Link> : (
                    <div style={{ display: 'grid', gap: '.4rem' }}>
                      {p.activo && p.usuario && <Restablecer id={p.id} nombre={p.nombre} />}
                      <form action={cambiarActivo}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="activo" value={String(!p.activo)} />
                        <button type="submit" className="secundario">{p.activo ? 'Desactivar' : 'Activar'}</button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="suave">Un usuario desactivado no entra ni registra. Nada se borra: su historial queda en la bitácora.</p>
    </>
  );
}
