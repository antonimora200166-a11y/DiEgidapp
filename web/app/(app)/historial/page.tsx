import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, type Area } from '@/lib/roles';
import { NOMBRE_TIPO, pesos } from './comun';

export const metadata = { title: 'Historial' };

type Fila = { tipo: string; id: string; codigo: string; fecha: string; detalle: string; lineas: number; valor: number | null;
              usuario: string | null; forzado: boolean; anulado: boolean };
const activo = { background: 'var(--marca)', color: 'var(--marca-texto)', borderColor: 'var(--marca)' };

export default async function Historial({ searchParams }: { searchParams: Promise<{ area?: string; tipo?: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio') redirect('/');
  const areas: Area[] = areasDe(perfil).length ? areasDe(perfil) : ['BAR', 'COCINA'];   // auditoría ve las dos
  const sp = await searchParams;
  const area: Area = sp.area && areas.includes(sp.area as Area) ? (sp.area as Area) : areas[0];
  const tipo = sp.tipo && NOMBRE_TIPO[sp.tipo] ? sp.tipo : null;

  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('historial_documentos', { p_area: area, p_tipo: tipo, p_limite: 80 });
  if (error) throw new Error(error.message);
  const filas = (data ?? []) as Fila[];
  const url = (a: Area, t: string | null) => `/historial?area=${a}${t ? `&tipo=${t}` : ''}`;

  return (
    <>
      <h1>Historial</h1>
      <p className="suave">Lo registrado, del más reciente al más antiguo. Un error se corrige anulando el documento: nada se borra.</p>
      {areas.length > 1 && (
        <nav className="segmentos" style={{ marginBottom: '.6rem' }}>
          {areas.map((a) => <Link key={a} href={url(a, tipo)}><span style={a === area ? activo : undefined}>{a === 'BAR' ? 'Bar' : 'Cocina'}</span></Link>)}
        </nav>
      )}
      <nav className="segmentos" style={{ marginBottom: '1rem' }}>
        <Link href={url(area, null)}><span style={!tipo ? activo : undefined}>Todo</span></Link>
        {Object.entries(NOMBRE_TIPO).map(([t, n]) => (
          <Link key={t} href={url(area, t)}><span style={tipo === t ? activo : undefined}>{n.plural}</span></Link>
        ))}
      </nav>
      {filas.length ? (
        <ul className="lista">
          {filas.map((f) => (
            <li key={`${f.tipo}-${f.id}`} style={{ padding: 0, opacity: f.anulado ? 0.65 : 1 }}>
              <Link href={`/historial/${f.tipo.toLowerCase()}/${f.id}`} className="linea" style={{ textDecoration: 'none', padding: '.7rem .85rem' }}>
                <span style={{ minWidth: 0 }}>
                  <span className="suave" style={{ fontSize: '.8rem' }}>{NOMBRE_TIPO[f.tipo].singular} · </span><span className="cod">{f.codigo}</span><br />
                  <span style={f.anulado ? { textDecoration: 'line-through' } : undefined}>{f.detalle}</span>
                  <span className="suave" style={{ display: 'block', fontSize: '.8rem' }}>{f.lineas} línea(s){f.usuario && ` · ${f.usuario}`}</span>
                </span>
                <span className="suave" style={{ fontSize: '.85rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {new Date(f.fecha + 'T12:00:00').toLocaleDateString('es-CO')}
                  {f.valor !== null && <><br />{pesos(Number(f.valor))}</>}
                  {f.anulado ? <><br /><span className="etiqueta inactivo">anulado</span></>
                    : f.forzado && <><br /><span className="etiqueta provisional">forzado</span></>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tarjeta">Todavía no hay {tipo ? NOMBRE_TIPO[tipo].plural.toLowerCase() : 'documentos'} en {area === 'BAR' ? 'bar' : 'cocina'}.</p>
      )}
    </>
  );
}
