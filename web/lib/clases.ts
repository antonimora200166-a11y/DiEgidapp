// Qué es lo que se compra (genericos.clase, migración 38). En pantalla se elige junto con el
// tipo: desechable, aseo, menaje y herramienta se compran (tipo MPe) pero se comportan distinto.
export type Clase = 'MATERIA_PRIMA' | 'DESECHABLE' | 'ASEO' | 'MENAJE' | 'HERRAMIENTA';
export type TipoInsumo = 'MPe' | 'MPI' | Exclude<Clase, 'MATERIA_PRIMA'>;

export const TIPOS_INSUMO: { v: TipoInsumo; t: string; ayuda: string }[] = [
  { v: 'MPe', t: 'MPe · materia prima que se compra', ayuda: 'Alimentos y bebidas: van en fichas y en el costo del plato.' },
  { v: 'MPI', t: 'MPI · se produce aquí', ayuda: 'Siropes, salsas, fondos: tienen ficha y lote.' },
  { v: 'DESECHABLE', t: 'Desechable', ayuda: 'Vasos, pitillos, bolsas al vacío, film: se gastan y pueden ir en una ficha.' },
  { v: 'ASEO', t: 'Aseo y limpieza', ayuda: 'Jabones, desengrasante, cofias, bolsas de basura: gasto del área, no van en fichas.' },
  { v: 'MENAJE', t: 'Menaje', ayuda: 'Vajilla, cristalería, cubiertos, azafates: no se gastan; salen por baja (dañado / roto).' },
  { v: 'HERRAMIENTA', t: 'Herramienta o equipo', ayuda: 'Bar spoon, cuchillos, licuadora: no se gastan; salen por baja.' },
];

export const NOMBRE_CLASE: Record<Clase, string> = {
  MATERIA_PRIMA: 'Materia prima', DESECHABLE: 'Desechable', ASEO: 'Aseo y limpieza', MENAJE: 'Menaje', HERRAMIENTA: 'Herramienta o equipo',
};

// lo que se elige en pantalla → tipo y clase del genérico
export const deTipoInsumo = (v: TipoInsumo): { tipo: 'MPe' | 'MPI'; clase: Clase } =>
  v === 'MPe' || v === 'MPI' ? { tipo: v, clase: 'MATERIA_PRIMA' } : { tipo: 'MPe', clase: v };
export const aTipoInsumo = (tipo: string, clase: Clase | null | undefined): TipoInsumo =>
  tipo === 'MPe' && clase && clase !== 'MATERIA_PRIMA' ? clase : (tipo as TipoInsumo);
