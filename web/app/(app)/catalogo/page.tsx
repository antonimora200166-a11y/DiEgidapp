import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, editaArea, puedeOperar, type Area } from '@/lib/roles';
import type { Parecido } from '@/lib/catalogo';
import { validarProducto } from './acciones';

export const metadata = { title: 'Catálogo' };

type Provisional = {
  id: string; codigo: string; marca: string; presentacion: string; creado_en: string; nota: string | null;
  genericos: { nombre: string; area: Area; estado: string; unidad_base: string };
  creador: { nombre: string } | null;
};

export default async function Catalogo({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio') redirect('/');
  const { q = '' } = await searchParams;
  const supabase = await supabaseServidor();
  const areas = areasDe(perfil);

  const { data: encontrados } = q.trim().length >= 2
    ? await supabase.rpc('buscar_productos', { p_texto: q, p_area: areas.length === 1 ? areas[0] : null, p_limite: 30 })
    : { data: [] };

  // provisionales de las áreas que este usuario valida
  const valida = areas.filter((a) => editaArea(perfil, a));
  const { data: prov, count: totalProv } = valida.length
    ? await supabase.from('productos')
        .select('id, codigo, marca, presentacion, creado_en, nota, genericos!inner(nombre, area, estado, unidad_base), creador:perfiles!productos_creado_por_fkey(nombre)', { count: 'exact' })
        .eq('estado', 'PROVISIONAL').in('genericos.area', valida).order('creado_en', { ascending: false }).limit(100)
    : { data: [], count: 0 };
  const provisionales = (prov ?? []) as unknown as Provisional[];

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
      {areas.some((a) => puedeOperar(perfil, a)) && (
        <p><Link href="/catalogo/nuevo">¿No está? Crear producto →</Link></p>
      )}

      {q.trim().length >= 2 && (
        <>
          <h2>Resultados</h2>
          {(encontrados as Parecido[] | null)?.length ? (
            <ul className="lista">
              {(encontrados as Parecido[]).map((p) => (
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
      )}

      {valida.length > 0 && (
        <>
          <p className="aviso">Antes de validar, revisa los <Link href="/catalogo/revision">posibles duplicados</Link>: muchos provisionales de la migración son el mismo insumo con otro nombre.</p>
          <h2>Provisionales por validar ({totalProv ?? provisionales.length})</h2>
          {(totalProv ?? 0) > provisionales.length && (
            <p className="suave">Se muestran los {provisionales.length} más recientes. Usa el buscador para encontrar uno en particular.</p>
          )}
          {provisionales.length ? (
            <ul className="lista">
              {provisionales.map((p) => (
                <li key={p.id}>
                  <div className="linea">
                    <div>
                      <strong>{p.genericos.nombre}</strong>{p.marca && ` · ${p.marca}`} · {p.presentacion}
                      {p.genericos.estado === 'PROVISIONAL' && <> · <span className="etiqueta provisional">genérico nuevo</span></>}
                      <div className="cod">
                        {p.codigo} · {p.genericos.area} · {p.creador?.nombre ?? 'migración'} · {new Date(p.creado_en).toLocaleDateString('es-CO')}
                      </div>
                      {p.nota && <div className="suave" style={{ fontSize: '.85rem' }}>{p.nota}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <Link href={`/catalogo/producto/${p.id}`} className="boton">Revisar</Link>
                      <form action={validarProducto}>
                        <input type="hidden" name="id" value={p.id} />
                        <button type="submit" className="secundario" title="Validar sin cambios">Validar</button>
                      </form>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="suave">No hay productos provisionales.</p>}
        </>
      )}
    </>
  );
}
