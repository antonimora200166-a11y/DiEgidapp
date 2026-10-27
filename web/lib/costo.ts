// Fórmulas de costo que la pantalla muestra ANTES de guardar. Son una vista previa: el costo que
// vale es el que calcula la base (privado.nuevo_promedio y registrar_recepcion). Deben dar lo
// mismo; lib/costo.test.ts usa los mismos casos que supabase/tests/01 y 13.

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

// $ por unidad base de una línea de factura: valor / (cantidad × contenido de la presentación).
// null si no hay con qué calcularlo (cantidad 0, sin valor o sin contenido).
export function costoUnitarioBase(valorTotal: number | null, cantidad: number | null, contenidoBase: number | null): number | null {
  if (valorTotal === null || cantidad === null || contenidoBase === null) return null;
  if (!(valorTotal > 0) || !(cantidad > 0) || !(contenidoBase > 0)) return null;
  return valorTotal / (cantidad * contenidoBase);
}

// Promedio ponderado móvil después de una ENTRADA con costo (privado.nuevo_promedio):
//   A' = (Q·A + q·c) / (Q + q);  sin promedio previo o con saldo ≤ 0, A' = c;  entrada sin costo, A' = A.
export function promedioTrasEntrada(saldoPrevio: number, promedioPrevio: number | null, cantidad: number, costoUnitario: number | null): number | null {
  if (!(cantidad > 0)) throw new Error('La cantidad de una entrada debe ser mayor que cero.');
  if (costoUnitario === null) return promedioPrevio;
  if (promedioPrevio === null || saldoPrevio <= 0) return r6(costoUnitario);
  return r6((saldoPrevio * promedioPrevio + cantidad * costoUnitario) / (saldoPrevio + cantidad));
}

// Desvío de un precio frente a una referencia, en % con signo (la ficha muestra «+12 %»).
export function desvioPct(costo: number, referencia: number | null): number | null {
  if (referencia === null || !(referencia > 0)) return null;
  return Math.round((costo / referencia - 1) * 100);
}
