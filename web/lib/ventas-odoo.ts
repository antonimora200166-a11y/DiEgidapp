// Lector de la tabla dinámica «Análisis del TPV» de Odoo (report.pos.order) descargada a Excel:
// productos en filas, días en columnas y, por día, las medidas (Cantidad de producto, Precio total,
// Pedido y, si se agregó, el subtotal sin impuestos). Decisión de Anthony (07/11/2026): cada lunes
// sube este archivo y la app lo lee sola.
// Si el archivo no trae la medida sin impuestos, el neto se estima con el impoconsumo (÷ 1,08) y la
// carga queda marcada como estimada.
import { posicion, type Hoja } from './xlsx.ts';

export type LineaVenta = { fecha: string; codigo: string; nombre: string; cantidad: number; valor_neto: number };
export type ReporteVentas = {
  desde: string; hasta: string; dias: string[]; lineas: LineaVenta[];
  total: number;              // total del reporte, en la misma medida que valor_neto
  netoEstimado: boolean;      // true: no traía subtotal sin impuestos
  productos: number; unidades: number;
  cuadre: { fecha: string; lineas: number; reporte: number }[];   // por día: suma de líneas vs. fila Total
};

const MESES: Record<string, string> = { ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06', jul: '07', ago: '08', sep: '09', set: '09', oct: '10', nov: '11', dic: '12' };
export function fechaOdoo(s: string): string | null {
  const m = /^(\d{1,2})\s+([a-záéíóú]{3})[a-záéíóú.]*\s+(\d{4})$/i.exec(s.trim());
  if (m) { const mes = MESES[m[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')]; if (mes) return `${m[3]}-${mes}-${m[1].padStart(2, '0')}`; }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

type Medida = 'cantidad' | 'neto' | 'bruto';
const medidaDe = (t: string): Medida | null =>
  /cantidad/i.test(t) ? 'cantidad' : /sin impuesto|subtotal|excl/i.test(t) ? 'neto' : /precio total|^total/i.test(t) ? 'bruto' : null;

export function leerTablaDinamica(hoja: Hoja, impoconsumoPct = 8): ReporteVentas {
  const filas = new Map<number, Map<number, string>>();
  for (const [ref, v] of hoja.celdas) {
    const { col, fila } = posicion(ref);
    if (!filas.has(fila)) filas.set(fila, new Map());
    filas.get(fila)!.set(col, v);
  }
  const nums = [...filas.keys()].sort((a, b) => a - b);
  const filaMedidas = nums.find((f) => [...filas.get(f)!.values()].some((v) => /cantidad de producto/i.test(v)));
  if (filaMedidas === undefined) throw new Error('No parece la tabla dinámica de ventas de Odoo: falta la medida «Cantidad de producto».');
  const filaDias = filas.get(filaMedidas - 1) ?? new Map<number, string>();

  // cada columna de medida pertenece al día cuya etiqueta está en esa columna o a su izquierda
  const etiquetas = [...filaDias.entries()].sort((a, b) => a[0] - b[0]);
  const columnas: { col: number; fecha: string; medida: Medida }[] = [];
  for (const [col, texto] of filas.get(filaMedidas)!) {
    const medida = medidaDe(texto);
    if (!medida) continue;
    const etiqueta = [...etiquetas].reverse().find(([c]) => c <= col)?.[1];
    const fecha = etiqueta ? fechaOdoo(etiqueta) : null;
    if (fecha) columnas.push({ col, fecha, medida });   // la columna «Total» del final no tiene fecha
  }
  if (!columnas.length) throw new Error('No encontré los días en el encabezado. En Odoo deje los días en las columnas.');
  const hayNeto = columnas.some((c) => c.medida === 'neto');
  const medidaValor: Medida = hayNeto ? 'neto' : 'bruto';
  const factor = hayNeto ? 1 : 1 / (1 + impoconsumoPct / 100);
  const dias = [...new Set(columnas.map((c) => c.fecha))].sort();

  const lineas: LineaVenta[] = [];
  const totalFila = new Map<string, number>();
  const sumaDia = new Map<string, number>();
  for (const f of nums.filter((n) => n > filaMedidas)) {
    const celdas = filas.get(f)!;
    const nombreCompleto = celdas.get(1);
    if (!nombreCompleto) continue;
    const esTotal = /^total$/i.test(nombreCompleto);
    const m = /^\[([^\]]+)\]\s*(.*)$/.exec(nombreCompleto);
    const codigo = m ? m[1].trim() : '', nombre = (m ? m[2] : nombreCompleto).trim();
    for (const fecha of dias) {
      const de = (medida: Medida) => {
        const c = columnas.find((x) => x.fecha === fecha && x.medida === medida);
        const v = c ? celdas.get(c.col) : undefined;
        return v === undefined ? null : Number(v);
      };
      const q = de('cantidad'), valor = de(medidaValor);
      if (esTotal) { if (valor !== null) totalFila.set(fecha, valor); continue; }
      if (q === null && valor === null) continue;
      lineas.push({ fecha, codigo, nombre, cantidad: q ?? 0, valor_neto: Math.round((valor ?? 0) * factor * 100) / 100 });
      sumaDia.set(fecha, (sumaDia.get(fecha) ?? 0) + (valor ?? 0));
    }
  }
  if (!lineas.length) throw new Error('La tabla no trae ventas.');
  const cuadre = dias.map((fecha) => ({ fecha, lineas: Math.round((sumaDia.get(fecha) ?? 0) * 100) / 100, reporte: totalFila.get(fecha) ?? NaN }));
  const total = Math.round([...totalFila.values()].reduce((t, v) => t + v, 0) * factor * 100) / 100;
  return {
    desde: dias[0], hasta: dias[dias.length - 1], dias, lineas, total, netoEstimado: !hayNeto,
    productos: new Set(lineas.map((l) => l.codigo || l.nombre)).size,
    unidades: lineas.reduce((t, l) => t + l.cantidad, 0), cuadre,
  };
}
