// Roles de la app (enum public.rol_app del esquema aprobado) y lo que cada uno ve en el menú.
// Los permisos reales viven en la base (RLS y RPC): esto solo decide qué se muestra.
export type Rol = 'admin' | 'jefe_bar' | 'aux_bar' | 'chef' | 'sous_chef' | 'aux_cocina' | 'servicio' | 'auditor';
export type Area = 'BAR' | 'COCINA';

export const ROLES: { rol: Rol; nombre: string; areas: Area[] }[] = [
  { rol: 'jefe_bar', nombre: 'Jefe de barra', areas: ['BAR'] },
  { rol: 'aux_bar', nombre: 'Auxiliar de barra', areas: ['BAR'] },
  { rol: 'chef', nombre: 'Chef', areas: ['COCINA'] },
  { rol: 'sous_chef', nombre: 'Sous chef', areas: ['COCINA'] },
  { rol: 'aux_cocina', nombre: 'Auxiliar de cocina', areas: ['COCINA'] },
  { rol: 'servicio', nombre: 'Asesor de servicio', areas: [] },
  { rol: 'admin', nombre: 'Administración', areas: ['BAR', 'COCINA'] },
  { rol: 'auditor', nombre: 'Auditoría (solo lectura)', areas: [] },
];
export const nombreRol = (r: Rol) => ROLES.find((x) => x.rol === r)?.nombre ?? r;

export type Perfil = {
  id: string; nombre: string; usuario: string | null; rol: Rol; areas: Area[]; activo: boolean; debe_cambiar_clave: boolean;
};

// Áreas donde opera: el admin en todas (privado.opera_en)
export const areasDe = (p: Perfil): Area[] => (p.rol === 'admin' ? ['BAR', 'COCINA'] : p.areas);

// privado.puede_operar: registra hechos (recepción, conteo, alta provisional)
export const puedeOperar = (p: Perfil, a: Area) =>
  ['admin', 'jefe_bar', 'aux_bar', 'chef', 'sous_chef', 'aux_cocina'].includes(p.rol) && areasDe(p).includes(a);

// privado.edita_area: valida provisionales y edita maestros
export const editaArea = (p: Perfil, a: Area) =>
  p.rol === 'admin' || (a === 'BAR' && p.rol === 'jefe_bar') || (a === 'COCINA' && ['chef', 'sous_chef'].includes(p.rol));

export type Opcion = { ruta: string; titulo: string; detalle: string };
export function menuDe(p: Perfil): Opcion[] {
  const m: Opcion[] = [];
  if (areasDe(p).some((a) => puedeOperar(p, a))) m.push({ ruta: '/recibir', titulo: 'Recibir', detalle: 'Mercancía de proveedores, con foto de la factura' });
  if (areasDe(p).some((a) => puedeOperar(p, a))) m.push({ ruta: '/producir', titulo: 'Producir', detalle: 'Lotes de siropes, zumos y demás MPI, con su costo' });
  if (areasDe(p).some((a) => puedeOperar(p, a))) m.push({ ruta: '/trasladar', titulo: 'Trasladar', detalle: 'Mover mercancía entre zonas: bodega → barra' });
  if (areasDe(p).some((a) => puedeOperar(p, a))) m.push({ ruta: '/bajas', titulo: 'Bajas', detalle: 'Lo vencido, dañado o derramado' });
  if (areasDe(p).some((a) => puedeOperar(p, a))) m.push({ ruta: '/conteo', titulo: 'Contar', detalle: 'Conteo por zona (y el conteo inicial)' });
  if (p.rol !== 'servicio') m.push({ ruta: '/historial', titulo: 'Historial', detalle: 'Lo registrado, y anular lo que quedó mal' });
  if (p.rol !== 'servicio') m.push({ ruta: '/existencias', titulo: 'Existencias', detalle: 'Qué hay en cada zona y cuánto vale' });
  if (p.rol !== 'servicio') m.push({ ruta: '/fichas', titulo: 'Fichas técnicas', detalle: 'Recetas de MPI, cócteles y platos: corregirlas y crearlas' });
  if (p.rol !== 'servicio') m.push({ ruta: '/catalogo', titulo: 'Catálogo', detalle: 'Buscar productos y validar los provisionales' });
  if (areasDe(p).some((a) => puedeOperar(p, a))) m.push({ ruta: '/catalogo/nuevo', titulo: 'Crear producto', detalle: 'Alta provisional, con búsqueda de parecidos' });
  if (areasDe(p).some((a) => editaArea(p, a))) m.push({ ruta: '/catalogo/revision', titulo: 'Revisar duplicados', detalle: 'Decidir si dos productos son el mismo y unirlos' });
  if (p.rol === 'admin' || p.rol === 'auditor' || areasDe(p).some((a) => editaArea(p, a))) m.push({ ruta: '/arranque', titulo: '¿Listo para arrancar?', detalle: 'Lo que falta para operar con la app' });
  if (p.rol === 'admin') m.push({ ruta: '/admin/usuarios', titulo: 'Usuarios', detalle: 'Crear usuarios y asignar roles' });
  if (p.rol === 'admin' || p.rol === 'auditor') m.push({ ruta: '/admin/registro', titulo: 'Registro', detalle: 'Quién hizo qué, y los errores de la app' });
  return m;
}

// Se entra con usuario corto; Supabase Auth guarda un correo interno.
export const DOMINIO = process.env.NEXT_PUBLIC_DOMINIO_USUARIOS || 'usuarios.diegida.local';
export const correoDe = (usuario: string) => {
  const u = usuario.trim().toLowerCase();
  return u.includes('@') ? u : `${u}@${DOMINIO}`;
};
export const USUARIO_VALIDO = /^[a-z0-9][a-z0-9._-]{2,29}$/;
