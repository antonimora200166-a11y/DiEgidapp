import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, type Area } from '@/lib/roles';

export const metadata = { title: 'Fichas técnicas' };

type Fila = { generico_id: string; nombre: string; tipo: string; unidad_base: string; ficha_id: string | null; codigo: string | null;
              version: number | null; neto_esperado: number | null; lineas: number; faltan: number; primer_falta: string | null; lotes: number };
const TIPO: Record<string, string> = { MPI: 'Producción (MPI)', BEBIDA: 'Cócteles y bebidas', PLATO: 'Platos' };
const FILTROS: Record<string, string> = { incompletas: 'Incompletas', sin: 'Sin ficha', todas: 'Todas' };
const activo = { background: 'var(--marca)', color: 'var(--marca-texto)', borderColor: 'var(--marca)' };
const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export default async function Fichas({ searchParams }: { searchParams: Promise<{ area?: string; ver?: string; tipo?: string; q?: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio') redirect('/');
  const areas: Area[] = areasDe(perfil).length ? areasDe(perfil) : ['BAR', 'COCINA'];
  const sp = await searchParams;
  const area: Area = areas.includes(sp.area as Area) ? (sp.area as Area) : areas[0];
  const ver = sp.ver && FILTROS[sp.ver] ? sp.ver : 'incompletas';
  const tipo = sp.tipo && TIPO[sp.tipo] ? sp.tipo : null;
  const q = (sp.q ?? '').trim();

  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('lista_fichas', { p_area: area });
  if (error) throw new Error(error.message);
  const todas = (data ?? []) as Fila[];
  const incompleta = (f: Fila) => !!f.ficha_id && (f.faltan > 0 || (f.tipo === 'MPI' && f.neto_esperado === null));
  const filas = todas
    .filter((f) => !tipo || f.tipo === tipo)
    .filter((f) => ver === 'todas' || (ver === 'sin' ? !f.ficha_id : incompleta(f)))
    .filter((f) => !q || sinTildes(`${f.nombre} ${f.codigo ?? ''}`).includes(sinTildes(q)));
  const cuenta = { incompletas: todas.filter(incompleta).length, sin: todas.filter((f) => !f.ficha_id).length, todas: todas.length };
  const url = (c: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ area, ver, tipo, q: q || null, ...c })) if (v) p.set(k, v);
    return `/fichas?${p}`;
  };

  return (
    <>
      <h1 className="pagina-ancha">Fichas técnicas</h1>
      <p className="suave">La receta de cada MPI, cóctel y plato: con ella se producen los lotes y se calcula el costo estándar.</p>
      <div style={{ display: 'grid', gap: '.5rem', marginBottom: '1rem' }}>
        {areas.length > 1 && (
          <nav className="segmentos">{areas.map((a) => <Link key={a} href={url({ area: a })}><span style={a === area ? activo : undefined}>{a === 'BAR' ? 'Bar' : 'Cocina'}</span></Link>)}</nav>
        )}
        <nav className="segmentos">
          {Object.entries(FILTROS).map(([k, t]) => <Link key={k} href={url({ ver: k })}><span style={ver === k ? activo : undefined}>{t} ({cuenta[k as keyof typeof cuenta]})</span></Link>)}
        </nav>
        <nav className="segmentos">
          <Link href={url({ tipo: null })}><span style={!tipo ? activo : undefined}>Todos los tipos</span></Link>
          {Object.entries(TIPO).map(([k, t]) => <Link key={k} href={url({ tipo: k })}><span style={tipo === k ? activo : undefined}>{t}</span></Link>)}
        </nav>
        <form style={{ display: 'flex', gap: '.5rem' }}>
          <input type="hidden" name="area" value={area} /><input type="hidden" name="ver" value={ver} />
          {tipo && <input type="hidden" name="tipo" value={tipo} />}
          <input name="q" defaultValue={q} placeholder="Buscar por nombre o código (#5, C02…)" aria-label="Buscar ficha" />
          <button type="submit">Buscar</button>
        </form>
      </div>

      {filas.length ? (
        <ul className="rejilla">
          {filas.map((f) => (
            <li key={f.generico_id}>
              <Link href={`/fichas/${f.generico_id}`} style={{ textDecoration: 'none' }}>
                <strong>{f.codigo ? `${f.codigo} · ` : ''}{f.nombre}</strong>
              </Link>
              <div className="suave" style={{ fontSize: '.85rem' }}>
                {TIPO[f.tipo]}{f.version && f.version > 1 ? ` · versión ${f.version}` : ''}
                {f.ficha_id && <> · {f.lineas} ingrediente(s){f.neto_esperado !== null && ` · rinde ${Number(f.neto_esperado).toLocaleString('es-CO')} ${f.unidad_base}`}</>}
                {f.lotes > 0 && ` · ${f.lotes} lote(s)`}
              </div>
              {!f.ficha_id ? <div style={{ fontSize: '.85rem', color: 'var(--aviso)' }}>Sin ficha técnica</div>
                : incompleta(f) && (
                  <div style={{ fontSize: '.85rem', color: 'var(--aviso)' }}>
                    {f.faltan > 0 ? `${f.faltan} línea(s) por completar: ${f.primer_falta}` : `Falta el neto esperado (${f.unidad_base})`}
                  </div>
                )}
              <Link href={`/fichas/${f.generico_id}`} className="boton secundario" style={{ marginTop: 'auto', minHeight: 38, padding: '.3rem .8rem', alignSelf: 'flex-start' }}>
                {f.ficha_id ? 'Abrir' : 'Crear ficha'}
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="tarjeta">{ver === 'incompletas' ? 'No hay fichas incompletas con estos filtros. ✔' : 'Nada coincide.'}</p>}
    </>
  );
}
