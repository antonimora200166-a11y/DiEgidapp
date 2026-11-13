'use client';
import { useMemo, useState, useTransition } from 'react';
import type { Area } from '@/lib/roles';
import RechazoConMotivo from '@/components/RechazoConMotivo';
import { registrarBajaCarta, type ResultadoCarta } from './acciones';
import { useEnvio } from '@/lib/envio';
import { pesos } from '@/lib/formato';

type Persona = { id: string; nombre: string; rol: string; autoriza: boolean };
const hoyCali = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const sinTilde = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function RegistrarCarta({ area, carta, zonas, personas, yo, exigePin }: {
  area: Area; carta: { id: string; nombre: string }[]; zonas: { codigo: string; nombre: string }[]; personas: Persona[]; yo: string; exigePin: boolean;
}) {
  const [tipo, setTipo] = useState<'CORTESIA' | 'MAL_HECHO' | ''>('');
  const [buscar, setBuscar] = useState('');
  const [producto, setProducto] = useState<{ id: string; nombre: string } | null>(null);
  const [unidades, setUnidades] = useState('1');
  const [zona, setZona] = useState(zonas.length === 1 ? zonas[0].codigo : zonas.find((z) => /barra|l[ií]nea/i.test(z.nombre))?.codigo ?? '');
  const [fecha, setFecha] = useState(hoyCali());
  const autorizan = personas.filter((p) => p.autoriza);
  const [autoriza, setAutoriza] = useState(autorizan.some((p) => p.id === yo) ? yo : '');
  const [responsable, setResponsable] = useState('');
  const [aCargo, setACargo] = useState<boolean | null>(null);
  const [obs, setObs] = useState('');
  const [motivo, setMotivo] = useState('');
  const [resultado, setResultado] = useState<ResultadoCarta | null>(null);
  const [pend, start] = useTransition();
  const [pin, setPin] = useState('');
  const envio = useEnvio();

  const cargo = aCargo ?? tipo === 'MAL_HECHO';
  const opciones = useMemo(() => {
    const q = sinTilde(buscar.trim());
    return q.length < 2 ? [] : carta.filter((c) => sinTilde(c.nombre).includes(q)).slice(0, 8);
  }, [buscar, carta]);
  const und = Number(unidades.replace(',', '.'));
  const falta = !tipo ? 'Escoja si es cortesía o mal hecho.' : !producto ? 'Escoja el producto.' : !(und > 0) ? 'Escriba las unidades.'
    : !zona ? 'Escoja la zona de donde salió.' : tipo === 'CORTESIA' && !autoriza ? 'Escoja quién autorizó.'
    : (tipo === 'MAL_HECHO' || cargo) && !responsable ? 'Escoja el responsable.'
    : exigePin && autoriza && !/^[0-9]{4,6}$/.test(pin) ? 'Escriba el PIN de quien autorizó.' : null;

  function guardar(conMotivo: boolean) {
    setResultado(null);
    start(async () => {
      const r = await registrarBajaCarta({ area, ubicacion: zona, fecha, tipo, generico_id: producto?.id, unidades: und,
        autorizado_por: autoriza || null, responsable_id: responsable || null, a_cargo: cargo, observaciones: obs,
        pin_autoriza: exigePin && autoriza ? pin : null, confirmados: envio.confirmados,
        motivo_forzado: conMotivo || motivo.trim().length >= 15 ? motivo : null }, envio.clave);
      setResultado(r);
      if (r.ok || r.pin) setPin('');
    });
  }
  function otro() { envio.nuevo(); setPin(''); setProducto(null); setBuscar(''); setUnidades('1'); setObs(''); setMotivo(''); setResultado(null); setACargo(null); setResponsable(''); }

  if (resultado?.ok) {
    return (
      <div className="tarjeta" style={{ marginBottom: '1rem' }}>
        <p className="exito" role="status" style={{ marginTop: 0 }}><strong>{tipo === 'CORTESIA' ? 'Cortesía' : 'Mal hecho'} guardado: {resultado.codigo}</strong><br />
          {unidades} × {producto?.nombre}: {resultado.lineas} ingrediente(s) salieron del kardex
          {resultado.costo_mp != null && ` por ${pesos(resultado.costo_mp)}`}{cargo && responsable ? `, a cargo de ${personas.find((p) => p.id === responsable)?.nombre}` : ''}.</p>
        {resultado.avisos.length > 0 && <div className="aviso"><ul style={{ margin: 0 }}>{resultado.avisos.map((m) => <li key={m}>{m}</li>)}</ul></div>}
        <button type="button" onClick={otro}>Registrar otro</button>
      </div>
    );
  }

  const bloqueado = !!resultado && !resultado.ok && !resultado.fatales.length && resultado.bloqueos.length > 0;
  return (
    <section className="tarjeta" style={{ marginBottom: '1.2rem' }}>
      <div className="segmentos" role="radiogroup" aria-label="Qué fue">
        <label><input type="radio" name="tipo" checked={tipo === 'CORTESIA'} onChange={() => setTipo('CORTESIA')} /><span>Cortesía</span></label>
        <label><input type="radio" name="tipo" checked={tipo === 'MAL_HECHO'} onChange={() => setTipo('MAL_HECHO')} /><span>Mal hecho</span></label>
      </div>

      <label htmlFor="producto">Producto de la carta</label>
      {producto ? (
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          <strong>{producto.nombre}</strong>
          <button type="button" className="mini secundario" onClick={() => { setProducto(null); setBuscar(''); }}>Cambiar</button>
        </div>
      ) : (
        <>
          <input id="producto" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Escriba el nombre: negroni, burrata…" autoComplete="off" />
          {opciones.length > 0 && (
            <div className="chips-sel" style={{ marginTop: '.4rem' }}>
              {opciones.map((o) => <button key={o.id} type="button" onClick={() => setProducto(o)}>{o.nombre}</button>)}
            </div>)}
          {buscar.trim().length >= 2 && !opciones.length && <p className="suave" style={{ fontSize: '.85rem' }}>No hay productos de la carta con ese nombre.</p>}
        </>
      )}

      <div className="fila">
        <div>
          <label htmlFor="und">Unidades</label>
          <input id="und" inputMode="decimal" value={unidades} onChange={(e) => setUnidades(e.target.value)} />
        </div>
        <div>
          <label htmlFor="zona">Salió de</label>
          <select id="zona" value={zona} onChange={(e) => setZona(e.target.value)}>
            <option value="">— Zona —</option>
            {zonas.map((z) => <option key={z.codigo} value={z.codigo}>{z.nombre}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="fecha">Fecha</label>
          <input id="fecha" type="date" max={hoyCali()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
      </div>

      <div className="fila">
        <div>
          <label htmlFor="autoriza">Autorizó {tipo === 'CORTESIA' ? '' : <span className="ayuda">opcional</span>}</label>
          <select id="autoriza" value={autoriza} onChange={(e) => setAutoriza(e.target.value)}>
            <option value="">— Nadie —</option>
            {autorizan.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="resp">Responsable {tipo === 'MAL_HECHO' || cargo ? '' : <span className="ayuda">opcional (quién la entregó)</span>}</label>
          <select id="resp" value={responsable} onChange={(e) => setResponsable(e.target.value)}>
            <option value="">— Escoja —</option>
            {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
      </div>
      {exigePin && autoriza && (
        <div style={{ maxWidth: '14rem' }}>
          <label htmlFor="pin-autoriza">PIN de {personas.find((p) => p.id === autoriza)?.nombre ?? 'quien autoriza'}</label>
          <input id="pin-autoriza" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin}
                 onChange={(e) => setPin(e.target.value.replace(/D/g, ''))} />
          <span className="ayuda">Lo escribe quien autoriza. Así nadie autoriza a nombre de otro.</span>
        </div>)}
      {tipo && (
        <label style={{ display: 'flex', gap: '.45rem', alignItems: 'center', marginTop: '.7rem' }}>
          <input type="checkbox" checked={cargo} onChange={(e) => setACargo(e.target.checked)} style={{ width: 'auto', minHeight: 0 }} />
          El responsable responde por el costo de la materia prima
          {tipo === 'CORTESIA' && <span className="ayuda">(normalmente la cortesía va por cuenta de la casa)</span>}
        </label>)}

      <label htmlFor="obs">Qué pasó <span className="ayuda">opcional</span></label>
      <input id="obs" value={obs} onChange={(e) => setObs(e.target.value)} maxLength={200}
             placeholder={tipo === 'MAL_HECHO' ? 'Ej.: quedó aguado, se cayó al servirlo' : 'Ej.: mesa 4, cumpleaños'} />

      <RechazoConMotivo resultado={resultado} motivo={motivo} setMotivo={setMotivo} confirmados={envio.confirmados} setConfirmados={envio.setConfirmados} ejemplo="Ej.: la botella está en la barra pero no se ha trasladado en la app" />
      <div className="acciones">
        {bloqueado ? (
          <button type="button" disabled={pend || motivo.trim().length < 15} onClick={() => guardar(true)}>{pend ? 'Guardando…' : 'Guardar con este motivo'}</button>
        ) : (
          <button type="button" disabled={pend || !!falta} onClick={() => guardar(false)}>{pend ? 'Guardando…' : 'Guardar'}</button>
        )}
      </div>
      {falta && (tipo || producto) && <p className="suave" style={{ fontSize: '.85rem' }}>{falta}</p>}
    </section>
  );
}
