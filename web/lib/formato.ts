// Formatos de Colombia para toda la app: $ 1.234.567 · 18,4 % · 2.605 g · 05/11/2026.
// Las pantallas no arman cifras ni fechas a mano: usan esto, para que se lean igual en todas partes.
const ZONA = 'America/Bogota';
const vacio = (n: unknown): n is null | undefined => n === null || n === undefined || !Number.isFinite(Number(n));

// Pesos sin decimales; dec para costos unitarios chicos ($ 12,50 por g)
export const pesos = (n: number | null | undefined, dec = 0) =>
  vacio(n) ? '—' : Number(n).toLocaleString('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: dec, maximumFractionDigits: dec });
// Costo por unidad base: dos decimales cuando vale menos de $ 100
export const pesosU = (n: number | null | undefined) => (vacio(n) ? '—' : pesos(n, Math.abs(Number(n)) < 100 ? 2 : 0));

// Porcentaje con una cifra decimal y espacio antes del signo: 18,4 %
export const pct = (n: number | null | undefined, dec = 1) =>
  vacio(n) ? '—' : `${Number(n).toLocaleString('es-CO', { minimumFractionDigits: dec, maximumFractionDigits: dec })} %`;

// Cantidad con punto de miles y hasta dec decimales; con unidad: 2.605 g
export const cantidad = (n: number | null | undefined, dec = 2) =>
  vacio(n) ? '—' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: dec });
export const conUnidad = (n: number | null | undefined, unidad: string, dec = 2) => (vacio(n) ? '—' : `${cantidad(n, dec)} ${unidad}`);

// Fecha dd/mm/aaaa. Acepta «2026-11-05» (día, sin hora) o una marca de tiempo (se lee en hora de Cali).
const aFecha = (s: string | Date) => (s instanceof Date ? s : new Date(s.length === 10 ? `${s}T12:00:00-05:00` : s));
export const fecha = (s: string | Date | null | undefined) =>
  !s ? '—' : aFecha(s).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: ZONA });
export const fechaHora = (s: string | Date | null | undefined) =>
  !s ? '—' : `${fecha(s)} ${aFecha(s).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA })}`;
