'use client';
import { useState } from 'react';
import Link from 'next/link';
import { pesos } from '@/lib/formato';

// Ingeniería de menú (Kasavana y Smith, 1982): popularidad × margen $ por unidad.
// Popular: participación ≥ 70 % de la participación pareja (1/N). Margen alto: ≥ margen promedio
// ponderado por las unidades vendidas.
export type PuntoMatriz = { generico_id: string; nombre: string; seccion: string | null; unidades: number; margen_unit: number; pct_carta: number | null };
type Cuadrante = 'Estrella' | 'Caballo' | 'Rompecabezas' | 'Perro';
const COLOR: Record<Cuadrante, string> = { Estrella: 'var(--ok)', Caballo: 'var(--aviso)', Rompecabezas: 'var(--tinta)', Perro: 'var(--error)' };
const QUE_HACER: Record<Cuadrante, string> = {
  Estrella: 'Se vende mucho y deja buen margen: cuidar la receta y la presentación.',
  Caballo: 'Se vende mucho pero deja poco: revisar receta o subir precio con cuidado.',
  Rompecabezas: 'Deja buen margen pero se vende poco: moverlo en la carta o recomendarlo.',
  Perro: 'Se vende poco y deja poco: pensar en sacarlo o rehacerlo.',
};

export default function Matriz({ puntos }: { puntos: PuntoMatriz[] }) {
  const [sel, setSel] = useState<string | null>(null);
  if (puntos.length < 3) return <p className="suave">Hacen falta al menos 3 productos con ficha completa y ventas para armar la matriz.</p>;
  const total = puntos.reduce((t, p) => t + p.unidades, 0);
  const umbral = 0.7 / puntos.length;
  const margenProm = puntos.reduce((t, p) => t + p.unidades * p.margen_unit, 0) / total;
  const cuad = (p: PuntoMatriz): Cuadrante => {
    const pop = p.unidades / total >= umbral, alto = p.margen_unit >= margenProm;
    return pop && alto ? 'Estrella' : pop ? 'Caballo' : alto ? 'Rompecabezas' : 'Perro';
  };
  const maxS = Math.max(...puntos.map((p) => p.unidades / total)) * 1.08;
  const minM = Math.min(0, ...puntos.map((p) => p.margen_unit)), maxM = Math.max(...puntos.map((p) => p.margen_unit)) * 1.08;
  const L = 52, R = 440, T = 14, B = 262;
  const x = (s: number) => L + (s / maxS) * (R - L), y = (m: number) => B - ((m - minM) / (maxM - minM)) * (B - T);
  const elegido = puntos.find((p) => p.generico_id === sel);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => minM + f * (maxM - minM));
  const conteo = puntos.reduce((m, p) => { m[cuad(p)] = (m[cuad(p)] ?? 0) + 1; return m; }, {} as Record<string, number>);

  return (
    <div>
      <svg viewBox="0 0 450 300" style={{ width: '100%', maxWidth: 560, height: 'auto', display: 'block' }} role="img" aria-label="Matriz de ingeniería de menú">
        <rect x={L} y={T} width={R - L} height={B - T} fill="none" stroke="var(--borde)" />
        <line x1={x(umbral)} x2={x(umbral)} y1={T} y2={B} stroke="var(--suave)" strokeDasharray="4 3" />
        <line x1={L} x2={R} y1={y(margenProm)} y2={y(margenProm)} stroke="var(--suave)" strokeDasharray="4 3" />
        {ticks.map((t) => <text key={t} x={L - 5} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--suave)">{Math.round(t / 1000)}k</text>)}
        <text x={L + 6} y={T + 14} fontSize="11" fontWeight="600" fill="var(--suave)">Rompecabezas</text>
        <text x={R - 6} y={T + 14} fontSize="11" fontWeight="600" fill="var(--suave)" textAnchor="end">Estrellas</text>
        <text x={L + 6} y={B - 6} fontSize="11" fontWeight="600" fill="var(--suave)">Perros</text>
        <text x={R - 6} y={B - 6} fontSize="11" fontWeight="600" fill="var(--suave)" textAnchor="end">Caballos</text>
        <text x={(L + R) / 2} y={292} fontSize="11" textAnchor="middle" fill="var(--suave)">Participación en lo vendido →</text>
        <text x={12} y={(T + B) / 2} fontSize="11" textAnchor="middle" fill="var(--suave)" transform={`rotate(-90 12 ${(T + B) / 2})`}>Margen por unidad →</text>
        {puntos.map((p) => (
          <circle key={p.generico_id} cx={x(p.unidades / total)} cy={y(p.margen_unit)} r={sel === p.generico_id ? 8 : 5.5}
                  fill={COLOR[cuad(p)]} fillOpacity={0.85} stroke="var(--tarjeta)" strokeWidth={1.5} style={{ cursor: 'pointer' }}
                  tabIndex={0} role="button" aria-label={p.nombre}
                  onClick={() => setSel(p.generico_id)} onKeyDown={(e) => { if (e.key === 'Enter') setSel(p.generico_id); }}>
            <title>{p.nombre}</title>
          </circle>
        ))}
      </svg>
      <p className="suave" style={{ fontSize: '.82rem', margin: '.2rem 0 .5rem' }}>
        {(['Estrella', 'Caballo', 'Rompecabezas', 'Perro'] as Cuadrante[]).map((c) => (
          <span key={c} style={{ marginRight: '.8rem', whiteSpace: 'nowrap' }}><span style={{ color: COLOR[c] }}>●</span> {c}s: {conteo[c] ?? 0}</span>))}
      </p>
      {elegido ? (
        <div className="tarjeta" style={{ fontSize: '.92rem' }}>
          <strong>{elegido.nombre}</strong> · <span style={{ color: COLOR[cuad(elegido)] }}>{cuad(elegido)}</span>
          <div className="suave">{elegido.unidades.toLocaleString('es-CO')} und ({(elegido.unidades / total * 100).toFixed(1)} %) · margen {pesos(elegido.margen_unit)} por unidad
            {elegido.pct_carta !== null && ` · ${elegido.pct_carta.toLocaleString('es-CO')} % de costo`}</div>
          <div style={{ marginTop: '.3rem' }}>{QUE_HACER[cuad(elegido)]}</div>
          <Link href={`/fichas/${elegido.generico_id}`} className="mini">Abrir la ficha</Link> · <Link href={`/consulta/simulador?producto=${elegido.generico_id}`} className="mini">Simular precio o receta</Link>
        </div>
      ) : <p className="suave" style={{ fontSize: '.85rem' }}>Toque un punto para ver el producto.</p>}
    </div>
  );
}
