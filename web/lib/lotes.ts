// Estados de un lote (privado.estado_lote) y cómo se muestran, para la lista y el detalle.
export type EstadoLote = 'ACTIVO' | 'POR_VENCER' | 'VENCIDO' | 'CONSUMIDO' | 'DADO_DE_BAJA' | 'REVERSADO' | 'HISTORICO';
export const ESTADO_LOTE: Record<EstadoLote, { t: string; c: string }> = {
  ACTIVO: { t: 'Activo', c: 'ok' }, POR_VENCER: { t: 'Por vencer', c: 'aviso' }, VENCIDO: { t: 'Vencido', c: 'error' },
  CONSUMIDO: { t: 'Consumido', c: 'gris' }, DADO_DE_BAJA: { t: 'Dado de baja', c: 'gris' }, REVERSADO: { t: 'Reversado', c: 'gris' },
  HISTORICO: { t: 'Histórico', c: 'info' },
};
