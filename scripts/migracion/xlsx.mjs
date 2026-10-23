// Lector mínimo de .xlsx sin dependencias: zip (zlib) + XML por expresiones regulares.
// Devuelve { hoja: [ { _fila: n, A: valor, B: valor, … } ] } con los valores ya calculados
// (para las celdas con fórmula, el último valor guardado por Excel/Sheets).
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

function leerZip(buf) {
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('No es un archivo zip/xlsx válido.');
  const total = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const archivos = {};
  for (let k = 0; k < total; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Directorio central dañado.');
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const lNombre = buf.readUInt16LE(p + 28), lExtra = buf.readUInt16LE(p + 30), lCom = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + lNombre);
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const datos = buf.subarray(ini, ini + tamComp);
    archivos[nombre] = () => (metodo === 0 ? datos : inflateRawSync(datos)).toString('utf8');
    p += 46 + lNombre + lExtra + lCom;
  }
  return archivos;
}

const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#10;/g, '\n').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const textos = (xml) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => dec(m[1])).join('');

export function leerXlsx(ruta) {
  const z = leerZip(readFileSync(ruta));
  const compartidos = z['xl/sharedStrings.xml']
    ? [...z['xl/sharedStrings.xml']().matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textos(m[1])) : [];
  const rels = {};
  for (const m of z['xl/_rels/workbook.xml.rels']().matchAll(/<Relationship [^>]*>/g)) {
    rels[/Id="([^"]+)"/.exec(m[0])[1]] = /Target="([^"]+)"/.exec(m[0])[1].replace(/^\/?xl\//, '');
  }
  const libro = {};
  for (const m of z['xl/workbook.xml']().matchAll(/<sheet [^>]*>/g)) {
    const nombre = dec(/name="([^"]+)"/.exec(m[0])[1]);
    const xml = z['xl/' + rels[/r:id="([^"]+)"/.exec(m[0])[1]]]();
    const filas = [];
    for (const r of xml.matchAll(/<row [^>]*?r="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const fila = { _fila: +r[1] };
      for (const c of (r[2] || '').matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const col = /r="([A-Z]+)\d+"/.exec(c[1])[1];
        const t = (/t="([^"]+)"/.exec(c[1]) || [])[1];
        const cuerpo = c[2] || '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(cuerpo);
        let val;
        if (t === 's') val = v ? compartidos[+v[1]] : undefined;
        else if (t === 'inlineStr') val = textos(cuerpo);
        else if (t === 'str' || t === 'e') val = v ? dec(v[1]) : undefined;
        else if (t === 'b') val = v ? v[1] === '1' : undefined;
        else val = v ? Number(v[1]) : undefined;
        if (val !== undefined && val !== '') fila[col] = typeof val === 'string' ? val.trim() : val;
      }
      filas.push(fila);
    }
    libro[nombre] = filas;
  }
  return libro;
}

// Fecha serial de Excel → 'AAAA-MM-DD'. Redondea al día más cercano: los motores guardaban
// «medianoche» en la zona del script, que la hoja muestra como las 22:00 del día anterior.
export function fechaExcel(n) {
  if (typeof n !== 'number') return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return d.toISOString().slice(0, 10);
}
