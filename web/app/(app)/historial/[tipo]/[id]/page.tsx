import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { CAUSA, CONDICION, NOMBRE_TIPO, cant, pesos, pesosU } from '../../comun';
import Anular from './Anular';

export const metadata = { title: 'Documento' };

type L = Record<string, unknown>;
type Detalle = {
  tipo: string; id: string; area: 'BAR' | 'COCINA'; encabezado: L; lineas: L[]; valor: number | null;
  registrado: { usuario: string | null; en: string } | null; anulacion: { motivo: string; en: string; usuario: string | null } | null;
  puede_anular: boolean;
};
const UUID = /^[0-9a-f-]{36}$/;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export default async function DetalleDocumento({ params }: { params: Promise<{ tipo: string; id: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio') redirect('/');
  const { tipo: t, id } = await params;
  const tipo = t.toUpperCase();
  if (!NOMBRE_TIPO[tipo] || !UUID.test(id)) notFound();
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('detalle_documento', { p_tipo: tipo, p_id: id });
  if (error) { if (/No existe/.test(error.message)) notFound(); throw new Error(error.message); }
  const d = data as Detalle;
  const e = d.encabezado;
  const anulado = !!d.anulacion;
  const ub = (l: L) => s(l.unidad_base);

  // Encabezado: los datos que importan de cada tipo, en orden
  const filas: [string, string][] = ([
    ['Fecha', new Date(s(e.fecha) + 'T12:00:00').toLocaleDateString('es-CO')],
    ...(tipo === 'RECEPCION' ? [['Proveedor', s(e.proveedor)], ['Documento', `${s(e.documento) || 'sin número'} (${s(e.soporte).toLowerCase()})`],
                                ['Zona', s(e.zona)], ['Recibió', s(e.recibe)], ['Foto de la factura', e.con_foto ? 'sí' : 'no']] : []),
    ...(tipo === 'LOTE' ? [['Producto', s(e.producto)], ['Zona', s(e.zona)], ['Ficha', s(e.ficha) || 'sin ficha'],
                           ['Neto', `${cant(n(e.neto))} ${s(e.unidad_base)}`],
                           ['Costo', e.costo_unitario !== null ? `${pesosU(Number(e.costo_unitario))}/${s(e.unidad_base)} · lote ${pesos(Number(e.costo_total))}` : 'sin costo completo (PARCIAL)'],
                           ['Rendimiento', e.rendimiento !== null ? `${Math.round(Number(e.rendimiento) * 1000) / 10} %${e.rendimiento_ficha !== null ? ` (ficha ${Math.round(Number(e.rendimiento_ficha) * 1000) / 10} %)` : ''}` : ''],
                           ['Responsable', s(e.responsable)]] : []),
    ...(tipo === 'BAJA' ? [['Causa', CAUSA[s(e.causa)] ?? s(e.causa)], ['Zona', s(e.zona)]] : []),
    ...(tipo === 'TRASLADO' ? [['De', s(e.origen)], ['A', s(e.destino)]] : []),
    ...(tipo === 'CONTEO' ? [['Zona', s(e.zona)], ['Tipo', e.tipo_conteo === 'INICIAL' ? 'Conteo inicial' : 'Conteo normal'], ['Responsable', s(e.responsable)]] : []),
    ['Valor', d.valor !== null ? pesos(Number(d.valor)) : '—'],
    ['Registró', d.registrado ? `${d.registrado.usuario ?? '—'} · ${new Date(d.registrado.en).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}` : '—'],
  ] as [string, string][]).filter(([, v]) => v !== '');

  return (
    <>
      <p style={{ margin: '0 0 .3rem' }}><Link href="/historial">← Historial</Link></p>
      <h1>{NOMBRE_TIPO[tipo].singular} <span className="cod" style={{ fontSize: '1rem' }}>{s(e.codigo)}</span></h1>

      {anulado && (
        <p className="aviso"><strong>Anulado</strong> por {d.anulacion!.usuario ?? '—'} el {new Date(d.anulacion!.en).toLocaleDateString('es-CO')}: {d.anulacion!.motivo}</p>
      )}
      <section className="tarjeta">
        <table className="tabla"><tbody>
          {filas.map(([k, v]) => <tr key={k}><th style={{ width: '40%' }}>{k}</th><td>{v}</td></tr>)}
        </tbody></table>
        {!!e.observaciones && <p style={{ marginBottom: 0 }}><strong>Observaciones:</strong> {s(e.observaciones)}</p>}
        {!!e.motivo_forzado && <p className="suave" style={{ marginBottom: 0 }}><strong>Se forzó:</strong> {s(e.motivo_forzado)}</p>}
        {Array.isArray(e.avisos) && e.avisos.length > 0 && (
          <details style={{ marginTop: '.6rem' }}><summary className="suave">Avisos al guardar ({e.avisos.length})</summary>
            <ul>{(e.avisos as string[]).map((a) => <li key={a} style={{ fontSize: '.88rem' }}>{a}</li>)}</ul></details>
        )}
      </section>

      <h2>{tipo === 'LOTE' ? 'Ingredientes' : 'Productos'} ({d.lineas.length})</h2>
      <ul className="lista">
        {d.lineas.map((l) => (
          <li key={s(l.linea)} style={l.anulada ? { opacity: 0.6 } : undefined}>
            <div className="linea" style={{ alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <strong style={l.anulada ? { textDecoration: 'line-through' } : undefined}>{s(l.producto)}</strong>
                {!!l.presentacion && <div className="suave" style={{ fontSize: '.85rem' }}>{s(l.presentacion)}</div>}
                <div style={{ fontSize: '.9rem', marginTop: '.2rem' }}>
                  {tipo === 'RECEPCION' && <>
                    {cant(n(l.recibida))} {s(l.unidad_compra).toLowerCase()}{n(l.pedida) !== null && n(l.pedida) !== n(l.recibida) && ` (pedido ${cant(n(l.pedida))})`}
                    {' '}= {cant(n(l.cantidad_base))} {ub(l)}
                    {l.valor !== null && <> · {pesos(Number(l.valor))}{l.costo_unitario !== null && ` · ${pesosU(Number(l.costo_unitario))}/${ub(l)}`}</>}
                    <span className="suave" style={{ display: 'block', fontSize: '.82rem' }}>
                      {CONDICION[s(l.condicion)] ?? s(l.condicion)}
                      {!!l.sello && ` · sello ${l.sello === 'SI' ? 'intacto' : l.sello === 'NO' ? 'roto' : 'no aplica'}`}
                      {l.temperatura !== null && ` · ${cant(n(l.temperatura))} °C`}
                      {!!l.vencimiento && ` · vence ${new Date(s(l.vencimiento) + 'T12:00:00').toLocaleDateString('es-CO')}`}
                      {Array.isArray(l.hallazgos) && l.hallazgos.length > 0 && ` · ${(l.hallazgos as string[]).join(', ')}`}
                      {!!l.anulada && ' · línea anulada'}
                    </span>
                  </>}
                  {tipo === 'LOTE' && <>
                    {cant(n(l.cantidad))} {s(l.unidad)}{s(l.unidad) !== ub(l) && ` = ${cant(n(l.cantidad_base))} ${ub(l)}`}
                    {l.costo !== null && <> · {pesos(Number(l.costo))}</>}
                  </>}
                  {(tipo === 'BAJA' || tipo === 'TRASLADO') && <>{cant(n(l.cantidad_base))} {ub(l)}{l.costo !== null && <> · {pesos(Number(l.costo))}</>}</>}
                  {tipo === 'CONTEO' && <>
                    Contado {cant(n(l.contada))} {ub(l)} · kardex {cant(n(l.teorico))}
                    {n(l.diferencia) ? <> · <strong>{Number(l.diferencia) > 0 ? '+' : ''}{cant(n(l.diferencia))}</strong>{l.costo !== null && ` (${pesos(Number(l.costo))})`}</> : ' · sin diferencia'}
                  </>}
                </div>
                {!!(l.observaciones || l.nota) && <div className="suave" style={{ fontSize: '.82rem' }}>{s(l.observaciones || l.nota)}</div>}
              </div>
              {tipo === 'RECEPCION' && d.puede_anular && !anulado && !l.anulada && d.lineas.length > 1 && (
                <Anular tipo={tipo} id={d.id} lineaId={s(l.id)} etiqueta="Anular línea" pequeno />
              )}
            </div>
          </li>
        ))}
      </ul>

      {!anulado && (
        d.puede_anular
          ? <div className="acciones"><Anular tipo={tipo} id={d.id} etiqueta={`Anular ${NOMBRE_TIPO[tipo].singular.toLowerCase()}`} /></div>
          : <p className="suave" style={{ fontSize: '.88rem' }}>Si hay un error, pídele al jefe del área o a administración que lo anule desde aquí.</p>
      )}
    </>
  );
}
