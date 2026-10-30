import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { editaArea, type Area } from '@/lib/roles';

export const metadata = { title: 'Listo para arrancar' };

type Punto = { clave: string; titulo: string; estado: 'ok' | 'aviso' | 'falta'; valor: string; detalle?: string | null; ejemplos?: string[]; mas?: number };
const MARCA = { ok: { s: '✓', c: 'var(--ok)' }, aviso: { s: '!', c: 'var(--aviso)' }, falta: { s: '✕', c: 'var(--error)' } };

// A dónde ir para resolver cada punto
function enlace(clave: string, area: Area, admin: boolean): { href: string; texto: string } | null {
  switch (clave) {
    case 'usuarios': return admin ? { href: '/admin/usuarios', texto: 'Ir a Usuarios' } : null;
    case 'conteo_inicial': return { href: '/conteo', texto: 'Ir a Contar' };
    case 'provisionales': return { href: `/catalogo?area=${area}&estado=PROVISIONAL`, texto: 'Ver provisionales' };
    case 'pares': return { href: '/catalogo/revision', texto: 'Revisar duplicados' };
    case 'fichas': return { href: `/producir?area=${area}`, texto: 'Ir a Producir' };
    case 'frio': return { href: `/catalogo?area=${area}&estado=todos&falta=frio`, texto: 'Ver en el catálogo' };
    default: return null;
  }
}

export default async function Arranque() {
  const perfil = await perfilActual();
  const admin = perfil.rol === 'admin' || perfil.rol === 'auditor';
  const areas = (['BAR', 'COCINA'] as Area[]).filter((a) => admin || editaArea(perfil, a));
  if (!areas.length) redirect('/');
  const supabase = await supabaseServidor();
  const resultados = await Promise.all(areas.map((a) => supabase.rpc('estado_arranque', { p_area: a })));
  const porArea = areas.map((a, i) => {
    if (resultados[i].error) throw new Error(resultados[i].error!.message);
    return { area: a, puntos: (resultados[i].data ?? []) as Punto[] };
  });
  const todos = porArea.flatMap((x) => x.puntos);
  const faltas = todos.filter((p) => p.estado === 'falta').length;
  const avisos = todos.filter((p) => p.estado === 'aviso').length;
  const conIA = !!process.env.ANTHROPIC_API_KEY;

  return (
    <>
      <h1>¿Listo para arrancar?</h1>
      <p className={faltas ? 'error' : avisos ? 'aviso' : 'exito'} role="status">
        {faltas ? <><strong>Todavía no.</strong> {faltas} punto(s) impiden que el kardex arranque bien.</>
          : avisos ? <><strong>Se puede arrancar</strong>, con {avisos} pendiente(s) que conviene resolver.</>
          : <><strong>Todo listo.</strong></>}
      </p>
      {porArea.map(({ area, puntos }) => (
        <section key={area}>
          <h2>{area === 'BAR' ? 'Bar' : 'Cocina'}</h2>
          <ul className="lista">
            {puntos.map((p) => {
              const ir = p.estado !== 'ok' ? enlace(p.clave, area, perfil.rol === 'admin') : null;
              return (
                <li key={p.clave} style={p.estado !== 'ok' ? { borderColor: MARCA[p.estado].c } : undefined}>
                  <div className="linea" style={{ alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <strong>{p.titulo}</strong>
                      <div className="suave" style={{ fontSize: '.88rem' }}>{p.valor}</div>
                    </div>
                    <span aria-label={p.estado} style={{ color: MARCA[p.estado].c, fontWeight: 800, fontSize: '1.2rem' }}>{MARCA[p.estado].s}</span>
                  </div>
                  {p.detalle && <p style={{ margin: '.4rem 0 0', fontSize: '.9rem' }}>{p.detalle}</p>}
                  {p.estado !== 'ok' && !!p.ejemplos?.length && (
                    <p className="suave" style={{ margin: '.3rem 0 0', fontSize: '.85rem' }}>{p.ejemplos.join(' · ')}{!!p.mas && ` y ${p.mas} más`}</p>
                  )}
                  {ir && <Link href={ir.href} className="boton secundario" style={{ marginTop: '.5rem', display: 'inline-flex' }}>{ir.texto}</Link>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <h2>General</h2>
      <ul className="lista">
        <li>
          <div className="linea" style={{ alignItems: 'flex-start' }}>
            <div>
              <strong>Lectura de facturas con IA</strong>
              <div className="suave" style={{ fontSize: '.88rem' }}>{conIA ? 'Activa' : 'Apagada: las líneas de la recepción se escriben a mano'}</div>
            </div>
            <span style={{ color: conIA ? 'var(--ok)' : 'var(--suave)', fontWeight: 800, fontSize: '1.2rem' }}>{conIA ? '✓' : '–'}</span>
          </div>
          {!conIA && <p style={{ margin: '.4rem 0 0', fontSize: '.9rem' }}>No impide arrancar. Se enciende agregando ANTHROPIC_API_KEY en Vercel.</p>}
        </li>
      </ul>
    </>
  );
}
