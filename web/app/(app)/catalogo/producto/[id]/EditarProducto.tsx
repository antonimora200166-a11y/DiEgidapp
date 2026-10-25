'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Resultado } from '@/lib/catalogo';
import { editarProducto } from '../../acciones';

export type Ficha = {
  id: string; codigo: string; estado: 'PROVISIONAL' | 'VALIDADO'; activo: boolean;
  marca: string; presentacion: string; unidad_compra: string; contenido_base: number | null; contenido_variable: boolean;
  generico: { codigo: string; nombre: string; tipo: string; categoria: string | null; unidad_base: 'g' | 'ml' | 'und';
              conservacion: string | null; temp_max_llegada: number | null; estado: string };
};

export default function EditarProducto({ ficha, categorias, ubBloqueada }: {
  ficha: Ficha; categorias: { codigo: string; nombre: string }[]; ubBloqueada: string | null;
}) {
  const g = ficha.generico;
  const router = useRouter();
  const [nombre, setNombre] = useState(g.nombre);
  const [tipo, setTipo] = useState(g.tipo);
  const [ub, setUb] = useState(g.unidad_base);
  const [categoria, setCategoria] = useState(g.categoria ?? '');
  const [conservacion, setConservacion] = useState(g.conservacion ?? '');
  const [tmax, setTmax] = useState(g.temp_max_llegada?.toString() ?? '');
  const [marca, setMarca] = useState(ficha.marca);
  const [presentacion, setPresentacion] = useState(ficha.presentacion);
  const [ucompra, setUcompra] = useState(ficha.unidad_compra);
  const [contenido, setContenido] = useState(ficha.contenido_base?.toString() ?? '');
  const [variable, setVariable] = useState(ficha.contenido_variable);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [enviando, iniciar] = useTransition();
  const esInsumo = g.tipo === 'MPe' || g.tipo === 'MPI';

  function guardar(validar: boolean) {
    const datos = {
      id: ficha.id, validar,
      generico: { nombre, tipo, unidad_base: ub, categoria, conservacion, temp_max_llegada: tmax.replace(',', '.') },
      producto: { marca, presentacion, unidad_compra: ucompra, contenido_base: variable ? '' : contenido.replace(',', '.'), contenido_variable: variable },
    };
    iniciar(async () => {
      const r = await editarProducto(datos);
      setResultado(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); guardar(false); }}>
      <div className="tarjeta">
        <h2 style={{ marginTop: 0 }}>Genérico <span className="cod">{g.codigo}</span></h2>
        <p className="suave" style={{ marginTop: 0, fontSize: '.88rem' }}>Lo que cambies aquí aplica a todas las presentaciones de este genérico.</p>
        <label htmlFor="nombre">Nombre genérico <span className="ayuda">sin marca ni tamaño</span></label>
        <input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required minLength={3} />
        <div className="fila">
          <div>
            <label htmlFor="tipo">Tipo</label>
            <select id="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} disabled={!esInsumo}>
              {esInsumo ? <><option value="MPe">Se compra (MPe)</option><option value="MPI">Se produce aquí (MPI)</option></>
                        : <option value={tipo}>{tipo}</option>}
            </select>
          </div>
          <div>
            <label htmlFor="ub">Unidad base {ubBloqueada && <span className="ayuda">{ubBloqueada}</span>}</label>
            <select id="ub" value={ub} onChange={(e) => setUb(e.target.value as 'g' | 'ml' | 'und')} disabled={!!ubBloqueada}>
              <option value="g">gramos (g)</option><option value="ml">mililitros (ml)</option><option value="und">unidades (und)</option>
            </select>
          </div>
        </div>
        <label htmlFor="categoria">Categoría</label>
        <select id="categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          <option value="">— sin categoría —</option>
          {categorias.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
        </select>
        <div className="fila">
          <div>
            <label htmlFor="conservacion">Conservación</label>
            <select id="conservacion" value={conservacion} onChange={(e) => setConservacion(e.target.value)}>
              <option value="">— sin definir —</option><option>Ambiente</option><option>Refrigerado</option><option>Congelado</option>
            </select>
          </div>
          <div>
            <label htmlFor="tmax">Temp. máx. de llegada (°C) <span className="ayuda">para refrigerados y congelados</span></label>
            <input id="tmax" inputMode="decimal" value={tmax} onChange={(e) => setTmax(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="tarjeta" style={{ marginTop: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>Presentación <span className="cod">{ficha.codigo}</span></h2>
        <label htmlFor="marca">Marca <span className="ayuda">vacío si no tiene</span></label>
        <input id="marca" value={marca} onChange={(e) => setMarca(e.target.value)} />
        <label htmlFor="presentacion">Presentación <span className="ayuda">«Botella 750 ml», «Bolsa 1.000 g», «Granel»</span></label>
        <input id="presentacion" value={presentacion} onChange={(e) => setPresentacion(e.target.value)} required />
        <div className="fila">
          <div>
            <label htmlFor="ucompra">Unidad de compra <span className="ayuda">BOT, PAQ, BOLSA, KG, GR, UND…</span></label>
            <input id="ucompra" value={ucompra} onChange={(e) => setUcompra(e.target.value.toUpperCase())} maxLength={6} required />
          </div>
          <div>
            <label htmlFor="contenido">Cada {ucompra || 'unidad'} trae ({ub}) <span className="ayuda">factor de compra</span></label>
            <input id="contenido" inputMode="decimal" value={contenido} onChange={(e) => setContenido(e.target.value)} disabled={variable} required={!variable} />
          </div>
        </div>
        <label style={{ fontWeight: 400, display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          <input type="checkbox" checked={variable} onChange={(e) => setVariable(e.target.checked)} style={{ width: 22, minHeight: 22 }} />
          El contenido cambia en cada compra (se pesa al recibir)
        </label>
      </div>

      {resultado && (
        <div className={resultado.ok ? 'exito' : 'error'} role={resultado.ok ? 'status' : 'alert'}>
          <strong>{resultado.ok ? 'Guardado.' : 'No se guardó:'}</strong>
          {(resultado.fatales.length > 0 || resultado.avisos.length > 0) && (
            <ul>{[...resultado.fatales, ...resultado.avisos].map((m) => <li key={m}>{m}</li>)}</ul>
          )}
        </div>
      )}

      <div className="acciones">
        {ficha.estado === 'PROVISIONAL' && (
          <button type="button" disabled={enviando} onClick={() => guardar(true)}>Guardar y validar</button>
        )}
        <button type="submit" disabled={enviando} className={ficha.estado === 'PROVISIONAL' ? 'secundario' : undefined}>
          {enviando ? 'Guardando…' : 'Guardar cambios'}
        </button>
        <Link href="/catalogo" className="boton secundario">Volver al catálogo</Link>
      </div>
    </form>
  );
}
