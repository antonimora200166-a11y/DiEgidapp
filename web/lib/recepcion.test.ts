import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aUnidadesCompra, origenLinea, type PresentacionCompra } from './recepcion.ts';
import { costoUnitarioBase } from './costo.ts';

const azucar: PresentacionCompra = { unidad_base: 'g', unidad_compra: 'PAQ', contenido_base: 2500, contenido_variable: false };
const limonKg: PresentacionCompra = { unidad_base: 'g', unidad_compra: 'KG', contenido_base: 1000, contenido_variable: false };
const ginebra: PresentacionCompra = { unidad_base: 'ml', unidad_compra: 'BOT', contenido_base: 700, contenido_variable: false };
const pollo: PresentacionCompra = { unidad_base: 'g', unidad_compra: 'UND', contenido_base: null, contenido_variable: true };

test('la misma unidad de compra pasa tal cual', () => {
  assert.deepEqual(aUnidadesCompra(4, 'PAQ', azucar), { cantidad: 4, total_base: null, nota: null });
  assert.deepEqual(aUnidadesCompra(3, 'kg', limonKg), { cantidad: 3, total_base: null, nota: null });
  assert.deepEqual(aUnidadesCompra(2, 'UND', ginebra), { cantidad: 2, total_base: null, nota: null });
});

test('peso o volumen de la factura se pasa a unidades de compra', () => {
  assert.equal(aUnidadesCompra(10, 'KG', azucar).cantidad, 4);           // 10 kg = 4 bolsas de 2.500 g
  assert.equal(aUnidadesCompra(500, 'GR', limonKg).cantidad, 0.5);
  assert.equal(aUnidadesCompra(2, 'Lb', limonKg).cantidad, 1);            // libra colombiana: 500 g
  assert.equal(aUnidadesCompra(1.4, 'LT', ginebra).cantidad, 2);
});

test('la conversión no cambia el costo por unidad base', () => {
  const c = aUnidadesCompra(10, 'KG', azucar).cantidad!;
  assert.equal(costoUnitarioBase(52600, c, azucar.contenido_base), costoUnitarioBase(52600, 4, 2500));
});

test('unidades de otra dimensión no se convierten', () => {
  assert.deepEqual(aUnidadesCompra(2, 'LT', azucar), { cantidad: 2, total_base: null, nota: null });
  assert.deepEqual(aUnidadesCompra(2, null, azucar), { cantidad: 2, total_base: null, nota: null });
});

test('contenido variable: el peso de la factura es el total pesado', () => {
  const r = aUnidadesCompra(3.2, 'KG', pollo);
  assert.equal(r.cantidad, 1);
  assert.equal(r.total_base, 3200);
});

test('origen de la línea', () => {
  const ia = { producto_id: 'a', cantidad: 2, valor_total: 1000 };
  assert.equal(origenLinea(null, ia), 'MANUAL');
  assert.equal(origenLinea(ia, { ...ia }), 'IA_CONFIRMADA');
  assert.equal(origenLinea(ia, { ...ia, cantidad: 3 }), 'IA_CORREGIDA');
  assert.equal(origenLinea(ia, { ...ia, producto_id: 'b' }), 'IA_CORREGIDA');
});

test('lo que llega por pieza y se lleva en gramos se manda a pesar', () => {
  const repollo: PresentacionCompra = { unidad_base: 'g', unidad_compra: 'UNIDAD', contenido_base: null, contenido_variable: true };
  const sandiaGranel: PresentacionCompra = { unidad_base: 'g', unidad_compra: 'GR', contenido_base: 1, contenido_variable: false };
  const azucar: PresentacionCompra = { unidad_base: 'g', unidad_compra: 'PAQ', contenido_base: 2500, contenido_variable: false };
  assert.equal(aUnidadesCompra(4, 'UNIDAD', repollo).pesar, true);
  assert.equal(aUnidadesCompra(1, 'UNIDAD', sandiaGranel).pesar, true);
  assert.equal(aUnidadesCompra(4, 'PAQUETE', azucar).pesar, undefined);   // misma pieza con contenido fijo
  assert.equal(aUnidadesCompra(4, 'LIBRA', repollo).pesar, undefined);    // viene en peso: 2.000 g
  const cilantro: PresentacionCompra = { unidad_base: 'g', unidad_compra: 'UNIDAD', contenido_base: 109, contenido_variable: false };
  assert.equal(aUnidadesCompra(4, 'UNIDAD', cilantro).pesar, true);       // 109 g es un promedio
});

test('media libra y el peso escrito en la descripción', () => {
  const habichuela: PresentacionCompra = { unidad_base: 'g', unidad_compra: 'GR', contenido_base: 1, contenido_variable: false };
  const naranja: PresentacionCompra = { unidad_base: 'g', unidad_compra: 'BOLSA', contenido_base: 4000, contenido_variable: false };
  assert.equal(aUnidadesCompra(4, 'MEDIA LIBRA', habichuela).cantidad, 1000);
  const r = aUnidadesCompra(1, 'MALLA', naranja, 'NARANJA COMUN 2,5KG');
  assert.equal(r.cantidad, 0.625);   // 2.500 g de 4.000 g por bolsa
  assert.equal(r.pesar, undefined);
});
