// Nombres y formatos que comparten la lista y el detalle del historial.
export const NOMBRE_TIPO: Record<string, { singular: string; plural: string }> = {
  RECEPCION: { singular: 'Recepción', plural: 'Recepciones' },
  LOTE: { singular: 'Lote', plural: 'Producción' },
  BAJA: { singular: 'Baja', plural: 'Bajas' },
  TRASLADO: { singular: 'Traslado', plural: 'Traslados' },
  CONTEO: { singular: 'Conteo', plural: 'Conteos' },
};
export const pesos = (n: number, dec = 0) =>
  n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: dec, minimumFractionDigits: dec });
export const pesosU = (n: number) => pesos(n, Math.abs(n) < 100 ? 2 : 0);
export const cant = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: 3 }));
export const CONDICION: Record<string, string> = { OK: 'Bien', DANADO: 'Dañado', INCOMPLETO: 'Incompleto', NO_LLEGO: 'No llegó' };
export const CAUSA: Record<string, string> = { VENCIDO: 'Vencido', DANADO: 'Dañado', DERRAME: 'Derrame', MAL_ESTADO: 'Mal estado', OTRO: 'Otro' };
