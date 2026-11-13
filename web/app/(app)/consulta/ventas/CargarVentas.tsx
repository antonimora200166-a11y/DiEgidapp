'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { guardarVentas, leerReporte, type Lectura } from './acciones';
import { pesos } from '@/lib/formato';

const fecha = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });

// 1 · subir el Excel de Odoo  2 · ver lo que trae y si cuadra  3 · guardar
export default function CargarVentas() {
  const router = useRouter();
  const [lectura, setLectura] = useState<Lectura | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();

  const leer = (f: File | undefined) => {
    if (!f) return;
    setResultado(null); setError(null); setLectura(null);
    const datos = new FormData(); datos.set('archivo', f);
    iniciar(async () => { const r = await leerReporte(datos); if (r.ok) setLectura(r); else setError(r.error); });
  };
  const guardar = () => {
    if (!lectura?.ok) return;
    iniciar(async () => {
      const r = await guardarVentas(lectura);
      if (!r.ok) { setError(r.error ?? 'No se pudo guardar.'); return; }
      setLectura(null);
      setResultado(`Se guardaron ${r.lineas} líneas.${r.omitidos?.length ? ` Se omitieron ${r.omitidos.length} día(s) que ya estaban cargados.` : ''}`
        + (r.sin_equivalencia ? ` ${r.sin_equivalencia} producto(s) de Odoo necesitan equivalencia: están abajo.` : ''));
      router.refresh();
    });
  };
  const r = lectura?.ok ? lectura.reporte : null;
  const cuadra = r?.cuadre.every((c) => Math.abs(c.lineas - c.reporte) < 1) ?? false;

  return (
    <section className="tarjeta" style={{ display: 'grid', gap: '.8rem' }}>
      <label className="m-0">Reporte de ventas de Odoo (Excel)
        <span className="ayuda">Punto de venta → Informes → Pedidos, en tabla dinámica con los días en las columnas → Descargar xlsx.
          Mejor si tiene la medida «Subtotal sin impuestos».</span>
        <input className="mt-1" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={enviando}
               onChange={(e) => leer(e.target.files?.[0])} />
      </label>
      {enviando && <p className="suave m-0">Trabajando…</p>}
      {error && <p className="aviso m-0">{error}</p>}
      {resultado && <p className="exito m-0" role="status">{resultado}</p>}
      {r && (
        <>
          <div className="cifras">
            <div className="cifra"><span>Días</span><b>{r.dias.length}</b><small>{fecha(r.desde)} → {fecha(r.hasta)}</small></div>
            <div className="cifra"><span>Líneas</span><b>{r.lineas.length}</b><small>{r.productos} productos · {r.unidades.toLocaleString('es-CO')} und</small></div>
            <div className="cifra"><span>Ventas sin impuesto</span><b>{pesos(r.total)}</b><small>{r.netoEstimado ? 'estimado ÷ 1,08' : 'del reporte'}</small></div>
            <div className={`cifra${cuadra ? '' : ' alerta'}`}><span>Cuadre</span><b>{cuadra ? 'Exacto' : 'No cuadra'}</b><small>día por día con la fila Total</small></div>
          </div>
          {r.netoEstimado && <p className="aviso m-0">El reporte no trae la medida «Subtotal sin impuestos». Se estima el neto dividiendo por 1,08;
            si hay productos con IVA del 19 % o sin impuesto, su valor queda un poco distinto. Para la próxima, agregue esa medida en Odoo.</p>}
          {!cuadra && <p className="aviso m-0">La suma de los productos no da el total de algún día: el archivo no se guarda. Revise que no tenga filtros.</p>}
          <div className="acciones m-0">
            <button type="button" disabled={enviando || !cuadra} onClick={guardar}>Guardar ventas</button>
            <button type="button" className="secundario" disabled={enviando} onClick={() => setLectura(null)}>Cancelar</button>
          </div>
        </>
      )}
    </section>
  );
}
