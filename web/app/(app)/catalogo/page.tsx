import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, editaArea, puedeOperar, type Area } from '@/lib/roles';
import BarraFiltros from './BarraFiltros';
import ListaCatalogo from './ListaCatalogo';
import TablaCatalogo from './TablaCatalogo';
import type { ProductoCatalogo } from './tipos';

export const metadata = { title: 'Catálogo' };
const TAMANOS = [80, 200, 500];

// Filtros en la dirección, separados por coma: ?tipo=MPe,MPI&unidad=g&cat=LACTEOS…
// (los enlaces viejos ?estado=todos o ?falta=frio siguen sirviendo)
type Params = Record<string, string | undefined>;
const lista = (s: string | undefined, validos?: string[]) =>
  (s ?? '').split(',').map((x) => x.trim()).filter((x) => x && (!validos || validos.includes(x)));

export default async function Catalogo({ searchParams }: { searchParams: Promise<Params> }) {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio') redirect('/');
  const sp = await searchParams;
  const supabase = await supabaseServidor();
  const areas: Area[] = areasDe(perfil).length ? areasDe(perfil) : ['BAR', 'COCINA'];   // auditoría ve todo
  const valida = areas.filter((a) => editaArea(perfil, a));

  const areasFiltro = lista(sp.area, areas);
  const filtros = {
    areas: areasFiltro.length ? areasFiltro : areas,
    estados: lista(sp.estado, ['PROVISIONAL', 'VALIDADO']),
    activos: ['inactivos', 'todos'].includes(sp.activos ?? '') ? sp.activos : 'activos',
    tipos: lista(sp.tipo, ['MPe', 'MPI', 'SIN_COSTO', 'BEBIDA', 'PLATO']),
    unidades: lista(sp.unidad, ['g', 'ml', 'und']),
    categorias: lista(sp.cat),
    conservacion: lista(sp.cons, ['Ambiente', 'Refrigerado', 'Congelado', 'SIN']),
    abc: lista(sp.abc, ['A', 'B', 'C', 'SIN']),
    faltas: lista(sp.falta, ['categoria', 'frio', 'factor', 'costo', 'tara']),
    kardex: ['con', 'sin'].includes(sp.kardex ?? '') ? sp.kardex : null,
    variable: ['true', 'false'].includes(sp.variable ?? '') ? sp.variable : null,
    q: (sp.q ?? '').trim(),
  };
  const por = TAMANOS.includes(Number(sp.por)) ? Number(sp.por) : TAMANOS[0];
  const pag = Math.max(1, Number(sp.pag) || 1);
  const vista = sp.vista === 'tarjetas' ? 'tarjetas' : 'lista';

  const [{ data, error }, { data: categorias }] = await Promise.all([
    supabase.rpc('catalogo_filtrado', { p_filtros: filtros, p_orden: sp.orden ?? 'nombre', p_agrupar: sp.agrupar ?? null,
                                        p_limite: por, p_desde: (pag - 1) * por }),
    supabase.from('categorias').select('codigo, nombre, area').in('area', areas).eq('activo', true).order('area').order('nombre'),
  ]);
  if (error) throw new Error(error.message);
  const filas: ProductoCatalogo[] = ((data ?? []) as Omit<ProductoCatalogo, 'edita'>[])
    .map((p) => ({ ...p, edita: valida.includes(p.area) }));
  const total = filas.length ? Number(filas[0].total) : 0;
  const paginas = Math.max(1, Math.ceil(total / por));
  const enlace = (cambios: Params) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...cambios })) if (v) p.set(k, v);
    return `/catalogo${p.size ? `?${p}` : ''}`;
  };
  const desde = total ? (pag - 1) * por + 1 : 0;

  return (
    <>
      <h1 className="pagina-ancha">Catálogo</h1>
      <p style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', margin: '0 0 .4rem' }}>
        {areas.some((a) => puedeOperar(perfil, a)) && <Link href="/catalogo/nuevo">¿No está? Crear producto →</Link>}
        {valida.length > 0 && <Link href="/catalogo/unidades">Revisar unidades →</Link>}
        {valida.length > 0 && <Link href="/catalogo/revision">Revisar duplicados →</Link>}
        <Link href="/fichas">Fichas técnicas →</Link>
      </p>
      <BarraFiltros areas={areas} categorias={categorias ?? []} />

      <div className="linea" style={{ flexWrap: 'wrap', margin: '0 0 .6rem' }}>
        <span className="suave">{total ? `${desde}-${Math.min(pag * por, total)} de ${total} producto(s)` : '0 productos'}</span>
        <span style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
          <span className="suave" style={{ fontSize: '.85rem' }}>Por página:</span>
          {TAMANOS.map((t) => (
            <Link key={t} href={enlace({ por: t === TAMANOS[0] ? undefined : String(t), pag: undefined })}
                  className={`boton secundario`} style={{ minHeight: 32, padding: '.1rem .55rem', ...(t === por ? { background: 'var(--marca)', color: 'var(--marca-texto)' } : {}) }}>{t}</Link>
          ))}
          {pag > 1 && <Link className="boton secundario" style={{ minHeight: 32, padding: '.1rem .6rem' }} href={enlace({ pag: String(pag - 1) })} aria-label="Página anterior">‹</Link>}
          {pag < paginas && <Link className="boton secundario" style={{ minHeight: 32, padding: '.1rem .6rem' }} href={enlace({ pag: String(pag + 1) })} aria-label="Página siguiente">›</Link>}
        </span>
      </div>

      {filas.length ? (
        vista === 'lista'
          ? <TablaCatalogo filas={filas} categorias={categorias ?? []} esAdmin={perfil.rol === 'admin'} />
          : <ListaCatalogo filas={filas} categorias={categorias ?? []} esAdmin={perfil.rol === 'admin'} />
      ) : <p className="tarjeta">No hay productos con estos filtros.</p>}

      {paginas > 1 && (
        <div className="acciones">
          {pag > 1 && <Link className="boton secundario" href={enlace({ pag: String(pag - 1) })}>← Anterior</Link>}
          <span className="suave" style={{ alignSelf: 'center' }}>Página {pag} de {paginas}</span>
          {pag < paginas && <Link className="boton secundario" href={enlace({ pag: String(pag + 1) })}>Siguiente →</Link>}
        </div>
      )}
    </>
  );
}
