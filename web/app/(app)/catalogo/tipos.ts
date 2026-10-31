// Una fila de public.catalogo_filtrado, más si quien mira puede corregirla.
export type ProductoCatalogo = {
  id: string; codigo: string; generico_id: string; generico: string; marca: string; presentacion: string; area: 'BAR' | 'COCINA';
  tipo: 'MPe' | 'MPI' | 'SIN_COSTO' | 'BEBIDA' | 'PLATO'; categoria: string | null; categoria_nombre: string | null;
  unidad_base: 'g' | 'ml' | 'und'; unidad_compra: string; contenido_base: number | null; contenido_variable: boolean;
  conservacion: string | null; temp_max_llegada: number | null; estado: 'PROVISIONAL' | 'VALIDADO'; activo: boolean;
  clase_abc: string | null; costo_promedio: number | null; costo_referencia: number | null; saldo: number | null;
  con_kardex: boolean; sin_tara: boolean; creado_por: string | null; creado_en: string;
  grupo: string | null; total_grupo: number; total: number;
  edita: boolean;
};

export const NOMBRE_TIPO: Record<string, string> = { MPe: 'MPe · se compra', MPI: 'MPI · se produce', SIN_COSTO: 'Sin costo', BEBIDA: 'Cóctel o bebida', PLATO: 'Plato' };

// Lo que le falta a un producto para la operación
export function faltasDe(p: ProductoCatalogo): string[] {
  return [
    !p.categoria && 'categoría',
    !p.conservacion && 'conservación',
    (p.contenido_variable || !p.contenido_base) && 'factor de compra',
    p.costo_promedio === null && p.costo_referencia === null && p.tipo === 'MPe' && 'costo',
    p.sin_tara && 'tara',
  ].filter(Boolean) as string[];
}
