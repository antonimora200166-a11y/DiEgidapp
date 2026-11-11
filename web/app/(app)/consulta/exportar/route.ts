// Descarga en Excel de cada bloque de Consulta. Las cifras salen de las mismas funciones de la
// base que la pantalla (con sus permisos: solo administración). Cada lista del bloque es una hoja;
// los datos sueltos van en la hoja «Resumen».
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServidor } from '@/lib/supabase/server';
import { crearXlsx, type Celda, type HojaNueva } from '@/lib/xlsx-escribir';

type Fila = Record<string, unknown>;

const BLOQUES: Record<string, { titulo: string; rpc: string; args: (q: URLSearchParams) => Record<string, unknown> }> = {
  ventas:     { titulo: 'Ventas y costo teórico', rpc: 'consulta_ventas', args: (q) => ({ p_desde: q.get('desde'), p_hasta: q.get('hasta'), p_area: area(q) }) },
  periodo:    { titulo: 'Real contra teórico', rpc: 'periodo_vivo', args: (q) => ({ p_area: area(q) ?? 'BAR', p_desde: q.get('desde'), p_hasta: q.get('hasta') }) },
  cierre:     { titulo: 'Cierre de período', rpc: 'periodo_detalle', args: (q) => ({ p_id: q.get('id') }) },
  inventario: { titulo: 'Inventario', rpc: 'consulta_inventario', args: (q) => ({ p_area: area(q), p_desde: q.get('desde'), p_hasta: q.get('hasta') }) },
  compras:    { titulo: 'Compras', rpc: 'consulta_compras', args: (q) => ({ p_area: area(q), p_desde: q.get('desde'), p_hasta: q.get('hasta') }) },
  produccion: { titulo: 'Producción', rpc: 'consulta_produccion', args: (q) => ({ p_area: area(q), p_desde: q.get('desde'), p_hasta: q.get('hasta') }) },
  perdidas:   { titulo: 'Pérdidas', rpc: 'consulta_perdidas', args: (q) => ({ p_area: area(q), p_desde: q.get('desde'), p_hasta: q.get('hasta') }) },
  carta:      { titulo: 'Carta y margen', rpc: 'carta_margen', args: (q) => ({ p_area: area(q) }) },
  propuestas: { titulo: 'Propuestas de carta', rpc: 'propuestas_lista', args: (q) => ({ p_area: area(q) }) },
};

function area(q: URLSearchParams) { const a = q.get('area'); return a === 'BAR' || a === 'COCINA' ? a : null; }

// encabezados legibles: «ventas_netas» → «Ventas netas», «pct_carta» → «% carta»
const ENCABEZADO: Record<string, string> = { pct: '%', und: 'Und', cu: 'Costo unitario', cu_antes: 'Costo unitario antes', pp: 'pts' };
function encabezado(k: string) {
  const t = k.split('_').map((p) => ENCABEZADO[p] ?? p).join(' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const oculta = (k: string) => k === 'id' || k.endsWith('_id') || k === 'ingredientes' || k === 'puntos';

function celda(v: unknown): Celda {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (typeof v === 'string') return /^-?\d+(\.\d+)?$/.test(v) && v.length < 16 ? Number(v) : v;
  if (Array.isArray(v)) return v.every((x) => typeof x !== 'object') ? v.join(', ') : null;
  return null;
}

function hojaDeLista(nombre: string, lista: Fila[]): HojaNueva {
  const claves = [...new Set(lista.flatMap((f) => Object.keys(f)))].filter((k) => !oculta(k) && lista.some((f) => celda(f[k]) != null));
  return { nombre, filas: [claves.map(encabezado), ...lista.map((f) => claves.map((k) => celda(f[k])))] };
}

function libro(titulo: string, datos: unknown, q: URLSearchParams): HojaNueva[] {
  const resumen: Celda[][] = [['Dato', 'Valor'], ['Bloque', titulo], ['Área', area(q) ?? 'Todo'],
    ...(q.get('desde') ? [['Desde', q.get('desde')], ['Hasta', q.get('hasta')]] as Celda[][] : []),
    ['Exportado', new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })]];
  if (Array.isArray(datos)) return [{ nombre: 'Resumen', filas: resumen }, hojaDeLista(titulo, datos as Fila[])];
  const hojas: HojaNueva[] = [];
  const recorrer = (obj: Fila, prefijo = '') => {
    for (const [k, v] of Object.entries(obj)) {
      if (oculta(k)) continue;
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') hojas.push(hojaDeLista(encabezado(prefijo + k), v as Fila[]));
      else if (v && typeof v === 'object' && !Array.isArray(v)) recorrer(v as Fila, `${prefijo}${k}_`);
      else if (celda(v) != null) resumen.push([encabezado(prefijo + k), celda(v)]);
    }
  };
  if (datos && typeof datos === 'object') recorrer(datos as Fila);
  return [{ nombre: 'Resumen', filas: resumen }, ...hojas];
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const b = BLOQUES[q.get('bloque') ?? ''];
  if (!b) return NextResponse.json({ error: 'Bloque no válido.' }, { status: 400 });
  const supabase = await supabaseServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Inicia sesión.' }, { status: 401 });
  const { data, error } = await supabase.rpc(b.rpc, b.args(q));
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === '42501' ? 403 : 400 });
  const buf = crearXlsx(libro(b.titulo, data, q));
  const nombre = `${b.titulo} ${area(q) ?? ''} ${q.get('desde') ?? ''} ${q.get('hasta') ?? ''}`.replace(/\s+/g, ' ').trim();
  return new NextResponse(new Uint8Array(buf), { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(nombre)}.xlsx`,
    'Cache-Control': 'no-store',
  } });
}
