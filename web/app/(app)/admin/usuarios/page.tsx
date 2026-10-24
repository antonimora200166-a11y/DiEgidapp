import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { nombreRol, type Perfil } from '@/lib/roles';
import FormUsuario from './FormUsuario';
import { cambiarActivo } from './acciones';

export const metadata = { title: 'Usuarios' };

export default async function Usuarios() {
  const yo = await perfilActual();
  if (yo.rol !== 'admin') redirect('/');
  const supabase = await supabaseServidor();
  const { data } = await supabase.from('perfiles').select('id, nombre, usuario, rol, areas, activo').order('activo', { ascending: false }).order('nombre');
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
                <td>{p.nombre}</td>
                <td className="cod">{p.usuario ?? '—'}</td>
                <td>{nombreRol(p.rol)}</td>
                <td>{p.rol === 'admin' ? 'Todas' : p.areas.join(', ') || '—'}</td>
                <td>
                  {p.id !== yo.id && (
                    <form action={cambiarActivo}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="activo" value={String(!p.activo)} />
                      <button type="submit" className="secundario">{p.activo ? 'Desactivar' : 'Activar'}</button>
                    </form>
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
