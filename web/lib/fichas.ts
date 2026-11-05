// Formatos y tipos compartidos de las fichas técnicas (lista, detalle y editor).

export type Almacenamiento = { conservacion: 'Ambiente' | 'Refrigerado' | 'Congelado'; vida_util_dias: number; nota?: string | null };
export type TipoPunto = 'TEMPERATURA' | 'TIEMPO' | 'HIGIENE' | 'CALIDAD' | 'OTRO';
export type Punto = { tipo: TipoPunto; texto: string };

export const TIPOS_PUNTO: { v: TipoPunto; t: string; c: string }[] = [
  { v: 'TEMPERATURA', t: 'Temperatura', c: 'error' },
  { v: 'TIEMPO', t: 'Tiempo', c: 'info' },
  { v: 'HIGIENE', t: 'Higiene', c: 'ok' },
  { v: 'CALIDAD', t: 'Calidad', c: 'gris' },
  { v: 'OTRO', t: 'Otro', c: 'gris' },
];
export const tipoPunto = (t: string) => TIPOS_PUNTO.find((x) => x.v === t) ?? TIPOS_PUNTO[4];

// Los 14 alérgenos de declaración obligatoria, con los nombres que usa la cocina
export const ALERGENOS = ['Gluten', 'Crustáceos', 'Moluscos', 'Mariscos', 'Pescado', 'Huevo', 'Lácteos', 'Maní', 'Frutos secos',
  'Soya', 'Apio', 'Mostaza', 'Sésamo', 'Sulfitos', 'Altramuces'];
export const CONSERVACIONES: Almacenamiento['conservacion'][] = ['Refrigerado', 'Congelado', 'Ambiente'];

export const pesos = (n: number | null | undefined, dec?: number) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const d = dec ?? (Math.abs(v) < 100 ? 2 : 0);
  return '$' + v.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
};
export const pct = (r: number | null | undefined) =>
  r === null || r === undefined ? '—' : `${(Number(r) * 100).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
export const cant = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 });
export const vidaUtil = (a: Almacenamiento[]) =>
  a.map((x) => `${x.vida_util_dias} d ${x.conservacion === 'Refrigerado' ? 'refrig.' : x.conservacion === 'Congelado' ? 'cong.' : 'amb.'}`).join(' · ');
export const fechaLarga = (d: string) => new Date(d.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
