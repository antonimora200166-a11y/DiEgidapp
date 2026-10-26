import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';

export const metadata = { title: 'Registro' };
const POR_PAGINA = 50;

type Evento = { id: number; ocurrido_en: string; usuario_id: string | null; accion: string; entidad: string | null;
                entidad_id: string | null; detalle: unknown; motivo: string | null };
type ErrorApp = { id: number; ocurrido_en: string; origen: string; usuario_id: string | null; ruta: string | null;
                  mensaje: string; detalle: string | null; agente: string | null; huella: string | null };

// Los cambios automáticos de tablas maestras se registran como INSERT/UPDATE: aquí se leen en español
const ACCION: Record<string, string> = { INSERT: 'Alta', UPDATE: 'Cambio', DELETE: 'Borrado' };
const ENTIDAD: Record<string, string> = {
  productos: 'producto', genericos: 'genérico', alias: 'nombre', perfiles: 'usuario', revision_catalogo: 'par',
  categorias: 'categoría', ubicaciones: 'ubicación', proveedores: 'proveedor', fichas: 'ficha', ficha_lineas: 'línea de ficha',
  conversiones: 'conversión', costos_referencia: 'costo de referencia', ubicacion_productos: 'producto en zona',
};
const fecha = (s: string) => new Date(s).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' });

