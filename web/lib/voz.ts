// Conteo por voz: convierte lo dictado («absenta tres cerradas», «limón 1,5», «ginebra pesa 820»)
// en producto, campo y número. Solo propone: lo entendido se muestra y se puede deshacer.

export type CampoVoz = 'cerradas' | 'suelto' | 'peso';
export type Candidato = { id: string; nombre: string; cerradas: boolean; tara: boolean };
export type Dictado = { id: string; campo: CampoVoz; valor: string; nombre: string };

const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const NUMEROS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, cien: 100, media: 0.5, medio: 0.5,
};
const PALABRAS_CERRADAS = ['cerrada', 'cerradas', 'cerrado', 'cerrados', 'botella', 'botellas', 'paquete', 'paquetes', 'unidad', 'unidades', 'caja', 'cajas', 'bolsa', 'bolsas'];
const PALABRAS_PESO = ['pesa', 'peso', 'gramos', 'abierta', 'abierto'];
const RELLENO = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'hay', 'son', 'en', 'mas', 'punto', 'coma', 'x']);

// «tres y media», «1,5», «2.5», «doce» → número; null si no hay
function numeroDe(palabras: string[]): { n: number; usadas: Set<number> } | null {
  for (let i = palabras.length - 1; i >= 0; i--) {
    const w = palabras[i].replace(',', '.');
    if (/^\d+(\.\d+)?$/.test(w)) {
      // «1 punto 5» / «1 coma 5»
      if (i >= 2 && (palabras[i - 1] === 'punto' || palabras[i - 1] === 'coma') && /^\d+$/.test(palabras[i - 2])) {
        return { n: Number(`${palabras[i - 2]}.${w}`), usadas: new Set([i - 2, i - 1, i]) };
      }
      return { n: Number(w), usadas: new Set([i]) };
    }
    if (w in NUMEROS) {
      const usadas = new Set([i]);
      let n = NUMEROS[w];
      // «tres y media»
      if ((w === 'media' || w === 'medio') && i >= 2 && palabras[i - 1] === 'y' && palabras[i - 2] in NUMEROS) {
        n = NUMEROS[palabras[i - 2]] + 0.5; usadas.add(i - 1); usadas.add(i - 2);
      }
      return { n, usadas };
    }
  }
  return null;
}

export function entenderDictado(texto: string, candidatos: Candidato[]): Dictado | { error: string } {
  const palabras = sinTildes(texto).replace(/[^a-z0-9ñ.,\s]/g, ' ').split(/\s+/).filter(Boolean);
  const num = numeroDe(palabras);
  if (!num) return { error: `No entendí la cantidad en «${texto}».` };
  const resto = palabras.filter((_, i) => !num.usadas.has(i));
  const diceCerradas = resto.some((w) => PALABRAS_CERRADAS.includes(w));
  const dicePeso = resto.some((w) => PALABRAS_PESO.includes(w));
  const claves = resto.filter((w) => !RELLENO.has(w) && !PALABRAS_CERRADAS.includes(w) && !PALABRAS_PESO.includes(w) && w.length > 1);
  if (!claves.length) return { error: `No entendí qué producto en «${texto}».` };

  let mejor: { c: Candidato; puntos: number } | null = null;
  for (const c of candidatos) {
    const nombre = sinTildes(c.nombre).split(/[^a-z0-9ñ]+/).filter(Boolean);
    let puntos = 0;
    for (const k of claves) {
      if (nombre.includes(k)) puntos += 2;
      else if (k.length >= 4 && nombre.some((n) => n.startsWith(k.slice(0, 4)))) puntos += 1;
    }
    if (puntos > 0 && (!mejor || puntos > mejor.puntos || (puntos === mejor.puntos && c.nombre.length < mejor.c.nombre.length))) mejor = { c, puntos };
  }
  if (!mejor) return { error: `No encontré «${claves.join(' ')}» en esta zona.` };
  const campo: CampoVoz = dicePeso && mejor.c.tara ? 'peso' : diceCerradas && mejor.c.cerradas ? 'cerradas' : 'suelto';
  return { id: mejor.c.id, campo, valor: String(num.n).replace('.', ','), nombre: mejor.c.nombre };
}
