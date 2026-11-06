// Cálculos de un lote de producción que la pantalla Producir muestra ANTES de guardar.
// Son una vista previa: el lote que vale es el que calcula public.registrar_lote con el kardex.
// Deben dar lo mismo: lib/produccion.test.ts y supabase/tests/44 usan los mismos casos.
//
// Todo se pesa en gramos (decisión de Anthony, 05/11/2026):
//   entrada total   = Σ pesos reales (g)
//   merma (g)       = entrada − neto
//   rendimiento     = neto / entrada
//   desvío (pp)     = (rendimiento real − rendimiento de la ficha) × 100; alerta si |desvío| > umbral
//   costo del lote  = Σ cantidad en unidad base × costo promedio vigente del insumo (lo sin costo vale $0)
//   $/g             = costo del lote / neto (g)
//   vence           = fecha de producción + vida útil del almacenamiento elegido

export type Pesada = {
  gramos: number;            // peso real usado
  base: number;              // lo mismo en la unidad base del insumo (g → ml con su densidad)
  costoBase: number | null;  // costo promedio vigente por unidad base (null = sin costo conocido)
  sinCosto: boolean;         // agua y subproductos ya pagados
};
export type Lote = {
  entrada: number; merma: number | null; rendimiento: number | null; desvioPp: number | null; alerta: boolean;
  costo: number; costoGramo: number | null; estado: 'COMPLETO' | 'PARCIAL';
};

const r = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

export function calcularLote(pesadas: Pesada[], netoGramos: number | null, rendimientoFicha: number | null, umbralPp = 5): Lote {
  let entrada = 0, costo = 0, parcial = false;
  for (const p of pesadas) {
    if (!(p.gramos > 0)) continue;
    entrada += p.gramos;
    if (p.sinCosto) continue;
    if (p.costoBase === null) parcial = true;
    else costo += p.base * p.costoBase;
  }
  const neto = netoGramos !== null && netoGramos > 0 ? netoGramos : null;
  const rendimiento = neto !== null && entrada > 0 ? neto / entrada : null;
  const desvioPp = rendimiento !== null && rendimientoFicha !== null && rendimientoFicha > 0 ? r((rendimiento - rendimientoFicha) * 100, 2) : null;
  return {
    entrada: r(entrada, 4),
    merma: neto !== null ? r(entrada - neto, 4) : null,
    rendimiento: rendimiento === null ? null : r(rendimiento, 6),
    desvioPp,
    alerta: desvioPp !== null && Math.abs(desvioPp) > umbralPp,
    costo: r(costo, 4),
    costoGramo: !parcial && neto !== null ? r(costo / neto, 6) : null,
    estado: parcial ? 'PARCIAL' : 'COMPLETO',
  };
}

// Rendimiento esperado de una ficha: neto esperado / Σ cantidades de la receta (unidad base).
export function rendimientoFicha(netoEsperado: number | null, cantidadesBase: (number | null)[]): number | null {
  if (!netoEsperado || netoEsperado <= 0 || !cantidadesBase.length || cantidadesBase.some((c) => c === null)) return null;
  const suma = (cantidadesBase as number[]).reduce((t, c) => t + c, 0);
  return suma > 0 ? netoEsperado / suma : null;
}

// fecha 'AAAA-MM-DD' + días → 'AAAA-MM-DD' (sin husos horarios de por medio)
export function vence(fecha: string, vidaUtilDias: number | null): string | null {
  if (!vidaUtilDias || vidaUtilDias <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + vidaUtilDias)).toISOString().slice(0, 10);
}
