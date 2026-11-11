// Simulador de carta: qué pasa con el % de costo y el margen de un producto, y con el % teórico
// de su área, si cambia el precio o las cantidades de la ficha. Funciones puras: las usa la
// pantalla para responder al instante y la acción del servidor para guardar la propuesta.
// La base vuelve a calcular el costo nuevo desde la ficha vigente (privado.costo_simulado).

export type LineaSim = { generico_id: string; nombre: string; unidad: string; cantidad: number; costo: number | null };

export type ProductoSim = {
  lineas: LineaSim[];
  precio: number | null;        // carta con impuesto
  imp_pct: number;              // impoconsumo
  meta_pct: number | null;
  banda_pp: number | null;
};

// la mezcla de ventas del área en el período de referencia (consulta_ventas)
export type MezclaSim = {
  unidades: number;             // del producto, incluidas las que salieron a $0
  unidades_sin_valor: number;
  valor_neto: number;           // lo que facturó el producto (sin impuesto)
  completa: boolean;            // si su costo ya entraba en el teórico del área
  costo_teorico_area: number;
  ventas_completas_area: number;
};

export type CambiosSim = { precio_nuevo?: number | null; cantidades?: Record<string, number>; unidades_nuevas?: number | null };

export type Semaforo = 'VERDE' | 'AMARILLO' | 'ROJO' | null;

export type ResultadoSim = {
  costo_actual: number | null; costo_nuevo: number | null;
  neto_actual: number | null; neto_nuevo: number | null;
  pct_actual: number | null; pct_nuevo: number | null;
  margen_actual: number | null; margen_nuevo: number | null;
  semaforo_actual: Semaforo; semaforo_nuevo: Semaforo;
  precio_para_meta: number | null;           // precio de carta (con impuesto) que deja el costo en la meta
  area: null | {
    pct_actual: number | null; pct_nuevo: number | null; dif_pp: number | null;
    margen_periodo_actual: number; margen_periodo_nuevo: number; dif_margen: number;
  };
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export function semaforo(pct: number | null, meta: number | null, banda: number | null): Semaforo {
  if (pct == null || meta == null) return null;
  const p = r1(pct);
  if (p <= meta) return 'VERDE';
  if (p <= meta + (banda ?? 0)) return 'AMARILLO';
  return 'ROJO';
}

export const netoDe = (precio: number | null | undefined, imp: number) => (precio && precio > 0 ? precio / (1 + imp / 100) : null);

// costo de la ficha con cantidades nuevas: cada línea escala con su cantidad; una línea sin costo deja el total sin calcular
export function costoFicha(lineas: LineaSim[], cantidades: Record<string, number> = {}): number | null {
  if (!lineas.length || lineas.some((l) => l.costo == null)) return null;
  return lineas.reduce((s, l) => {
    const nueva = cantidades[l.generico_id];
    if (nueva == null || nueva === l.cantidad) return s + (l.costo as number);
    return s + (l.cantidad > 0 ? (l.costo as number) * nueva / l.cantidad : 0);
  }, 0);
}

export function simular(p: ProductoSim, c: CambiosSim, m?: MezclaSim | null): ResultadoSim {
  const costoA = costoFicha(p.lineas);
  const costoN = costoFicha(p.lineas, c.cantidades);
  const precioN = c.precio_nuevo && c.precio_nuevo > 0 ? c.precio_nuevo : p.precio;
  const netoA = netoDe(p.precio, p.imp_pct), netoN = netoDe(precioN, p.imp_pct);
  const pctA = costoA != null && netoA ? costoA / netoA * 100 : null;
  const pctN = costoN != null && netoN ? costoN / netoN * 100 : null;

  let area: ResultadoSim['area'] = null;
  if (m && costoN != null) {
    const pagadas = m.unidades - m.unidades_sin_valor;
    const factor = m.unidades > 0 && c.unidades_nuevas != null && c.unidades_nuevas >= 0 ? c.unidades_nuevas / m.unidades : 1;
    const uN = m.unidades * factor, pagadasN = pagadas * factor;
    // lo facturado conserva la relación con la carta (descuentos): escala con el neto nuevo
    const valorN = netoA && m.valor_neto > 0 ? m.valor_neto * factor * (netoN ?? 0) / netoA : pagadasN * (netoN ?? 0);
    const quitaCosto = m.completa && costoA != null ? m.unidades * costoA : 0;
    const quitaVenta = m.completa ? m.valor_neto : 0;
    const costoAreaN = m.costo_teorico_area - quitaCosto + uN * costoN;
    const ventasAreaN = m.ventas_completas_area - quitaVenta + valorN;
    const pctAreaA = m.ventas_completas_area > 0 ? m.costo_teorico_area / m.ventas_completas_area * 100 : null;
    const pctAreaN = ventasAreaN > 0 ? costoAreaN / ventasAreaN * 100 : null;
    const margenA = m.ventas_completas_area - m.costo_teorico_area;
    const margenN = ventasAreaN - costoAreaN;
    area = {
      pct_actual: pctAreaA == null ? null : r1(pctAreaA), pct_nuevo: pctAreaN == null ? null : r1(pctAreaN),
      dif_pp: pctAreaA == null || pctAreaN == null ? null : r1(pctAreaN - pctAreaA),
      margen_periodo_actual: Math.round(margenA), margen_periodo_nuevo: Math.round(margenN), dif_margen: Math.round(margenN - margenA),
    };
  }

  const paraMeta = costoN != null && p.meta_pct ? costoN / (p.meta_pct / 100) * (1 + p.imp_pct / 100) : null;
  return {
    costo_actual: costoA == null ? null : Math.round(costoA), costo_nuevo: costoN == null ? null : Math.round(costoN),
    neto_actual: netoA == null ? null : Math.round(netoA), neto_nuevo: netoN == null ? null : Math.round(netoN),
    pct_actual: pctA == null ? null : r1(pctA), pct_nuevo: pctN == null ? null : r1(pctN),
    margen_actual: costoA != null && netoA ? Math.round(netoA - costoA) : null,
    margen_nuevo: costoN != null && netoN ? Math.round(netoN - costoN) : null,
    semaforo_actual: semaforo(pctA, p.meta_pct, p.banda_pp), semaforo_nuevo: semaforo(pctN, p.meta_pct, p.banda_pp),
    // redondeado a los $100 de arriba, como se ponen los precios de la carta
    precio_para_meta: paraMeta == null ? null : Math.ceil(paraMeta / 100) * 100,
    area,
  };
}
