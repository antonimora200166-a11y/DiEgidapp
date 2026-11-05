import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe } from '@/lib/roles';
import PestanasProduccion from '@/components/PestanasProduccion';
import ValidarRecetario, { type Datos, type Resumen } from './ValidarRecetario';

export const metadata = { title: 'Validar MPI de cocina' };
const TABS = ['ingredientes', 'mpi', 'recetas'] as const;

export default async function Validar({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio' || !(areasDe(perfil).includes('COCINA') || perfil.rol === 'auditor')) redirect('/produccion');
  const pedida = (await searchParams).tab;
  const tab = TABS.find((t) => t === pedida) ?? 'ingredientes';

  const supabase = await supabaseServidor();
  const [resumen, ingredientes, mpi, genericos] = await Promise.all([
    supabase.rpc('validacion_recetario_resumen'),
    supabase.rpc('recetario_ingredientes_lista'),
    supabase.rpc('validacion_mpi'),
    supabase.from('genericos').select('id, nombre, tipo, unidad_base').eq('area', 'COCINA').eq('activo', true)
      .in('tipo', ['MPe', 'MPI', 'SIN_COSTO']).in('clase', ['MATERIA_PRIMA', 'DESECHABLE']).order('nombre'),
  ]);
  for (const r of [resumen, ingredientes, mpi, genericos]) if (r.error) throw new Error(r.error.message);
  const s = resumen.data as Resumen;
  const datos = { ...(mpi.data as Omit<Datos, 'ingredientes' | 'genericos'>), ingredientes: ingredientes.data, genericos: genericos.data } as Datos;
  const nPend = { ingredientes: s.ingredientes.pendientes,
                  mpi: s.mpi.total - s.mpi.con_ficha - s.mpi.sin_receta - s.mpi.no_es_mpi,
                  recetas: s.recetas.sin_mpi };

  return (
    <>
      <PestanasProduccion activa="fichas" area="COCINA" />
      <p className="pagina-ancha" style={{ margin: '0 0 .3rem' }}><Link href="/produccion?area=COCINA">← Fichas de cocina</Link></p>
      <h1 style={{ marginBottom: '.3rem' }}>Validar MPI de cocina con el recetario</h1>
      <p className="suave" style={{ marginTop: 0 }}>
        Tres pasos: empareja los ingredientes del recetario con el catálogo, dile a cada MPI cuál es su receta y aprueba la propuesta como ficha.
        Nada del recetario se vuelve ficha sin tu aprobación.{!s.puede_editar && ' Solo el chef o administración deciden; tú puedes consultar.'}
      </p>
      <div className="cifras">
        <div className="cifra"><span>MPI con ficha</span><b>{s.mpi.con_ficha} / {s.mpi.total}</b><small>{s.mpi.receta_elegida} por aprobar</small></div>
        <div className="cifra"><span>Ingredientes</span><b>{s.ingredientes.confirmados} / {s.ingredientes.total}</b><small>{s.ingredientes.pendientes} por decidir</small></div>
        <div className="cifra"><span>Recetas aprobadas</span><b>{s.recetas.aprobadas} / {s.recetas.subrecetas}</b><small>{s.recetas.sin_mpi} sin MPI</small></div>
        <div className="cifra"><span>Revisadas aparte</span><b>{s.mpi.sin_receta + s.mpi.no_es_mpi}</b><small>{s.mpi.sin_receta} sin receta · {s.mpi.no_es_mpi} no son MPI</small></div>
      </div>
      <nav className="segmentos pagina-ancha" aria-label="Pasos" style={{ marginBottom: '1rem' }}>
        {TABS.map((t, i) => (
          <Link key={t} href={`/produccion/validar?tab=${t}`}>
            <span style={t === tab ? { background: 'var(--marca)', color: 'var(--marca-texto)', borderColor: 'var(--marca)' } : undefined}>
              {i + 1}. {t === 'ingredientes' ? 'Ingredientes' : t === 'mpi' ? 'MPI' : 'Recetas sin MPI'} · {nPend[t]}
            </span>
          </Link>
        ))}
      </nav>
      <ValidarRecetario tab={tab} datos={datos} puedeEditar={s.puede_editar} exactos={s.ingredientes.exactos} />
    </>
  );
}