export default async function Registro({ searchParams }: { searchParams: Promise<{ ver?: string; pag?: string; q?: string; sistema?: string }> }) {
  const perfil = await perfilActual();
  if (!['admin', 'auditor'].includes(perfil.rol)) redirect('/');
  const sp = await searchParams;
  const ver = sp.ver === 'errores' ? 'errores' : 'actividad';
  const pag = Math.max(1, Number(sp.pag) || 1);
  const q = (sp.q ?? '').trim();
  const conSistema = sp.sistema === '1';
  const supabase = await supabaseServidor();
  const desde = (pag - 1) * POR_PAGINA, hasta = pag * POR_PAGINA - 1;

  let eventos: Evento[] = [], errores: ErrorApp[] = [], total = 0;
  if (ver === 'actividad') {
    let c = supabase.from('bitacora').select('*', { count: 'exact' }).order('id', { ascending: false }).range(desde, hasta);
    // por defecto solo lo que hizo una persona; las cargas de migración y los cambios automáticos, a pedido
    if (!conSistema) c = c.not('usuario_id', 'is', null);
    if (q) c = c.or(`accion.ilike.%${q.replace(/[,()%]/g, ' ')}%,entidad_id.ilike.%${q.replace(/[,()%]/g, ' ')}%`);
    const { data, count } = await c;
    eventos = (data ?? []) as Evento[];
    total = count ?? 0;
  } else {
    const { data, count } = await supabase.from('errores_app').select('*', { count: 'exact' }).order('id', { ascending: false }).range(desde, hasta);
    errores = (data ?? []) as ErrorApp[];
    total = count ?? 0;
  }
  const { count: erroresSemana } = await supabase.from('errores_app').select('id', { count: 'exact', head: true })
    .gte('ocurrido_en', new Date(Date.now() - 7 * 86400000).toISOString());

  // nombres de quienes aparecen
  const ids = [...new Set([...eventos, ...errores].map((x) => x.usuario_id).filter(Boolean))] as string[];
  const { data: gente } = ids.length ? await supabase.from('perfiles').select('id, nombre').in('id', ids) : { data: [] };
  const nombre = (id: string | null) => (id ? gente?.find((g) => g.id === id)?.nombre ?? 'usuario' : 'sistema');
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const enlace = (c: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const v = { ver: ver === 'errores' ? 'errores' : undefined, q: q || undefined, sistema: conSistema ? '1' : undefined, ...c };
    for (const [k, x] of Object.entries(v)) if (x) p.set(k, x);
    return `/admin/registro${p.size ? `?${p}` : ''}`;
  };
  const activo = { background: 'var(--marca)', color: 'var(--marca-texto)', borderColor: 'var(--marca)' };

  return (
    <>
      <h1>Registro</h1>
      <nav className="segmentos" style={{ marginBottom: '1rem' }}>
        <Link href={enlace({ ver: undefined, pag: undefined })}><span style={ver === 'actividad' ? activo : undefined}>Actividad</span></Link>
        <Link href={enlace({ ver: 'errores', pag: undefined, q: undefined, sistema: undefined })}>
          <span style={ver === 'errores' ? activo : undefined}>Errores{(erroresSemana ?? 0) > 0 && ` · ${erroresSemana} esta semana`}</span>
        </Link>
      </nav>

      {ver === 'actividad' ? (
        <>
          <form className="fila" style={{ gridTemplateColumns: '1fr auto', alignItems: 'end' }}>
            <div>
              <label htmlFor="q">Buscar <span className="ayuda">acción o código: «validado», «PAR», «COC_MPe_0361»</span></label>
              <input id="q" name="q" defaultValue={q} autoComplete="off" />
              {conSistema && <input type="hidden" name="sistema" value="1" />}
            </div>
            <button type="submit">Buscar</button>
          </form>
          <p className="suave" style={{ fontSize: '.88rem' }}>
            {total} evento(s){paginas > 1 && ` · página ${pag} de ${paginas}`} ·{' '}
            <Link href={enlace({ sistema: conSistema ? undefined : '1', pag: undefined })}>
              {conSistema ? 'ocultar cargas y cambios automáticos' : 'incluir cargas y cambios automáticos'}
            </Link>
          </p>
          {eventos.length ? (
            <ul className="lista">
              {eventos.map((e) => (
                <li key={e.id}>
                  <div className="linea">
                    <div>
                      <strong>{ACCION[e.accion] ? `${ACCION[e.accion]} de ${ENTIDAD[e.entidad ?? ''] ?? e.entidad}` : e.accion.charAt(0) + e.accion.slice(1).toLowerCase()}</strong>
                      {e.entidad_id && <span className="cod"> · {e.entidad_id.length > 40 ? e.entidad_id.slice(0, 8) + '…' : e.entidad_id}</span>}
                      <div className="suave" style={{ fontSize: '.85rem' }}>{nombre(e.usuario_id)} · {fecha(e.ocurrido_en)}</div>
                      {e.motivo && <div style={{ fontSize: '.88rem' }}>Motivo: {e.motivo}</div>}
                    </div>
                  </div>
                  {e.detalle != null && (
                    <details style={{ marginTop: '.3rem' }}>
                      <summary className="suave" style={{ cursor: 'pointer', fontSize: '.85rem' }}>Detalle</summary>
                      <pre className="cod" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 260, overflow: 'auto' }}>{JSON.stringify(e.detalle, null, 2)}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="tarjeta">No hay eventos{q && ` con «${q}»`}.</p>}
        </>
      ) : (
        <>
          <p className="suave" style={{ fontSize: '.88rem' }}>
            Lo que falló en el servidor o en el celular de alguien. Si un error se repite, pásale el mensaje a quien mantiene la app.
          </p>
          {errores.length ? (
            <ul className="lista">
              {errores.map((e) => (
                <li key={e.id}>
                  <strong style={{ color: 'var(--error)' }}>{e.mensaje}</strong>
                  <div className="suave" style={{ fontSize: '.85rem' }}>
                    {e.origen === 'SERVIDOR' ? 'Servidor' : 'Celular / navegador'} · {e.origen === 'NAVEGADOR' ? nombre(e.usuario_id) + ' · ' : ''}{fecha(e.ocurrido_en)}
                    {e.ruta && <> · <span className="cod">{e.ruta}</span></>}
                    {e.huella && <> · código <span className="cod">{e.huella}</span></>}
                  </div>
                  {(e.detalle || e.agente) && (
                    <details style={{ marginTop: '.3rem' }}>
                      <summary className="suave" style={{ cursor: 'pointer', fontSize: '.85rem' }}>Detalle técnico</summary>
                      <pre className="cod" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 260, overflow: 'auto' }}>{[e.agente, e.detalle].filter(Boolean).join('\n\n')}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="tarjeta">No hay errores registrados. ✔</p>}
        </>
      )}
      {paginas > 1 && (
        <div className="acciones">
          {pag > 1 && <Link className="boton secundario" href={enlace({ pag: String(pag - 1) })}>← Más recientes</Link>}
          {pag < paginas && <Link className="boton secundario" href={enlace({ pag: String(pag + 1) })}>Más antiguos →</Link>}
        </div>
      )}
    </>
  );
}
