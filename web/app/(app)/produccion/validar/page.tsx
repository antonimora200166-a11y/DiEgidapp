import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe } from '@/lib/roles';
import { FUENTES, claveFuente, paramFuente } from '@/lib/recetario';
import PestanasProduccion from '@/components/PestanasProduccion';
import ValidarRecetario, { type Datos, type Resumen } from './ValidarRecetario';

export const metadata = { title: 'Validar fichas' };
type Tab = 'ingredientes' | 'mpi' | 'recetas';

export default async function Validar({ searchParams }: { searchParams: Promise<{ tab?: string; fuente?: string }> }) {
  const perfil = await perfilActual();
  const sp = await searchParams;
  const clave = claveFuente(sp.fuente);
  const F = FUENTES[clave];
  if (perfil.rol === 'servicio' || !(areasDe(perfil).includes(F.area) || perfil.rol === 'auditor')) redirect('/');
  const tabs: Tab[] = F.conIngredientes ? ['ingredientes', 'mpi', 'recetas'] : ['mpi', 'recetas'];
  const tab = tabs.find((t) => t === sp.tab) ?? tabs[0];
  const q = (t: Tab) => `/produccion/validar?${paramFuente(clave) ? paramFuente(clave) + '&' : ''}tab=${t}`;

  const supabase = await supabaseServidor();
  const [resumen, ingredientes, mpi, genericos] = await Promise.all([
    supabase.rpc('validacion_recetario_resumen', { p_fuente: F.fuente }),
    F.conIngredientes ? supabase.rpc('recetario_ingredientes_lista', { p_fuente: F.fuente }) : Promise.resolve({ data: [], error: null }),
    supabase.rpc('validacion_mpi', { p_fuente: F.fuente }),
    F.conIngredientes
      ? supabase.from('genericos').select('id, nombre, tipo, unidad_base').eq('area', F.area).eq('activo', true)
          .in('tipo', ['MPe', 'MPI', 'SIN_COSTO']).in('clase', ['MATERIA_PRIMA', 'DESECHABLE']).order('nombre')
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [resumen, ingredientes, mpi, genericos]) if (r.error) throw new Error(r.error.message);
  // los platos dependen de las MPI: se muestra cuánto falta allá
  const cocina = clave === 'platos'
    ? (await supabase.rpc('validacion_recetario_resumen', { p_fuente: FUENTES.cocina.fuente })).data as Resumen | null : null;
  const s = resumen.data as Resumen;
  const datos = { ...(mpi.data as Omit<Datos, 'ingredientes' | 'genericos'>), ingredientes: ingredientes.data, genericos: genericos.data } as Datos;
  // de cocina (MPI y platos) cuenta tener ficha; de la carta de cócteles, haberla completado (las bebidas ya tenían ficha)
  const hechas = F.lineasDeReceta ? s.mpi.con_ficha : s.mpi.aprobadas;
  const nPend: Record<Tab, number> = { ingredientes: s.ingredientes.pendientes, mpi: s.mpi.total - hechas - s.mpi.sin_receta - s.mpi.no_es_mpi, recetas: s.recetas.subrecetas - s.recetas.aprobadas };

  return (
    <>
      {F.area === 'COCINA' && <PestanasProduccion activa="fichas" area="COCINA" />}
      <p className="pagina-ancha m-0 mb-1"><Link href={F.volver.href}>← {F.volver.texto}</Link></p>
      <h1 style={{ marginBottom: '.3rem' }}>{F.titulo}</h1>
      <p className="suave mt-0">
        {F.conIngredientes
          ? 'Tres pasos: empareje los ingredientes del recetario con el catálogo, dígale a cada MPI cuál es su receta y apruebe la propuesta como ficha.'
          : F.lineasDeReceta
            ? 'Cada plato de la carta con su receta del recetario: sus componentes son las MPI (subrecetas) y algunos insumos. Revise las porciones y apruebe la ficha. Un componente sin MPI o un ingrediente sin emparejar se resuelve primero en «Validar MPI».'
            : 'Cada bebida ya tiene ficha con sus ingredientes costeados. Al aprobar, nace una versión nueva que suma de la carta el procedimiento, la descripción, la presentación, el método y los alérgenos.'}
        {' '}Nada se vuelve ficha sin su aprobación.{!s.puede_editar && ` Solo ${F.area === 'BAR' ? 'el jefe de barra' : 'el chef'} o administración deciden; usted puede consultar.`}
      </p>
      <div className="cifras">
        <div className="cifra"><span>{F.lineasDeReceta ? `${F.resultados} con ficha` : 'Fichas completadas'}</span><b>{hechas} / {s.mpi.total}</b><small>{s.mpi.receta_elegida} por aprobar</small></div>
        {F.conIngredientes && <div className="cifra"><span>Ingredientes</span><b>{s.ingredientes.confirmados} / {s.ingredientes.total}</b><small>{s.ingredientes.pendientes} por decidir</small></div>}
        <div className="cifra"><span>{F.lineasDeReceta ? 'Recetas aprobadas' : 'Cócteles aprobados'}</span><b>{s.recetas.aprobadas} / {s.recetas.subrecetas}</b>
          <small>{s.recetas.sin_mpi} sin {F.resultado} {clave === 'platos' ? 'elegido' : 'elegida'}</small></div>
        <div className="cifra"><span>Revisadas aparte</span><b>{s.mpi.sin_receta + s.mpi.no_es_mpi}</b><small>{s.mpi.sin_receta} sin {F.receta}</small></div>
        {clave === 'platos' && cocina && <div className="cifra"><span>MPI de cocina con ficha</span><b>{cocina.mpi.con_ficha} / {cocina.mpi.total}</b>
          <small><Link href="/produccion/validar?tab=mpi">Validar MPI</Link></small></div>}
      </div>
      <nav className="segmentos pagina-ancha mb-3" aria-label="Pasos">
        {tabs.map((t, i) => (
          <Link key={t} href={q(t)} aria-current={t === tab ? 'true' : undefined}>
            <span>
              {i + 1}. {t === 'ingredientes' ? 'Ingredientes' : t === 'mpi' ? F.resultados : F.recetas} · {nPend[t]}
            </span>
          </Link>
        ))}
      </nav>
      <ValidarRecetario tab={tab} datos={datos} puedeEditar={s.puede_editar} exactos={s.ingredientes.exactos} clave={clave} />
    </>
  );
}
