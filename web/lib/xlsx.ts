// Lector mínimo de .xlsx sin dependencias (mismo que scripts/migracion/leer_xlsx.mjs): descomprime
// el zip con zlib y devuelve, por hoja, un mapa celda → texto. Sin fórmulas ni estilos. Solo servidor.
import { inflateRawSync } from 'node:zlib';

export type Hoja = { nombre: string; celdas: Map<string, string> };

function entradasZip(buf: Buffer) {
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error('No es un archivo de Excel (.xlsx) válido.');
  const n = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const archivos = new Map<string, { metodo: number; tam: number; off: number }>();
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10), tam = buf.readUInt32LE(p + 20);
    const ln = buf.readUInt16LE(p + 28), le = buf.readUInt16LE(p + 30), lc = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    archivos.set(buf.toString('utf8', p + 46, p + 46 + ln), { metodo, tam, off });
    p += 46 + ln + le + lc;
  }
  return (nombre: string) => {
    const a = archivos.get(nombre);
    if (!a) return null;
    const ini = a.off + 30 + buf.readUInt16LE(a.off + 26) + buf.readUInt16LE(a.off + 28);
    const datos = buf.subarray(ini, ini + a.tam);
    return (a.metodo === 8 ? inflateRawSync(datos) : datos).toString('utf8');
  };
}

const xml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const textoDe = (frag: string) => xml([...frag.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

export function leerXlsx(buf: Buffer): Hoja[] {
  const leer = entradasZip(buf);
  const compartidas = [...(leer('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoDe(m[1]));
  const wb = leer('xl/workbook.xml'), rels = leer('xl/_rels/workbook.xml.rels');
  if (!wb || !rels) throw new Error('El archivo no tiene hojas de Excel.');
  const destino = new Map([...rels.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  return [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map(([, nombre, rid]) => {
    const t = (destino.get(rid) ?? '').replace(/^\/?(xl\/)?/, 'xl/');
    const hoja = leer(t) ?? '';
    const celdas = new Map<string, string>();
    for (const m of hoja.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, ref, attrs, cuerpo = ''] = m;
      const tipo = /t="([^"]+)"/.exec(attrs)?.[1];
      let v: string | null = null;
      if (tipo === 'inlineStr') v = textoDe(cuerpo);
      else { const vv = /<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1]; if (vv !== undefined) v = tipo === 's' ? compartidas[Number(vv)] : xml(vv); }
      if (v !== null && String(v).trim() !== '') celdas.set(ref, String(v).replace(/\s+/g, ' ').trim());
    }
    return { nombre: xml(nombre), celdas };
  });
}

// «AB12» → { col: 28, fila: 12 }
export const posicion = (ref: string) => {
  const [, l, f] = /^([A-Z]+)(\d+)$/.exec(ref)!;
  return { col: [...l].reduce((t, c) => t * 26 + c.charCodeAt(0) - 64, 0), fila: Number(f) };
};
