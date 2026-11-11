// npm --prefix web test — lector de la tabla dinámica de ventas de Odoo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fechaOdoo, leerTablaDinamica } from './ventas-odoo.ts';

// Igual a la tabla que bajó Anthony el 07/11/2026: fila 3 los días, fila 4 las medidas, fila 5 el total.
const hoja = (neto: boolean) => {
  const c = new Map<string, string>([
    ['B3', '01 oct 2026'], ['E3', '03 oct 2026'], ['H3', 'Total'],
    ['B4', 'Precio total'], ['C4', 'Pedido'], ['D4', 'Cantidad de producto'],
    ['E4', 'Precio total'], ['F4', 'Pedido'], ['G4', 'Cantidad de producto'],
    ['H4', 'Precio total'], ['I4', 'Pedido'], ['J4', 'Cantidad de producto'],
    ['A5', 'Total'], ['B5', '62000'], ['D5', '3'], ['E5', '18000'], ['G5', '1'], ['H5', '80000'], ['J5', '4'],
    ['A6', '[QUAF_BEB_5_007] Coctelería De Autor Pinky Promise'], ['B6', '55000'], ['C6', '1'], ['D6', '1'],
    ['A7', '[Quaf_MPe_0034] Coca Cola'], ['B7', '7000'], ['D7', '2'],
    ['A8', 'moktel\'s sin código'], ['E8', '18000'], ['G8', '1'],
  ]);
  if (neto) { c.set('K4', 'Subtotal sin impuestos'); }   // la medida neta en una columna sin día no cuenta
  return { nombre: 'Análisis del TPV', celdas: c };
};

test('fechas en el formato de Odoo', () => {
  assert.equal(fechaOdoo('01 oct 2026'), '2026-10-01');
  assert.equal(fechaOdoo('3 nov. 2026'), '2026-11-03');
  assert.equal(fechaOdoo('Total'), null);
});

test('lee productos por día y cuadra con la fila Total', () => {
  const r = leerTablaDinamica(hoja(false));
  assert.deepEqual(r.dias, ['2026-10-01', '2026-10-03']);
  assert.equal(r.desde, '2026-10-01');
  assert.equal(r.lineas.length, 3);
  assert.deepEqual(r.lineas[0], { fecha: '2026-10-01', codigo: 'QUAF_BEB_5_007', nombre: 'Coctelería De Autor Pinky Promise', cantidad: 1, valor_neto: 50925.93 });
  assert.equal(r.lineas[2].codigo, '');
  assert.deepEqual(r.cuadre.map((c) => c.lineas === c.reporte), [true, true]);
  assert.equal(r.netoEstimado, true);              // sin subtotal sin impuestos: ÷ 1,08
  assert.equal(r.total, 74074.07);                 // 80.000 / 1,08
  assert.equal(r.unidades, 4);
});
