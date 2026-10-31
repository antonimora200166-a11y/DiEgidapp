import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, editaArea, type Area } from '@/lib/roles';
import TarjetaPar, { type Par } from './TarjetaPar';

export const metadata = { title: 'Revisar duplicados' };
const POR_PAGINA = 150;

type GenericoFila = { id: string; codigo: string; nombre: string; unidad_base: string; estado: string; activo: boolean };
type ParFila = {
  id: string; area: Area; tipo: string; parecido: number; propuesta: string; motivo: string | null;
  a_fuente: string; a_nombre: string; b_fuente: string; b_nombre: string;
  a: GenericoFila | null; b: GenericoFila | null;
};

export default async function Revision({ searchParams }: { searchParams: Promise<{ area?: string; tipo?: string; pag?: string }> }) {
  const perfil = await perfilActual();
  const valida = areasDe(perfil).filter((a) => editaArea(perfil, a));
  if (!valida.length) redirect('/');
  const { area: areaParam, tipo, pag: pagParam } = await searchParams;
  const pag = Math.max(1, Number(pagParam) || 1);
  const area = valida.includes(areaParam as Area) ? (areaParam as Area) : null;
  const supabase = await supabaseServidor();

  let consulta = supabase.from('revision_catalogo')
    .select(`id, area, tipo, parecido, propuesta, motivo, a_fuente, a_nombre, b_fuente, b_nombre,
             a:genericos!revision_catalogo_a_generico_id_fkey(id, codigo, nombre, unidad_base, estado, activo),
             b:genericos!revision_catalogo_b_generico_id_fkey(id, codigo, nombre, unidad_base, estado, activo)`, { count: 'exact' })
    .is('decision', null).in('area', area ? [area] : valida)
    // primero lo más seguro: duplicados exactos y los más parecidos
    .order('tipo', { ascending: false }).order('parecido', { ascending: false }).order('id')
    .range((pag - 1) * POR_PAGINA, pag * POR_PAGINA - 1);
  if (tipo === 'DUPLICADO' || tipo === 'CASI-DUPLICADO') consulta = consulta.eq('tipo', tipo);
  const [{ data, count }, { count: decididos }] = await Promise.all([
    consulta,
    supabase.from('revision_catalogo').select('id', { count: 'exact', head: true }).not('decision', 'is', null).in('area', area ? [area] : valida),
  ]);
  const filas = (data ?? []) as unknown as ParFila[];

  // productos de los genéricos en pantalla
  const ids = [...new Set(filas.flatMap((f) => [f.a?.id, f.b?.id]).filter(Boolean))] as string[];
  // por tandas de 100: con 150 pares son hasta 300 genéricos y la dirección de la consulta tiene límite
  const tandas = await Promise.all(Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) =>
    supabase.from('productos').select('codigo, generico_id, marca, presentacion, activo')
      .in('generico_id', ids.slice(i * 100, (i + 1) * 100)).order('activo', { ascending: false }).order('codigo')));
  const prods = tandas.flatMap((t) => t.data ?? []);
  const productosDe = (id?: string) => (prods ?? []).filter((p) => p.generico_id === id);

  const pares: Par[] = filas.map((f) => ({
    id: f.id, area: f.area, tipo: f.tipo, parecido: Number(f.parecido), propuesta: f.propuesta, motivo: f.motivo,
    a: { fuente: f.a_fuente, nombre: f.a_nombre, generico: f.a, productos: productosDe(f.a?.id) },
    b: { fuente: f.b_fuente, nombre: f.b_nombre, generico: f.b, productos: productosDe(f.b?.id) },
  }));
  const pendientes = count ?? 0;
  const total = pendientes + (decididos ?? 0);
  const enlace = (cambios: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const v = { area, tipo: tipo ?? null, ...cambios };
    for (const [k, x] of Object.entries(v)) if (x) p.set(k, x);
    return `/catalogo/revision${p.size ? `?${p}` : ''}`;
  };

  return (
    <>
      <h1>Revisar duplicados</h1>
      <p className="suave">
        Posibles repetidos que dejó la migración. Decide si son <strong>el mismo insumo</strong> (se unen: nada se borra, el que sobra queda inactivo)
        o <strong>distintos</strong>. Llevas <strong>{decididos ?? 0} de {total}</strong>.
      </p>
      {total > 0 && (
        <div style={{ height: 8, background: 'var(--borde)', borderRadius: 99, overflow: 'hidden', margin: '0 0 1rem' }} aria-hidden>
          <div style={{ width: `${Math.round(((decididos ?? 0) / total) * 100)}%`, height: '100%', background: 'var(--ok)' }} />
        </div>
      )}
      <nav className="segmentos" aria-label="Filtros" style={{ marginBottom: '1rem' }}>
        {valida.length > 1 && (
          <>
            <Link href={enlace({ area: null })}><span style={area ? undefined : { background: 'var(--marca)', color: 'var(--marca-texto)' }}>Todas</span></Link>
            {valida.map((a) => (
              <Link key={a} href={enlace({ area: a })}><span style={area === a ? { background: 'var(--marca)', color: 'var(--marca-texto)' } : undefined}>{a === 'BAR' ? 'Bar' : 'Cocina'}</span></Link>
            ))}
          </>
        )}
        <Link href={enlace({ tipo: tipo === 'DUPLICADO' ? null : 'DUPLICADO' })}>
          <span style={tipo === 'DUPLICADO' ? { background: 'var(--marca)', color: 'var(--marca-texto)' } : undefined}>Solo duplicados exactos</span>
        </Link>
      </nav>

      {pares.length ? (
        <>
          <ul className="lista" style={{ gap: '1rem' }}>
            {pares.map((p) => <TarjetaPar key={p.id} par={p} />)}
          </ul>
          {(pag > 1 || pendientes > pag * POR_PAGINA) && (
            <div className="acciones">
              {pag > 1 && <Link className="boton secundario" href={enlace({ pag: pag === 2 ? null : String(pag - 1) })}>← Anteriores</Link>}
              {pendientes > pag * POR_PAGINA && (
                <Link className="boton secundario" href={enlace({ pag: String(pag + 1) })}>
                  Ver los siguientes ({Math.min(POR_PAGINA, pendientes - pag * POR_PAGINA)} de {pendientes - pag * POR_PAGINA} más)
                </Link>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="tarjeta">No quedan pares por revisar{area ? ` en ${area === 'BAR' ? 'bar' : 'cocina'}` : ''}. ✔</p>
      )}
    </>
  );
}
