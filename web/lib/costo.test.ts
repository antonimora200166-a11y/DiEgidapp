// npm --prefix web test — mismos casos que supabase/tests/01_formula_promedio y 13_recepcion_costo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costoUnitarioBase, desvioPct, promedioTrasEntrada } from './costo.ts';

test('costo por unidad base de una línea de factura', () => {
  assert.equal(costoUnitarioBase(52600, 4, 2500), 5.26);          // 4 bolsas × 2.500 g
  assert.equal(costoUnitarioBase(744950, 5, 700), 744950 / 3500); // Tanqueray: $212,84/ml
  assert.equal(costoUnitarioBase(null, 4, 2500), null);           // sin valor
  assert.equal(costoUnitarioBase(13000, 0, 2500), null);          // no llegó
  assert.equal(costoUnitarioBase(13000, 1, null), null);          // contenido variable sin pesar
});

test('primera entrada: el promedio es su costo', () => {
  assert.equal(promedioTrasEntrada(0, null, 10, 100), 100);
  assert.equal(promedioTrasEntrada(0, null, 10000, 5.26), 5.26);
});

test('entrada con costo: promedio ponderado por cantidad', () => {
  assert.equal(promedioTrasEntrada(10, 100, 10, 200), 150);
  assert.equal(promedioTrasEntrada(7000, 200, 7000, 230), 215);
  assert.equal(promedioTrasEntrada(10000, 5.26, 5000, 5.5), 5.34);    // 2.ª compra de azúcar
  assert.equal(promedioTrasEntrada(15000, 5.34, 5000, 5.2), 5.305);   // 3.ª compra de azúcar
});

test('entrada sin costo conserva el promedio', () => {
  assert.equal(promedioTrasEntrada(10, 150, 5, null), 150);
  assert.equal(promedioTrasEntrada(0, null, 5, null), null);
});

test('con saldo negativo el promedio arranca en el costo de la entrada', () => {
  assert.equal(promedioTrasEntrada(-3, 120, 10, 200), 200);
});

test('redondeo a 6 decimales, como la base', () => {
  assert.equal(promedioTrasEntrada(2, 1, 1, 2), 1.333333);
});

test('una entrada de cantidad cero se rechaza', () => {
  assert.throws(() => promedioTrasEntrada(10, 100, 0, 100), /mayor que cero/);
});

test('desvío frente a la referencia', () => {
  assert.equal(desvioPct(5.5, 5.26), 5);
  assert.equal(desvioPct(4, 5), -20);
  assert.equal(desvioPct(4, null), null);
});
