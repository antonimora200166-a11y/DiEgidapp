// npm --prefix web test — el escritor de .xlsx se lee de vuelta con el lector de la app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columna, crearXlsx } from './xlsx-escribir.ts';
import { leerXlsx } from './xlsx.ts';

test('columnas de Excel', () => {
  assert.deepEqual([0, 25, 26, 51, 52, 701, 702].map(columna), ['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
});

test('ida y vuelta: textos con acentos y signos, números y vacíos', () => {
  const buf = crearXlsx([
    { nombre: 'Productos: bar/cocina', filas: [['Producto', 'Und', '% costo'], ['Piña & coco <especial>', 12, 24.5], ['Sin ventas', null, '']] },
    { nombre: 'Otra', filas: [['x']] },
  ]);
  const hojas = leerXlsx(buf);
  assert.equal(hojas.length, 2);
  const c = hojas[0].celdas;
  assert.equal(c.get('A2'), 'Piña & coco <especial>');
  assert.equal(c.get('B2'), '12');
  assert.equal(c.get('C2'), '24.5');
  assert.equal(c.get('B3'), undefined);
  assert.equal(hojas[1].celdas.get('A1'), 'x');
});
