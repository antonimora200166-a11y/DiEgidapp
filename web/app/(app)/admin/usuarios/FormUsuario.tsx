'use client';
import { useActionState, useState } from 'react';
import { ROLES, type Rol } from '@/lib/roles';
import { crearUsuario, type EstadoUsuario } from './acciones';

export default function FormUsuario() {
  const [estado, accion, enviando] = useActionState<EstadoUsuario, FormData>(crearUsuario, {});
  const [rol, setRol] = useState<Rol>('aux_bar');
  const areasLibres = rol === 'admin' || rol === 'servicio' || rol === 'auditor';
  return (
    <form action={accion} className="tarjeta">
      <div className="fila">
        <div>
          <label htmlFor="nombre">Nombre completo</label>
          <input id="nombre" name="nombre" required />
        </div>
        <div>
          <label htmlFor="usuario">Usuario <span className="ayuda">minúsculas, sin espacios: frank.motato</span></label>
          <input id="usuario" name="usuario" autoCapitalize="none" autoCorrect="off" spellCheck={false} pattern="[a-z0-9][a-z0-9._\-]{2,29}" required />
        </div>
      </div>
      <div className="fila">
        <div>
          <label htmlFor="rol">Rol</label>
          <select id="rol" name="rol" value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
            {ROLES.map((r) => <option key={r.rol} value={r.rol}>{r.nombre}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="clave">Contraseña inicial <span className="ayuda">mínimo 8 caracteres</span></label>
          <input id="clave" name="clave" type="text" minLength={8} autoComplete="new-password" required />
        </div>
      </div>
      {areasLibres && (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, margin: '.9rem 0 .3rem' }}>Áreas <span className="ayuda">{rol === 'admin' ? 'el admin opera en todas' : 'dónde atiende o audita'}</span></legend>
          <div className="segmentos">
            {(['BAR', 'COCINA'] as const).map((a) => (
              <label key={a}><input type="checkbox" name="areas" value={a} defaultChecked={rol === 'admin'} /><span>{a === 'BAR' ? 'Bar' : 'Cocina'}</span></label>
            ))}
          </div>
        </fieldset>
      )}
      {estado.error && <p className="error" role="alert">{estado.error}</p>}
      {estado.ok && <p className="exito" role="status">{estado.ok}</p>}
      <div className="acciones"><button type="submit" disabled={enviando}>{enviando ? 'Creando…' : 'Crear usuario'}</button></div>
    </form>
  );
}
