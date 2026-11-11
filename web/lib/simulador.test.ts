// npm --prefix web test — fórmulas del simulador de carta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costoFicha, semaforo, simular, type ProductoSim, type MezclaSim } from './simulador.ts';

// Gin Sour de las pruebas de la base: 100 g de azúcar a $4 · carta $10.800 con 8 % → neto $10.000
const ginSour: ProductoSim = {
  lineas: [{ generico_id: 'az', nombre: 'Azúcar', unidad: 'g', cantidad: 100, costo: 400 }],
  precio: 10800, imp_pct: 8, meta_pct: 24, banda_pp: 3,
};

test('el costo escala con la cantidad de cada línea', () => {
  assert.equal(costoFicha(ginSour.lineas), 400);
  assert.equal(costoFicha(ginSour.lineas, { az: 75 }), 300);
  assert.equal(costoFicha([...ginSour.lineas, { generico_id: 'x', nombre: 'Sin costo', unidad: 'g', cantidad: 2, costo: null }]), null,
    'una línea sin costo deja la ficha sin costo');
});

test('semáforo igual al de la base: meta y banda', () => {
  assert.equal(semaforo(24, 24, 3), 'VERDE');
  assert.equal(semaforo(24.04, 24, 3), 'VERDE', 'se compara redondeado a un decimal');
  assert.equal(semaforo(27, 24, 3), 'AMARILLO');
  assert.equal(semaforo(27.1, 24, 3), 'ROJO');
  assert.equal(semaforo(null, 24, 3), null);
});

test('precio y receta nuevos: igual que guardar_propuesta en la base', () => {
  const r = simular(ginSour, { precio_nuevo: 12960, cantidades: { az: 75 } });
  assert.deepEqual([r.costo_actual, r.costo_nuevo, r.neto_actual, r.neto_nuevo, r.pct_actual, r.pct_nuevo],
                   [400, 300, 10000, 12000, 4, 2.5]);
  assert.deepEqual([r.margen_actual, r.margen_nuevo], [9600, 11700]);
  assert.equal(r.area, null, 'sin mezcla de ventas no hay efecto sobre el área');
});

test('precio para llegar a la meta, redondeado a los $100 de arriba', () => {
  // Margarita: costo $12.030 con meta 25 % → neto $48.120 → carta $51.969,60 → $52.000
  const m: ProductoSim = { lineas: [{ generico_id: 'm', nombre: 'Todo', unidad: 'und', cantidad: 1, costo: 12030 }],
                           precio: 45000, imp_pct: 8, meta_pct: 25, banda_pp: 3 };
  const r = simular(m, {});
  assert.equal(r.pct_actual, 28.9);
  assert.equal(r.semaforo_actual, 'ROJO', 'más de 3 puntos sobre la meta');
  assert.equal(r.precio_para_meta, 52000);
  assert.equal(simular(m, { precio_nuevo: 52000 }).semaforo_nuevo, 'VERDE');
});

test('efecto sobre el % teórico del área', () => {
  // área: $1.000.000 vendidos con ficha, $300.000 de costo teórico (30 %).
  // Gin Sour: 100 und, 10 a $0 (menús), facturó $900.000 (90 × $10.000), costo 100 × $400.
  const mezcla: MezclaSim = { unidades: 100, unidades_sin_valor: 10, valor_neto: 900000, completa: true,
                              costo_teorico_area: 300000, ventas_completas_area: 1000000 };
  const r = simular(ginSour, { precio_nuevo: 12960, cantidades: { az: 75 } }, mezcla);
  // costo: 300.000 − 40.000 + 30.000 = 290.000 · ventas: 1.000.000 − 900.000 + 1.080.000 = 1.180.000
  assert.deepEqual(r.area, { pct_actual: 30, pct_nuevo: 24.6, dif_pp: -5.4,
                             margen_periodo_actual: 700000, margen_periodo_nuevo: 890000, dif_margen: 190000 });
});

test('un producto que no tenía ficha completa entra al teórico con la simulación', () => {
  const mezcla: MezclaSim = { unidades: 10, unidades_sin_valor: 0, valor_neto: 100000, completa: false,
                              costo_teorico_area: 300000, ventas_completas_area: 1000000 };
  const r = simular(ginSour, {}, mezcla);
  // costo 300.000 + 4.000 · ventas 1.000.000 + 100.000
  assert.equal(r.area?.pct_nuevo, 27.6);
});

test('menos unidades vendidas si sube el precio', () => {
  const mezcla: MezclaSim = { unidades: 100, unidades_sin_valor: 0, valor_neto: 1000000, completa: true,
                              costo_teorico_area: 340000, ventas_completas_area: 1000000 };
  const r = simular(ginSour, { precio_nuevo: 10800, unidades_nuevas: 50 }, mezcla);
  // costo: 340.000 − 40.000 + 20.000 = 320.000 · ventas: 1.000.000 − 1.000.000 + 500.000
  assert.equal(r.area?.pct_nuevo, 64);
  assert.equal(r.area?.dif_margen, 500000 - 320000 - (1000000 - 340000));
});
