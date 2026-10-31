'use client';
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import type { Resultado } from '@/lib/catalogo';
import type { Area } from '@/lib/roles';
import { registrarBaja } from '@/lib/movimientos';
import LineasInventario, { baseDe, valorDe, type LineaInv, type ProductoSaldo } from '@/components/LineasInventario';
import RechazoConMotivo from '@/components/RechazoConMotivo';
import { confirmar } from '@/components/Dialogo';

const CAUSAS = [
  { v: 'VENCIDO', t: 'Vencido' }, { v: 'DANADO', t: 'Dañado' }, { v: 'DERRAME', t: 'Derrame' },
  { v: 'MAL_ESTADO', t: 'Mal estado' }, { v: 'OTRO', t: 'Otro' }] as const;
const hoyCali = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const pesos = (n: number) => n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

export default function Bajas({ area, productos, zonas }: { area: Area; productos: ProductoSaldo[]; zonas: { codigo: string; nombre: string }[] }) {
  const porId = new Map(productos.map((p) => [p.producto_id, p]));
  const [zona, setZona] = useState(zonas.length === 1 ? zonas[0].codigo : '');
  const [fecha, setFecha] = useState(hoyCali());
  const [causa, setCausa] = useState('');
  const [lineas, setLineas] = useState<LineaInv[]>([]);
  const [obs, setObs] = useState('');
  const [motivo, setMotivo] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [enviando, iniciar] = useTransition();

  // borrador en este equipo
  const clave = `sgi-bajas:${area}`;
  const [cargado, setCargado] = useState(false);
  useEffect(() => {
    try { const b = JSON.parse(localStorage.getItem(clave) || 'null'); if (b) { setZona(b.zona); setCausa(b.causa); setLineas(b.lineas); setObs(b.obs); } } catch { /* nada */ }
    setCargado(true);
  }, [clave]);
  useEffect(() => {
    if (!cargado) return;
    try { localStorage.setItem(clave, JSON.stringify({ zona, causa, lineas, obs })); } catch { /* nada */ }
  }, [clave, cargado, zona, causa, lineas, obs]);

  const malas = lineas.filter((l) => baseDe(l, porId.get(l.producto_id)) === null).length;
  const total = lineas.reduce((t, l) => t + (valorDe(l, porId.get(l.producto_id)) ?? 0), 0);
  const faltaObs = causa === 'OTRO' && !obs.trim();

  function guardar(conMotivo: boolean) {
    setResultado(null);
    iniciar(async () => {
      const r = await registrarBaja({
        area, ubicacion: zona, fecha, causa, observaciones: obs, motivo_forzado: conMotivo ? motivo : null,
        lineas: lineas.map((l) => ({ producto_id: l.producto_id, cantidad: baseDe(l, porId.get(l.producto_id)),
                                     unidad: porId.get(l.producto_id)?.unidad_base })),
      });
      setResultado(r);
      if (r.ok) { try { localStorage.removeItem(clave); } catch { /* nada */ } window.scrollTo({ top: 0, behavior: 'smooth' }); }
    });
  }
  function otra() { setLineas([]); setObs(''); setCausa(''); setMotivo(''); setResultado(null); setFecha(hoyCali()); }

  if (resultado?.ok) {
    return (
      <div className="tarjeta">
        <p className="exito" role="status" style={{ marginTop: 0 }}><strong>Baja guardada: {resultado.codigo}</strong><br />
          {lineas.length} producto(s) salieron del kardex{total > 0 && ` por ${pesos(total)}`}.</p>
        {resultado.avisos.length > 0 && <div className="aviso"><ul style={{ margin: 0 }}>{resultado.avisos.map((m) => <li key={m}>{m}</li>)}</ul></div>}
        <div className="acciones">
          <button type="button" onClick={otra}>Registrar otra</button>
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
            <label htmlFor="zona" style={{ marginTop: 0 }}>Zona</label>
            <select id="zona" value={zona} onChange={(e) => setZona(e.target.value)}>
              <option value="">— Zona —</option>
              {zonas.map((z) => <option key={z.codigo} value={z.codigo}>{z.nombre}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="fecha" style={{ marginTop: 0 }}>Fecha</label>
            <input id="fecha" type="date" max={hoyCali()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
        </div>
        <label>Causa</label>
        <div className="segmentos" role="radiogroup" aria-label="Causa de la baja">
          {CAUSAS.map((c) => (
            <label key={c.v}><input type="radio" name="causa" checked={causa === c.v} onChange={() => setCausa(c.v)} /><span>{c.t}</span></label>
          ))}
        </div>
      </section>

      <h2>Productos {lineas.length > 0 && <span className="suave" style={{ fontWeight: 400 }}>({lineas.length})</span>}</h2>
      <LineasInventario productos={productos} zona={zona} lineas={lineas} setLineas={setLineas} />

      <label htmlFor="obs">Observaciones <span className="ayuda">{causa === 'OTRO' ? 'obligatorias si la causa es «Otro»' : 'opcional'}</span></label>
      <textarea id="obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
      {total > 0 && <p className="suave">Valor de la baja: <strong>{pesos(total)}</strong></p>}

      <RechazoConMotivo resultado={resultado} motivo={motivo} setMotivo={setMotivo} ejemplo="Ej.: la botella se rompió antes de registrar su recepción" />
      <div className="acciones barra-guardar">
        {bloqueado ? (
          <button type="button" disabled={enviando || motivo.trim().length < 15} onClick={() => guardar(true)}>{enviando ? 'Guardando…' : 'Guardar con este motivo'}</button>
        ) : (
          <button type="button" disabled={enviando || !zona || !causa || !lineas.length || malas > 0 || faltaObs} onClick={() => guardar(false)}>
            {enviando ? 'Guardando…' : `Guardar baja (${lineas.length})`}
          </button>
        )}
        {lineas.length > 0 && <button type="button" className="secundario" disabled={enviando} onClick={async () => { if (await confirmar('¿Descartar esta baja?', { aceptar: 'Descartar', peligro: true })) otra(); }}>Descartar</button>}
      </div>
      {lineas.length > 0 && (!zona || !causa || malas > 0 || faltaObs) && (
        <p className="suave" style={{ fontSize: '.85rem' }}>
          {!zona ? 'Elige la zona. ' : ''}{!causa ? 'Elige la causa. ' : ''}
          {malas > 0 ? `Falta la cantidad en ${malas} producto(s). ` : ''}{faltaObs ? 'Escribe qué pasó en observaciones.' : ''}
        </p>
      )}
    </>
  );
}
