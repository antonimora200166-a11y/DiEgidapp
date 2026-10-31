// npm --prefix web test — lo que entiende el conteo por voz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entenderDictado, type Candidato } from './voz.ts';

const zona: Candidato[] = [
  { id: 'gin', nombre: 'Ginebra Tanqueray · Botella 700 ml', cerradas: true, tara: true },
  { id: 'azucar', nombre: 'Azúcar blanca · Manuelita · Bolsa 2.500 g', cerradas: true, tara: false },
  { id: 'limon', nombre: 'Limón Tahití · Granel', cerradas: false, tara: false },
  { id: 'sirope', nombre: 'Sirope Simple · Granel', cerradas: false, tara: false },
];

test('producto, número y campo', () => {
  assert.deepEqual(entenderDictado('ginebra tres botellas', zona), { id: 'gin', campo: 'cerradas', valor: '3', nombre: zona[0].nombre });
  assert.deepEqual(entenderDictado('ginebra pesa 820', zona), { id: 'gin', campo: 'peso', valor: '820', nombre: zona[0].nombre });
  assert.deepEqual(entenderDictado('limón 1500', zona), { id: 'limon', campo: 'suelto', valor: '1500', nombre: zona[2].nombre });
});

test('números dictados en palabras y con decimales', () => {
  assert.equal((entenderDictado('azúcar dos bolsas', zona) as { valor: string }).valor, '2');
  assert.equal((entenderDictado('azucar tres y media bolsas', zona) as { valor: string }).valor, '3,5');
  assert.equal((entenderDictado('sirope 1,5', zona) as { valor: string }).valor, '1,5');
  assert.equal((entenderDictado('sirope 1 punto 5', zona) as { valor: string }).valor, '1,5');
});

test('sin tara no se cuenta por peso; sin presentación fija no hay cerradas', () => {
  assert.equal((entenderDictado('limón 3 bolsas', zona) as { campo: string }).campo, 'suelto');
  assert.equal((entenderDictado('azúcar pesa 900', zona) as { campo: string }).campo, 'suelto');
});

test('lo que no entiende lo dice', () => {
  assert.ok('error' in entenderDictado('ginebra', zona));
  assert.ok('error' in entenderDictado('vodka 3', zona));
  assert.ok('error' in entenderDictado('tres', zona));
});
