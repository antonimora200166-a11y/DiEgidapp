// Lector mínimo de .xlsx sin dependencias: descomprime el zip con zlib y devuelve, por hoja,
// un mapa celda → texto (cadenas compartidas, texto en línea y números). Sin fórmulas ni estilos.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

function entradasZip(buf) {
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error('No es un archivo zip/xlsx válido.');
  const n = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const archivos = new Map();
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10), tam = buf.readUInt32LE(p + 20);
    const ln = buf.readUInt16LE(p + 28), le = buf.readUInt16LE(p + 30), lc = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + ln);
    archivos.set(nombre, { metodo, tam, off });
    p += 46 + ln + le + lc;
  }
  return (nombre) => {
    const a = archivos.get(nombre);
    if (!a) return null;
    const ini = a.off + 30 + buf.readUInt16LE(a.off + 26) + buf.readUInt16LE(a.off + 28);
    const datos = buf.subarray(ini, ini + a.tam);
    return (a.metodo === 8 ? inflateRawSync(datos) : datos).toString('utf8');
  };
}

const xml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const textoDe = (frag) => xml([...frag.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

export function leerXlsx(ruta) {
  const leer = entradasZip(readFileSync(ruta));
  const compartidas = [...(leer('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoDe(m[1]));
  const wb = leer('xl/workbook.xml'), rels = leer('xl/_rels/workbook.xml.rels');
  const destino = new Map([...rels.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  return [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map(([, nombre, rid]) => {
    const t = destino.get(rid).replace(/^\/?(xl\/)?/, 'xl/');
    const hoja = leer(t) ?? '';
    const celdas = new Map();
    for (const m of hoja.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, ref, attrs, cuerpo = ''] = m;
      const tipo = /t="([^"]+)"/.exec(attrs)?.[1];
      let v = null;
      if (tipo === 'inlineStr') v = textoDe(cuerpo);
      else { const vv = /<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1]; if (vv !== undefined) v = tipo === 's' ? compartidas[Number(vv)] : xml(vv); }
      if (v !== null && String(v).trim() !== '' && v !== '#VALUE!') celdas.set(ref, String(v).replace(/\s+/g, ' ').trim());
    }
    return { nombre: xml(nombre), celdas };
  });
}

// «AB12» → { col: 28, fila: 12 }
export const posicion = (ref) => {
  const [, l, f] = /^([A-Z]+)(\d+)$/.exec(ref);
  return { col: [...l].reduce((t, c) => t * 26 + c.charCodeAt(0) - 64, 0), fila: Number(f) };
};
