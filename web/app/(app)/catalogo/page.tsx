import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, editaArea, puedeOperar, type Area } from '@/lib/roles';
import type { Parecido } from '@/lib/catalogo';
import { validarProducto } from './acciones';

export const metadata = { title: 'Catálogo' };
const POR_PAGINA = 50;

type Fila = {
  id: string; codigo: string; marca: string; presentacion: string; estado: string; clase_abc: string | null;
  contenido_base: number | null; contenido_variable: boolean; creado_en: string; nota: string | null;
  genericos: { nombre: string; area: Area; estado: string; unidad_base: string; categoria: string | null; conservacion: string | null };
  creador: { nombre: string } | null;
};
type Filtros = { q?: string; area?: string; estado?: string; falta?: string; abc?: string; pag?: string };

// Lo que le falta a un producto para la operación: se marca en la lista y se filtra
const FALTAS: Record<string, string> = { categoria: 'Sin categoría', frio: 'Sin conservación', factor: 'Sin factor de compra' };

export default async function Catalogo({ searchParams }: { searchParams: Promise<Filtros> }) {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio') redirect('/');
  const f = await searchParams;
  const q = (f.q ?? '').trim();
  const supabase = await supabaseServidor();
  const areas: Area[] = areasDe(perfil).length ? areasDe(perfil) : ['BAR', 'COCINA'];   // auditoría ve todo
  const valida = areas.filter((a) => editaArea(perfil, a));
  const area = areas.includes(f.area as Area) ? (f.area as Area) : null;
  // por defecto, quien valida ve su trabajo pendiente: los provisionales
  const estado = f.estado === 'VALIDADO' || f.estado === 'todos' ? f.estado : valida.length ? 'PROVISIONAL' : 'todos';
  const falta = f.falta && f.falta in FALTAS ? f.falta : null;
  const abc = ['A', 'B', 'C'].includes(f.abc ?? '') ? f.abc! : null;
  const pag = Math.max(1, Number(f.pag) || 1);

  const enlace = (cambios: Partial<Filtros>) => {
    const v: Filtros = { area: area ?? undefined, estado, falta: falta ?? undefined, abc: abc ?? undefined, ...cambios };
    const p = new URLSearchParams();
    for (const [k, x] of Object.entries(v)) if (x && !(k === 'pag' && x === '1')) p.set(k, String(x));
    if (!('pag' in cambios)) p.delete('pag');
    return `/catalogo${p.size ? `?${p}` : ''}`;
  };

  let encontrados: Parecido[] = [];
  let filas: Fila[] = [];
  let total = 0;
  if (q.length >= 2) {
    const { data } = await supabase.rpc('buscar_productos', { p_texto: q, p_area: area ?? (areas.length === 1 ? areas[0] : null), p_limite: 30 });
    encontrados = (data ?? []) as Parecido[];
  } else {
    let consulta = supabase.from('productos')
      .select(`id, codigo, marca, presentacion, estado, clase_abc, contenido_base, contenido_variable, creado_en, nota,
               genericos!inner(nombre, area, estado, unidad_base, categoria, conservacion),
               creador:perfiles!productos_creado_por_fkey(nombre)`, { count: 'exact' })
      .eq('activo', true).in('genericos.area', area ? [area] : areas)
      .order('codigo').range((pag - 1) * POR_PAGINA, pag * POR_PAGINA - 1);
    if (estado !== 'todos') consulta = consulta.eq('estado', estado);
    if (abc) consulta = consulta.eq('clase_abc', abc);
    if (falta === 'categoria') consulta = consulta.is('genericos.categoria', null);
    if (falta === 'frio') consulta = consulta.is('genericos.conservacion', null);
    if (falta === 'factor') consulta = consulta.or('contenido_variable.eq.true,contenido_base.is.null');
    const { data, count } = await consulta;
    filas = (data ?? []) as unknown as Fila[];
    total = count ?? 0;
  }
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const activo = { background: 'var(--marca)', color: 'var(--marca-texto)', borderColor: 'var(--marca)' };
  const chip = (texto: string, href: string, on: boolean) => (
    <Link key={href + texto} href={href}><span style={on ? activo : undefined}>{texto}</span></Link>
  );
  const faltasDe = (p: Fila) => [
    !p.genericos.categoria && FALTAS.categoria,
    !p.genericos.conservacion && FALTAS.frio,
    (p.contenido_variable || !p.contenido_base) && FALTAS.factor,
  ].filter(Boolean) as string[];

  return (
    <>
      <h1>Catálogo</h1>
      <form className="fila" style={{ gridTemplateColumns: '1fr auto', alignItems: 'end' }}>
        <div>
          <label htmlFor="q">Buscar <span className="ayuda">genérico, marca o nombre de factura</span></label>
          <input id="q" name="q" defaultValue={q} autoComplete="off" />
        </div>
        <button type="submit">Buscar</button>
      </form>
      <p style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        {areas.some((a) => puedeOperar(perfil, a)) && <Link href="/catalogo/nuevo">¿No está? Crear producto →</Link>}
        {valida.length > 0 && <Link href="/catalogo/revision">Revisar duplicados →</Link>}
      </p>

      {q.length >= 2 ? (
        <>
          <h2>Resultados para «{q}» <Link href={enlace({})} className="suave" style={{ fontSize: '.9rem', fontWeight: 400 }}>· quitar búsqueda</Link></h2>
          {encontrados.length ? (
            <ul className="lista">
              {encontrados.map((p) => (
                <li key={p.producto_id} className="linea">
                  <div>
                    {valida.includes(p.area)
                      ? <Link href={`/catalogo/producto/${p.producto_id}`}><strong>{p.generico}</strong>{p.marca && ` · ${p.marca}`}{p.presentacion && ` · ${p.presentacion}`}</Link>
                      : <><strong>{p.generico}</strong>{p.marca && ` · ${p.marca}`}{p.presentacion && ` · ${p.presentacion}`}</>}
                    <div className="cod">{p.codigo} · {p.area} · <span className={`etiqueta ${p.activo ? p.estado.toLowerCase() : 'inactivo'}`}>{p.activo ? p.estado : 'INACTIVO'}</span></div>
                  </div>
                  <span className="pct">{Math.round(p.parecido * 100)} %</span>
                </li>
              ))}
            </ul>
          ) : <p className="suave">Nada parecido a «{q}».</p>}
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gap: '.5rem', margin: '.5rem 0 1rem' }}>
            {areas.length > 1 && (
              <nav className="segmentos" aria-label="Área">
                {chip('Bar y cocina', enlace({ area: undefined }), !area)}
                {areas.map((a) => chip(a === 'BAR' ? 'Bar' : 'Cocina', enlace({ area: a }), area === a))}
              </nav>
            )}
            <nav className="segmentos" aria-label="Estado">
              {chip('Provisionales', enlace({ estado: 'PROVISIONAL' }), estado === 'PROVISIONAL')}
              {chip('Validados', enlace({ estado: 'VALIDADO' }), estado === 'VALIDADO')}
              {chip('Todos', enlace({ estado: 'todos' }), estado === 'todos')}
            </nav>
            <nav className="segmentos" aria-label="Le falta">
              {Object.entries(FALTAS).map(([k, t]) => chip(t, enlace({ falta: falta === k ? undefined : k }), falta === k))}
              {(['A', 'B', 'C'] as const).map((c) => chip(`Clase ${c}`, enlace({ abc: abc === c ? undefined : c }), abc === c))}
            </nav>
          </div>

          <p className="suave" style={{ margin: '0 0 .6rem' }}>
            {total} producto(s){paginas > 1 && ` · página ${pag} de ${paginas}`}
            {estado === 'PROVISIONAL' && valida.length > 0 && total > 0 && ' · antes de validar, mira si están en Revisar duplicados'}
          </p>
          {filas.length ? (
            <ul className="lista">
              {filas.map((p) => {
                const faltas = faltasDe(p);
                const edita = valida.includes(p.genericos.area);
                return (
                  <li key={p.id}>
                    <div className="linea">
                      <div>
                        {edita
                          ? <Link href={`/catalogo/producto/${p.id}`}><strong>{p.genericos.nombre}</strong>{p.marca && ` · ${p.marca}`} · {p.presentacion}</Link>
                          : <><strong>{p.genericos.nombre}</strong>{p.marca && ` · ${p.marca}`} · {p.presentacion}</>}
                        <div className="cod">
                          {p.codigo} · {p.genericos.area} · <span className={`etiqueta ${p.estado.toLowerCase()}`}>{p.estado}</span>
                          {p.clase_abc && <> · clase {p.clase_abc}</>}
                          {p.estado === 'PROVISIONAL' && <> · {p.creador?.nombre ?? 'migración'}</>}
                        </div>
                        {faltas.length > 0 && <div style={{ fontSize: '.82rem', color: 'var(--aviso)' }}>Falta: {faltas.join(' · ').toLowerCase()}</div>}
                      </div>
                      {edita && (
                        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <Link href={`/catalogo/producto/${p.id}`} className={`boton${p.estado === 'PROVISIONAL' ? '' : ' secundario'}`}>
                            {p.estado === 'PROVISIONAL' ? 'Revisar' : 'Editar'}
                          </Link>
                          {p.estado === 'PROVISIONAL' && (
                            <form action={validarProducto}>
                              <input type="hidden" name="id" value={p.id} />
                              <button type="submit" className="secundario" title="Validar sin cambios">Validar</button>
                            </form>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <p className="tarjeta">No hay productos con estos filtros. ✔</p>}
          {paginas > 1 && (
            <div className="acciones">
              {pag > 1 && <Link className="boton secundario" href={enlace({ pag: String(pag - 1) })}>← Anterior</Link>}
              {pag < paginas && <Link className="boton secundario" href={enlace({ pag: String(pag + 1) })}>Siguiente →</Link>}
            </div>
          )}
        </>
      )}
    </>
  );
}
