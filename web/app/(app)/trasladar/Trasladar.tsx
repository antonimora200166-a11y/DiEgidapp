'use client';
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import type { Resultado } from '@/lib/catalogo';
import type { Area } from '@/lib/roles';
import { registrarTraslado } from '@/lib/movimientos';
import LineasInventario, { baseDe, type LineaInv, type ProductoSaldo } from '@/components/LineasInventario';
import RechazoConMotivo from '@/components/RechazoConMotivo';
import { confirmar } from '@/components/Dialogo';

type Zona = { codigo: string; nombre: string; area: Area };
const hoyCali = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

function OpcionesZonas({ zonas, excepto }: { zonas: Zona[]; excepto?: string }) {
  const areas = [...new Set(zonas.map((z) => z.area))];
  const ops = (a: Area) => zonas.filter((z) => z.area === a && z.codigo !== excepto).map((z) => <option key={z.codigo} value={z.codigo}>{z.nombre}</option>);
  return <>{areas.length > 1 ? areas.map((a) => <optgroup key={a} label={a === 'BAR' ? 'Bar' : 'Cocina'}>{ops(a)}</optgroup>) : ops(areas[0])}</>;
}

export default function Trasladar({ zonas, productos }: { zonas: Zona[]; productos: Record<string, ProductoSaldo[]> }) {
  const [origen, setOrigen] = useState('');
  const [destino, setDestino] = useState('');
  const [fecha, setFecha] = useState(hoyCali());
  const [lineas, setLineas] = useState<LineaInv[]>([]);
  const [obs, setObs] = useState('');
  const [motivo, setMotivo] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [enviando, iniciar] = useTransition();
  // lo que se traslada es del área de la zona de origen
  const area = zonas.find((z) => z.codigo === origen)?.area;
  const lista = area ? productos[area] ?? [] : [];
  const porId = new Map(lista.map((p) => [p.producto_id, p]));

  const clave = 'sgi-trasladar';
  const [cargado, setCargado] = useState(false);
  useEffect(() => {
    try { const b = JSON.parse(localStorage.getItem(clave) || 'null'); if (b) { setOrigen(b.origen); setDestino(b.destino); setLineas(b.lineas); setObs(b.obs); } } catch { /* nada */ }
    setCargado(true);
  }, []);
  useEffect(() => {
    if (!cargado) return;
    try { localStorage.setItem(clave, JSON.stringify({ origen, destino, lineas, obs })); } catch { /* nada */ }
  }, [cargado, origen, destino, lineas, obs]);

  async function cambiarOrigen(z: string) {
    const nueva = zonas.find((x) => x.codigo === z)?.area;
    if (lineas.length && nueva !== area && !(await confirmar('Esa zona es de otra área: se quitan los productos escritos.', { titulo: '¿Seguir?', aceptar: 'Cambiar de zona' }))) return;
    if (nueva !== area) setLineas([]);
    setOrigen(z);
    if (destino === z) setDestino('');
  }

  const malas = lineas.filter((l) => baseDe(l, porId.get(l.producto_id)) === null).length;

  function guardar(conMotivo: boolean) {
    setResultado(null);
    iniciar(async () => {
      const r = await registrarTraslado({
        fecha, origen, destino, observaciones: obs, motivo_forzado: conMotivo ? motivo : null,
        lineas: lineas.map((l) => ({ producto_id: l.producto_id, cantidad: baseDe(l, porId.get(l.producto_id)),
                                     unidad: porId.get(l.producto_id)?.unidad_base })),
      });
      setResultado(r);
      if (r.ok) { try { localStorage.removeItem(clave); } catch { /* nada */ } window.scrollTo({ top: 0, behavior: 'smooth' }); }
    });
  }
  function otro() { setLineas([]); setObs(''); setMotivo(''); setResultado(null); setFecha(hoyCali()); }
  const nombre = (u: string) => zonas.find((z) => z.codigo === u)?.nombre ?? u;

  if (resultado?.ok) {
    return (
      <div className="tarjeta">
        <p className="exito" role="status" style={{ marginTop: 0 }}><strong>Traslado guardado: {resultado.codigo}</strong><br />
          {lineas.length} producto(s) de {nombre(origen)} a {nombre(destino)}.</p>
        {resultado.avisos.length > 0 && <div className="aviso"><ul style={{ margin: 0 }}>{resultado.avisos.map((m) => <li key={m}>{m}</li>)}</ul></div>}
        <div className="acciones">
          <button type="button" onClick={otro}>Otro traslado</button>
          <Link className="boton secundario" href="/existencias">Ver existencias</Link>
        </div>
      </div>
    );
  }

  const bloqueado = !!resultado && !resultado.ok && !resultado.fatales.length && resultado.bloqueos.length > 0;
  return (
    <>
      <section className="tarjeta">
        <div className="fila">
          <div>
            <label htmlFor="origen" style={{ marginTop: 0 }}>Sale de</label>
            <select id="origen" value={origen} onChange={(e) => cambiarOrigen(e.target.value)}>
              <option value="">— Zona —</option>
              <OpcionesZonas zonas={zonas} />
            </select>
          </div>
          <div>
            <label htmlFor="destino" style={{ marginTop: 0 }}>Llega a</label>
            <select id="destino" value={destino} onChange={(e) => setDestino(e.target.value)}>
              <option value="">— Zona —</option>
              <OpcionesZonas zonas={zonas} excepto={origen} />
            </select>
          </div>
        </div>
        <label htmlFor="fecha">Fecha</label>
        <input id="fecha" type="date" max={hoyCali()} value={fecha} onChange={(e) => setFecha(e.target.value)} style={{ maxWidth: 200 }} />
      </section>

      <h2>Productos {lineas.length > 0 && <span className="suave" style={{ fontWeight: 400 }}>({lineas.length})</span>}</h2>
      {origen
        ? <LineasInventario productos={lista} zona={origen} lineas={lineas} setLineas={setLineas} ofrecerTodo />
        : <p className="suave">Elige primero de qué zona sale.</p>}

      <label htmlFor="obs">Observaciones <span className="ayuda">opcional</span></label>
      <textarea id="obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />

      <RechazoConMotivo resultado={resultado} motivo={motivo} setMotivo={setMotivo} ejemplo="Ej.: la mercancía llegó directo a la barra y la recepción se registró en bodega" />
      <div className="acciones barra-guardar">
        {bloqueado ? (
          <button type="button" disabled={enviando || motivo.trim().length < 15} onClick={() => guardar(true)}>{enviando ? 'Guardando…' : 'Guardar con este motivo'}</button>
        ) : (
          <button type="button" disabled={enviando || !origen || !destino || !lineas.length || malas > 0} onClick={() => guardar(false)}>
            {enviando ? 'Guardando…' : `Guardar traslado (${lineas.length})`}
          </button>
        )}
        {lineas.length > 0 && <button type="button" className="secundario" disabled={enviando} onClick={async () => { if (await confirmar('¿Descartar este traslado?', { aceptar: 'Descartar', peligro: true })) otro(); }}>Descartar</button>}
      </div>
      {lineas.length > 0 && (!destino || malas > 0) && (
        <p className="suave" style={{ fontSize: '.85rem' }}>{!destino ? 'Elige a qué zona llega. ' : ''}{malas > 0 ? `Falta la cantidad en ${malas} producto(s).` : ''}</p>
      )}
    </>
  );
}
