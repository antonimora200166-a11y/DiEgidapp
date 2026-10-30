'use client';
import { useState, useTransition } from 'react';
import type { Resultado } from '@/lib/catalogo';
import { decidirPar } from './acciones';

export type Lado = {
  fuente: string; nombre: string;
  generico: { id: string; codigo: string; nombre: string; unidad_base: string; estado: string; activo: boolean } | null;
  productos: { codigo: string; marca: string; presentacion: string; activo: boolean }[];
};
export type Par = {
  id: string; area: string; tipo: string; parecido: number; propuesta: string; motivo: string | null; a: Lado; b: Lado;
};

const FUENTE: Record<string, string> = {
  CATALOGO_MAESTRO: 'Catálogo maestro (SGI-COSTOS)', 'INV-COC-001': 'Inventario de cocina', 'REC-COC': 'Recepción de cocina', 'REC-BAR': 'Recepción de bar',
};

function Columna({ titulo, lado }: { titulo: string; lado: Lado }) {
  const g = lado.generico;
  return (
    <div className="tarjeta" style={{ padding: '.75rem' }}>
      <div className="suave" style={{ fontSize: '.8rem' }}>{titulo} · {FUENTE[lado.fuente] ?? lado.fuente}</div>
      <strong style={{ display: 'block', fontSize: '1.05rem', margin: '.2rem 0' }}>{lado.nombre}</strong>
      {g ? (
        <>
          <div className="cod">
            {g.codigo} · {g.unidad_base} · <span className={`etiqueta ${g.activo ? g.estado.toLowerCase() : 'inactivo'}`}>{g.activo ? g.estado : 'INACTIVO'}</span>
          </div>
          {g.nombre !== lado.nombre && <div className="suave" style={{ fontSize: '.85rem' }}>Genérico: {g.nombre}</div>}
          <ul style={{ margin: '.4rem 0 0', paddingLeft: '1.1rem', fontSize: '.88rem' }}>
            {lado.productos.slice(0, 5).map((p) => (
              <li key={p.codigo} className={p.activo ? '' : 'suave'}>{[p.marca, p.presentacion].filter(Boolean).join(' · ') || 'sin presentación'}</li>
            ))}
            {lado.productos.length > 5 && <li className="suave">y {lado.productos.length - 5} más</li>}
          </ul>
        </>
      ) : <div className="suave">No quedó ubicado en el catálogo.</div>}
    </div>
  );
}

// Con unidades distintas se pregunta siempre en el sentido natural: cuántos g o ml pesa 1 und, o
// cuántos g pesa 1 ml (densidad). De ahí sale el factor «1 <unidad del que se absorbe> = factor
// <unidad del que queda>» que pide public.decidir_par.
function pregunta(queda: string, va: string): { texto: string; de: string; a: string; sugerido: string; factor: (x: number) => number } {
  const conteo = queda === 'und' || va === 'und';
  const de = conteo ? 'und' : 'ml';                              // la unidad de la que se pregunta «1 …»
  const a = conteo ? (queda === 'und' ? va : queda) : 'g';      // en qué se responde
  return {
    texto: conteo ? `¿Cuántos ${a} pesa o mide 1 unidad?` : '¿Cuántos g pesa 1 ml? (densidad; agua = 1)',
    de, a, sugerido: conteo ? '' : '1',
    factor: (x) => (va === de ? x : 1 / x),
  };
}
const num = (s: string) => { const n = Number(s.replace(',', '.')); return s.trim() === '' || !Number.isFinite(n) ? null : n; };

