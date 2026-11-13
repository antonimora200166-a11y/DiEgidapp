'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import VistaFiltrable, { type Columna, type Grupo } from '@/components/VistaFiltrable';
import { sacarDelBaul } from './acciones';
import { pesos, fecha } from '@/lib/formato';

export type EnBaul = {
  generico_id: string; nombre: string; tipo: 'BEBIDA' | 'PLATO'; carta: string | null; ficha_codigo: string | null;
  precio: number | null; desde: string | null; motivo: string | null;
};

// Lo que está en el baúl: la ficha se guarda tal cual; «Sacar» la devuelve a la carta.
export default function ListaBaul({ filas, puede }: { filas: EnBaul[]; puede: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  const sacar = (ids: string[], limpiar: () => void) => iniciar(async () => {
    const r = await sacarDelBaul(ids);
    if (r.ok) { setError(null); limpiar(); router.refresh(); } else setError(r.error ?? 'No se pudo sacar.');
  });
  const grupos: Grupo<EnBaul>[] = [
    { clave: 'carta', titulo: 'Sección de la carta', valor: (f) => f.carta ?? 'Sin sección' },
    { clave: 'tipo', titulo: 'Tipo', valor: (f) => (f.tipo === 'BEBIDA' ? 'Cóctel / bebida' : 'Plato') },
  ];
  const columnas: Columna<EnBaul>[] = [
    { k: 'nombre', t: 'Nombre', orden: (f) => f.nombre, ver: (f) => (
      <div><Link href={`/fichas/${f.generico_id}`}><strong>{f.nombre}</strong></Link>
        {f.carta && <div className="suave texto-mini">{f.carta}</div>}</div>) },
    { k: 'ficha', t: 'Ficha', ver: (f) => (f.ficha_codigo ? <span className="cod">{f.ficha_codigo}</span> : <span className="suave">sin ficha</span>) },
    { k: 'precio', t: 'Último precio', der: true, def: false, orden: (f) => f.precio, ver: (f) => (f.precio ? pesos(Number(f.precio)) : <span className="suave">—</span>) },
    { k: 'desde', t: 'En el baúl desde', orden: (f) => f.desde, ver: (f) => fecha(f.desde) },
    { k: 'motivo', t: 'Motivo', ver: (f) => f.motivo ?? <span className="suave">—</span> },
  ];
  return (
    <>
      {error && <p className="tarjeta c-error">{error}</p>}
      <VistaFiltrable clave="carta-baul" filas={filas} id={(f) => f.generico_id} buscar={(f) => `${f.nombre} ${f.carta ?? ''} ${f.motivo ?? ''}`}
                      grupos={grupos} columnas={columnas} vacio="Nada coincide con estos filtros."
                      seleccionable={puede ? () => true : undefined}
                      acciones={(elegidas, limpiar) => (
                        <div className="barra-bloque">
                          <div className="linea wrap">
                            <strong>{elegidas.length} seleccionado(s)</strong>
                            <div className="fila-flex wrap">
                              <button type="button" disabled={enviando} onClick={() => sacar(elegidas.map((f) => f.generico_id), limpiar)}>
                                {enviando ? 'Sacando…' : `Devolver ${elegidas.length} a la carta`}</button>
                              <button type="button" className="secundario" disabled={enviando} onClick={limpiar}>Quitar selección</button>
                            </div>
                          </div>
                        </div>
                      )} />
    </>
  );
}
