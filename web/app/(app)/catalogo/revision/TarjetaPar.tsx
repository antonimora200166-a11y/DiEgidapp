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

export default function TarjetaPar({ par }: { par: Par }) {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [enviando, iniciar] = useTransition();
  const mismoGenerico = par.a.generico && par.b.generico && par.a.generico.id === par.b.generico.id;
  const ubDistinta = !mismoGenerico && par.a.generico && par.b.generico && par.a.generico.unidad_base !== par.b.generico.unidad_base;
  const decidir = (d: 'FUSIONAR' | 'SEPARAR', lado: 'A' | 'B' = 'A') => iniciar(async () => setResultado(await decidirPar(par.id, d, lado)));

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
      {ubDistinta && <p className="aviso" style={{ marginBottom: 0 }}>Van en unidades distintas ({par.a.generico!.unidad_base} / {par.b.generico!.unidad_base}): no se pueden unir. Si es el mismo insumo, primero hay que corregir la unidad base de uno.</p>}
      {resultado && !resultado.ok && (
        <div className="error" role="alert">
          <ul style={{ margin: 0 }}>{[...resultado.fatales, ...resultado.avisos].map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
      <div className="acciones" style={{ marginTop: '.8rem' }}>
        {!ubDistinta && (
          mismoGenerico || !par.b.generico || !par.a.generico ? (
            <button type="button" disabled={enviando} onClick={() => decidir('FUSIONAR', 'A')}>Son el mismo</button>
          ) : (
            <>
              <button type="button" disabled={enviando} onClick={() => decidir('FUSIONAR', 'A')}>Son el mismo · quedar con A</button>
              <button type="button" disabled={enviando} onClick={() => decidir('FUSIONAR', 'B')} className="secundario">Quedar con B</button>
            </>
          )
        )}
        <button type="button" disabled={enviando} onClick={() => decidir('SEPARAR')} className="secundario">Son distintos</button>
      </div>
    </li>
  );
}