export default function TarjetaPar({ par }: { par: Par }) {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [enviando, iniciar] = useTransition();
  const [eligiendo, setEligiendo] = useState<'A' | 'B' | null>(null);   // lado que queda, mientras se pide el factor
  const [respuesta, setRespuesta] = useState('');
  const mismoGenerico = par.a.generico && par.b.generico && par.a.generico.id === par.b.generico.id;
  const ubDistinta = !mismoGenerico && par.a.generico && par.b.generico && par.a.generico.unidad_base !== par.b.generico.unidad_base;
  const decidir = (d: 'FUSIONAR' | 'SEPARAR', lado: 'A' | 'B' = 'A', factor: number | null = null) =>
    iniciar(async () => setResultado(await decidirPar(par.id, d, lado, factor)));
  // con unidades distintas, «quedar con …» primero pregunta la equivalencia
  const unir = (lado: 'A' | 'B') => {
    if (!ubDistinta) return decidir('FUSIONAR', lado);
    setEligiendo(lado);
    setRespuesta(pregunta(lado === 'A' ? par.a.generico!.unidad_base : par.b.generico!.unidad_base,
                          lado === 'A' ? par.b.generico!.unidad_base : par.a.generico!.unidad_base).sugerido);
  };
  const ladoQueda = eligiendo === 'A' ? par.a : par.b;
  const ladoVa = eligiendo === 'A' ? par.b : par.a;
  const p = eligiendo && ubDistinta ? pregunta(ladoQueda.generico!.unidad_base, ladoVa.generico!.unidad_base) : null;
  const x = num(respuesta);

  if (resultado?.ok) {
    return (
      <li className="tarjeta exito" style={{ margin: 0 }}>
        <strong>{par.a.nombre}</strong> / <strong>{par.b.nombre}</strong>: decidido.
        {resultado.avisos.length > 0 && <span className="suave"> {resultado.avisos.join(' ')}</span>}
      </li>
    );
  }
  return (
    <li className="tarjeta" style={{ margin: 0 }}>
      <div className="linea" style={{ marginBottom: '.6rem' }}>
        <span className="suave">{par.tipo === 'DUPLICADO' ? 'Duplicado exacto' : 'Se parecen'} · sugerencia: <strong>{par.propuesta === 'FUSIONAR' ? 'son el mismo' : par.propuesta === 'SEPARAR' ? 'son distintos' : 'revisar'}</strong></span>
        <span className="pct">{Math.round(par.parecido * 100)} %</span>
      </div>
      <div className="fila">
        <Columna titulo="A" lado={par.a} />
        <Columna titulo="B" lado={par.b} />
      </div>
      {par.motivo && <p className="suave" style={{ margin: '.6rem 0 0', fontSize: '.88rem' }}>{par.motivo}</p>}
      {mismoGenerico && <p className="suave" style={{ margin: '.6rem 0 0', fontSize: '.88rem' }}>Los dos ya son el mismo genérico: «son el mismo» desactiva el producto repetido.</p>}
      {ubDistinta && !eligiendo && (
        <p className="suave" style={{ margin: '.6rem 0 0', fontSize: '.88rem' }}>
          Van en unidades distintas ({par.a.generico!.unidad_base} / {par.b.generico!.unidad_base}). Si son el mismo, al unirlos te
          preguntaremos la equivalencia y los productos del que se absorbe pasan a la unidad del que queda.
          {(par.a.generico!.unidad_base === 'und') !== (par.b.generico!.unidad_base === 'und') && (
            <> Casi siempre conviene quedarse con el que va en <strong>{par.a.generico!.unidad_base === 'und' ? par.b.generico!.unidad_base : par.a.generico!.unidad_base}</strong> (lado {par.a.generico!.unidad_base === 'und' ? 'B' : 'A'}): se pesa o se mide con más precisión que por unidad.</>
          )}
        </p>
      )}
      {p && (
        <div className="aviso" style={{ marginBottom: 0 }}>
          <strong>Quedarse con «{ladoQueda.nombre}» ({ladoQueda.generico!.unidad_base})</strong> y pasar «{ladoVa.nombre}» desde {ladoVa.generico!.unidad_base}.
          <label htmlFor={`factor-${par.id}`}>{p.texto}</label>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
            <span style={{ whiteSpace: 'nowrap' }}>1 {p.de} =</span>
            <input id={`factor-${par.id}`} inputMode="decimal" value={respuesta} onChange={(e) => setRespuesta(e.target.value)} style={{ maxWidth: 140 }} autoFocus />
            <span>{p.a}</span>
          </div>
          <span className="ayuda">Pésalo si puedes (un limón, una botella llena sin el envase). Si el lado que se absorbe ya tiene kardex, no se puede cambiar su unidad.</span>
          <div className="acciones">
            <button type="button" disabled={enviando || !x || x <= 0} onClick={() => decidir('FUSIONAR', eligiendo!, p.factor(x!))}>
              {enviando ? 'Uniendo…' : 'Unir con esta equivalencia'}
            </button>
            <button type="button" className="secundario" disabled={enviando} onClick={() => setEligiendo(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {resultado && !resultado.ok && (
        <div className="error" role="alert">
          <ul style={{ margin: 0 }}>{[...resultado.fatales, ...resultado.avisos].map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
      {!eligiendo && (
        <div className="acciones" style={{ marginTop: '.8rem' }}>
          {mismoGenerico || !par.b.generico || !par.a.generico ? (
            <button type="button" disabled={enviando} onClick={() => decidir('FUSIONAR', 'A')}>Son el mismo</button>
          ) : (
            <>
              <button type="button" disabled={enviando} onClick={() => unir('A')}>Son el mismo · quedar con A</button>
              <button type="button" disabled={enviando} onClick={() => unir('B')} className="secundario">Quedar con B</button>
            </>
          )}
          <button type="button" disabled={enviando} onClick={() => decidir('SEPARAR')} className="secundario">Son distintos</button>
        </div>
      )}
    </li>
  );
}
