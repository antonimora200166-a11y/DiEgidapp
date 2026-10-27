// Reglas de la pantalla Recibir que no dependen de la base: pasar la cantidad de la factura a
// unidades de compra del producto y decir si la persona confirmó o corrigió lo que leyó la IA.

export type PresentacionCompra = {
  unidad_base: 'g' | 'ml' | 'und'; unidad_compra: string; contenido_base: number | null; contenido_variable: boolean;
};

// Unidades de peso y volumen como aparecen en las facturas. La libra en Colombia es de 500 g.
const MEDIDAS: Record<string, { base: 'g' | 'ml'; factor: number }> = {
  KG: { base: 'g', factor: 1000 }, KGS: { base: 'g', factor: 1000 }, KILO: { base: 'g', factor: 1000 }, KILOS: { base: 'g', factor: 1000 },
  KL: { base: 'g', factor: 1000 }, G: { base: 'g', factor: 1 }, GR: { base: 'g', factor: 1 }, GRS: { base: 'g', factor: 1 },
  GRAMOS: { base: 'g', factor: 1 }, LB: { base: 'g', factor: 500 }, LIBRA: { base: 'g', factor: 500 }, LIBRAS: { base: 'g', factor: 500 },
  L: { base: 'ml', factor: 1000 }, LT: { base: 'ml', factor: 1000 }, LTS: { base: 'ml', factor: 1000 }, LITRO: { base: 'ml', factor: 1000 },
  LITROS: { base: 'ml', factor: 1000 }, ML: { base: 'ml', factor: 1 }, CC: { base: 'ml', factor: 1 },
};
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

// cantidad: unidades de compra que llegaron · total_base: peso o volumen total, solo para
// productos de contenido variable (se pesa en cada recepción) · nota: la conversión hecha.
export function aUnidadesCompra(cantidad: number | null, unidadFactura: string | null, p: PresentacionCompra):
  { cantidad: number | null; total_base: number | null; nota: string | null } {
  if (cantidad === null) return { cantidad: null, total_base: null, nota: null };
  const u = (unidadFactura ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  const m = MEDIDAS[u];
  if (!m || m.base !== p.unidad_base) return { cantidad, total_base: null, nota: null };
  const base = cantidad * m.factor;
  if (p.contenido_variable) {
    return { cantidad: 1, total_base: base, nota: `${cantidad} ${u} = ${base} ${p.unidad_base} en total: indica cuántas unidades llegaron.` };
  }
  if (!p.contenido_base || u === p.unidad_compra.toUpperCase()) return { cantidad, total_base: null, nota: null };
  const q = r4(base / p.contenido_base);
  return { cantidad: q, total_base: null, nota: `${cantidad} ${u} de la factura = ${q} ${p.unidad_compra}.` };
}

export type Origen = 'IA_CONFIRMADA' | 'IA_CORREGIDA' | 'MANUAL';
type Propuesto = { producto_id: string | null; cantidad: number | null; valor_total: number | null };

// La línea es de la IA si nació de la lectura; confirmada si la persona dejó producto, cantidad y
// valor tal como se propusieron.
export function origenLinea(ia: Propuesto | null, final: Propuesto): Origen {
  if (!ia) return 'MANUAL';
  return ia.producto_id === final.producto_id && ia.cantidad === final.cantidad && ia.valor_total === final.valor_total
    ? 'IA_CONFIRMADA' : 'IA_CORREGIDA';
}
