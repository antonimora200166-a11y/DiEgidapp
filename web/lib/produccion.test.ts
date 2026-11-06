// npm --prefix web test — mismos casos que supabase/tests/44_producir_v2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularLote, rendimientoFicha, vence } from './produccion.ts';

// Súper limón, lote PRO-2026-005 de SGI-COSTOS: limón 6.570 g a $5, ácido cítrico 547 g a $13, agua 4.500 g
const superLimon = [
  { gramos: 6570, base: 6570, costoBase: 5, sinCosto: false },
  { gramos: 547, base: 547, costoBase: 13, sinCosto: false },
  { gramos: 4500, base: 4500, costoBase: null, sinCosto: true },
];

test('entrada total y merma de proceso', () => {
  const l = calcularLote(superLimon, 7000, null);
  assert.equal(l.entrada, 11617);
  assert.equal(l.merma, 4617);
});

test('rendimiento = neto / entrada', () => {
  assert.equal(calcularLote(superLimon, 7000, null).rendimiento, 0.602565);
  assert.equal(calcularLote(superLimon, null, null).rendimiento, null);   // sin neto no hay rendimiento
});

test('desvío en puntos frente a la ficha y alerta sobre el umbral', () => {
  const l = calcularLote(superLimon, 7000, 0.54);             // ficha #1: 54 %
  assert.equal(l.desvioPp, 6.26);
  assert.equal(l.alerta, true);                                // > 5 pp
  assert.equal(calcularLote(superLimon, 7000, 0.58).alerta, false);   // +2,26 pp
  assert.equal(calcularLote(superLimon, 7000, 0.54, 10).alerta, false); // umbral configurado en 10
});

test('costo del lote = Σ cantidad × costo promedio; el agua vale $0', () => {
  const l = calcularLote(superLimon, 7000, null);
  assert.equal(l.costo, 39961);                                // 6570×5 + 547×13
  assert.equal(l.estado, 'COMPLETO');
});

test('$/g = costo del lote / neto', () => {
  assert.equal(calcularLote(superLimon, 7000, null).costoGramo, 5.708714);   // igual al registro de SGI-COSTOS
  assert.equal(calcularLote(superLimon, null, null).costoGramo, null);
});

test('un insumo sin costo deja el lote PARCIAL y sin $/g', () => {
  const l = calcularLote([...superLimon, { gramos: 100, base: 100, costoBase: null, sinCosto: false }], 7000, null);
  assert.equal(l.estado, 'PARCIAL');
  assert.equal(l.costoGramo, null);
  assert.equal(l.costo, 39961);
});

test('un insumo en ml usa su cantidad base para el costo y sus gramos para la entrada', () => {
  // licor neutro: 1.000 g pesados = 1.087 ml (densidad 0,92) a $20/ml
  const l = calcularLote([{ gramos: 1000, base: 1087, costoBase: 20, sinCosto: false }], 900, null);
  assert.equal(l.entrada, 1000);
  assert.equal(l.costo, 21740);
  assert.equal(l.costoGramo, 24.155556);
});

test('rendimiento esperado de la ficha', () => {
  assert.equal(rendimientoFicha(9342, [10000, 800, 6500]), 0.54);
  assert.equal(rendimientoFicha(null, [10000]), null);
  assert.equal(rendimientoFicha(9342, [10000, null]), null);
});

test('vence = fecha de producción + vida útil', () => {
  assert.equal(vence('2026-11-05', 90), '2027-02-03');
  assert.equal(vence('2026-12-30', 3), '2027-01-02');
  assert.equal(vence('2026-11-05', null), null);
});
