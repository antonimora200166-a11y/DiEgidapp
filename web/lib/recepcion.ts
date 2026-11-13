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
  MEDIALIBRA: { base: 'g', factor: 250 }, MEDIALB: { base: 'g', factor: 250 }, ARROBA: { base: 'g', factor: 12500 },
  L: { base: 'ml', factor: 1000 }, LT: { base: 'ml', factor: 1000 }, LTS: { base: 'ml', factor: 1000 }, LITRO: { base: 'ml', factor: 1000 },
  LITROS: { base: 'ml', factor: 1000 }, ML: { base: 'ml', factor: 1 }, CC: { base: 'ml', factor: 1 },
};
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

// Lo que en la factura se vende por pieza: no dice cuánto pesa
const POR_PIEZA = new Set(['UNIDAD', 'UNIDADES', 'UND', 'UNDS', 'UN', 'U', 'UNI', 'PIEZA', 'PZA', 'ATADO', 'MANOJO', 'MALLA', 'CANASTILLA',
  'BOLSA', 'PAQUETE', 'PAQ', 'CAJA', 'CJA', 'TARRINA', 'BANDEJA', 'RACIMO']);
// «NARANJA COMUN 2,5KG» con MALLA: cada malla trae 2.500 g
const PESO_EN_NOMBRE = /(\d+(?:[.,]\d+)?)\s*(KG|KGS|KILO|KILOS|G|GR|GRS|LB|LIBRAS?|ML|LT|LTS|L)\b/i;

// cantidad: unidades de compra que llegaron · total_base: peso o volumen total, para productos de
// contenido variable y para lo que llega por pieza y se lleva en g o ml · pesar: hay que pesarlo
// (la factura solo dice cuántas piezas) · nota: la conversión hecha.
export function aUnidadesCompra(cantidad: number | null, unidadFactura: string | null, p: PresentacionCompra, descripcion?: string | null):
  { cantidad: number | null; total_base: number | null; nota: string | null; pesar?: boolean } {
  if (cantidad === null) return { cantidad: null, total_base: null, nota: null };
  let u = (unidadFactura ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  let m = MEDIDAS[u];
  // por pieza, pero el peso viene en la descripción: se toma ese peso por pieza
  const enNombre = !m && descripcion ? PESO_EN_NOMBRE.exec(descripcion) : null;
  if (enNombre) {
    const mm = MEDIDAS[enNombre[2].toUpperCase().replace(/S$/, '') === 'LIBRA' ? 'LIBRA' : enNombre[2].toUpperCase()];
    const porPieza = Number(enNombre[1].replace(',', '.'));
    if (mm && mm.base === p.unidad_base && porPieza > 0) {
      const base = r4(cantidad * porPieza * mm.factor);
      const q = p.contenido_variable || !p.contenido_base ? cantidad : r4(base / p.contenido_base);
      return { cantidad: q, total_base: p.contenido_variable ? base : null,
               nota: `${cantidad} ${u.toLowerCase() || 'pieza(s)'} de ${enNombre[0]} = ${base} ${p.unidad_base}${q !== cantidad ? ` (${q} ${p.unidad_compra})` : ''}.` };
    }
  }
  // llega por pieza y se lleva en g o ml: hay que pesarlo para saber cuánto entró de verdad. Una pieza
  // de un producto con contenido fijo (bolsa de azúcar de 2.500 g, botella de 700 ml) es su unidad de
  // compra y no se pesa; sí lo que se lleva a granel (contenido variable o de 1 g / 1 ml).
  // Lo que se compra por pieza suelta (UNIDAD) y se lleva en gramos también: el peso por unidad es un
  // promedio (un atado de cilantro no pesa siempre 109 g).
  const granel = p.contenido_variable || !p.contenido_base || p.contenido_base <= 1
    || ['UND', 'UNDS', 'UNIDAD', 'UNIDADES', 'UN', 'U'].includes(p.unidad_compra.toUpperCase());
  if (!m && p.unidad_base !== 'und' && (POR_PIEZA.has(u) || !u) && granel) {
    return { cantidad, total_base: null, pesar: true,
             nota: `La factura dice ${cantidad} ${u ? u.toLowerCase() : 'pieza(s)'}: péselas juntas y escriba el peso total en ${p.unidad_base}.` };
  }
  if (!m || m.base !== p.unidad_base) return { cantidad, total_base: null, nota: null };
  const base = cantidad * m.factor;
  if (p.contenido_variable) {
    return { cantidad: 1, total_base: base, nota: `${cantidad} ${u} = ${base} ${p.unidad_base} en total: indique cuántas unidades llegaron.` };
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
