import type { Area } from './roles';

export type Parecido = {
  producto_id: string; generico_id: string; codigo: string; generico: string; marca: string; presentacion: string;
  area: Area; estado: 'PROVISIONAL' | 'VALIDADO'; activo: boolean; parecido: number; coincide_con: string;
};

// Respuesta de las RPC (privado.resultado): F = no se puede, B = se puede con motivo, avisos = informativo.
export type Resultado = { ok: boolean; id: string | null; codigo: string | null; fatales: string[]; bloqueos: string[]; avisos: string[] };

export const UMBRAL_BLOQUEO = 0.6;   // igual que public.crear_producto

// Envases de compra: etiqueta de la presentación y unidad de compra del kardex
export const ENVASES = [
  { etiqueta: 'Botella', unidad: 'BOT' }, { etiqueta: 'Lata', unidad: 'LATA' }, { etiqueta: 'Bolsa', unidad: 'BOLSA' },
  { etiqueta: 'Paquete', unidad: 'PAQ' }, { etiqueta: 'Caja', unidad: 'CJA' }, { etiqueta: 'Frasco', unidad: 'FCO' },
  { etiqueta: 'Tarro', unidad: 'TARRO' }, { etiqueta: 'Galón', unidad: 'GAL' }, { etiqueta: 'Bandeja', unidad: 'BAND' },
  { etiqueta: 'Unidad', unidad: 'UND' }, { etiqueta: 'Granel', unidad: '' },
] as const;

// Unidades en que se puede escribir el contenido, convertidas a la unidad base
export const UNIDADES_CONTENIDO: Record<'g' | 'ml' | 'und', { u: string; f: number }[]> = {
  g: [{ u: 'g', f: 1 }, { u: 'kg', f: 1000 }],
  ml: [{ u: 'ml', f: 1 }, { u: 'l', f: 1000 }],
  und: [{ u: 'und', f: 1 }],
};

export const fmtCantidad = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 3 });
