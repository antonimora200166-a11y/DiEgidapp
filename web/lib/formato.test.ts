import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pesos, pesosU, pct, cantidad, conUnidad, fecha, fechaHora } from './formato.ts';

const sinNbsp = (s: string) => s.replace(/\u00a0/g, ' ');

test('pesos con punto de miles y espacio después del signo', () => {
  assert.equal(sinNbsp(pesos(1234567)), '$ 1.234.567');
  assert.equal(sinNbsp(pesos(-5433)), '-$ 5.433');
  assert.equal(pesos(null), '—');
  assert.equal(sinNbsp(pesosU(12.5)), '$ 12,50');
  assert.equal(sinNbsp(pesosU(4500)), '$ 4.500');
});

test('porcentaje con coma decimal y espacio', () => {
  assert.equal(pct(18.43), '18,4 %');
  assert.equal(pct(24), '24,0 %');
  assert.equal(pct(undefined), '—');
});

test('cantidades con unidad', () => {
  assert.equal(cantidad(2605), '2.605');
  assert.equal(conUnidad(2605, 'g'), '2.605 g');
  assert.equal(conUnidad(1.5, 'und'), '1,5 und');
});

test('fechas dd/mm/aaaa en hora de Cali', () => {
  assert.equal(fecha('2026-11-05'), '05/11/2026');
  assert.equal(fecha('2026-11-06T03:00:00Z'), '05/11/2026');   // 10 p. m. del 5 en Cali
  assert.equal(fecha(null), '—');
  assert.equal(fechaHora('2026-11-05T19:30:00Z'), '05/11/2026 14:30');
});
