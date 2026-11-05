import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { tipoPunto, type Punto } from '@/lib/fichas';
import PestanasProduccion from '@/components/PestanasProduccion';
import EditorFicha, { type DatosFicha, type InicialFicha } from '../../../../fichas/[generico]/EditorFicha';

export const metadata = { title: 'Aprobar receta del recetario' };
const FUENTE = 'RECETARIO COCINA';

type Linea = { tipo: 'ing' | 'sub'; codigo: string; cantidad: number | null; unidad: string | null; nombre: string | null; estado: string | null;
               generico_id: string | null; generico: string | null; unidad_base: string | null };
type Propuesta = {
  receta: { codigo: string; nombre: string; descripcion: string | null; rendimiento: number | null; unidad: string | null; alergenos: string[];
            procedimiento: string | null; estado: string; generico_id: string | null; ficha_id: string | null };
  propuesta: { pasos?: string[]; puntos?: (Punto & { de: string })[]; observaciones?: string[]; metodo?: string | null;
               alergenos_declarados?: string[]; alergenos_sugeridos?: string[]; suma_entrada_g?: number | null; suma_completa?: boolean };
  lineas: Linea[];
};

// Paso 3: la propuesta del recetario abre en el editor de fichas; el chef la corrige y la aprueba.
export default async function AprobarReceta({ params }: { params: Promise<{ codigo: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio') redirect('/');
  const { codigo } = await params;
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('propuesta_receta', { p_fuente: FUENTE, p_codigo: decodeURIComponent(codigo) });
  if (error) { if (/No existe/.test(error.message)) notFound(); throw new Error(error.message); }
  const p = data as Propuesta;
  const r = p.receta;
  const pr = p.propuesta ?? {};
  const volver = '/produccion/validar?tab=mpi';

  let datos: DatosFicha | null = null;
  if (r.generico_id) {
    const f = await supabase.rpc('ficha_para_editar', { p_generico: r.generico_id });
    if (f.error) throw new Error(f.error.message);
    datos = f.data as DatosFicha;
  }
  const faltan = p.lineas.filter((l) => !l.generico_id);
  const sugeridos = (pr.alergenos_sugeridos ?? []);
  const inicial: InicialFicha = {
    codigo: r.codigo,
    neto: r.unidad === 'g' && r.rendimiento ? String(r.rendimiento) : '',
    tiempo: '',
    porciones: r.unidad === 'porciones' || r.unidad === 'und' ? String(r.rendimiento ?? '') : '',
    metodo: pr.metodo ?? '',
    pasos: pr.pasos ?? [],
    puntos: (pr.puntos ?? []).map((x) => ({ tipo: x.tipo, texto: x.texto })),
    alergenos: [...new Set([...(pr.alergenos_declarados ?? []), ...sugeridos])],
    descripcion: r.descripcion ?? '',
    observaciones: (pr.observaciones ?? []).join(' '),
    lineas: p.lineas.filter((l) => l.generico_id).map((l) => ({
      generico_id: l.generico_id!, cantidad: l.cantidad === null ? '' : String(l.cantidad),
      unidad: l.unidad === 'porciones' ? 'porcion' : l.unidad ?? l.unidad_base ?? 'g', nota: '' })),
  };

  return (
    <>
      <PestanasProduccion activa="fichas" area="COCINA" />
      <p className="pagina-ancha" style={{ margin: '0 0 .3rem' }}><Link href={volver}>← Validar MPI de cocina</Link></p>
      <h1 style={{ marginBottom: '.2rem' }}>{r.nombre}</h1>
      <p className="suave" style={{ marginTop: 0 }}>
        Receta <span className="cod">{r.codigo}</span> del recetario{r.rendimiento ? ` · rinde ${Number(r.rendimiento).toLocaleString('es-CO')} ${r.unidad}` : ''}
        {datos && <> · será la ficha de <Link href={`/fichas/${datos.resultado.id}`}><strong>{datos.resultado.nombre}</strong></Link></>}
      </p>

      {r.estado === 'APROBADA' ? (
        <p className="exito">Esta receta ya se aprobó. <Link href={`/fichas/${r.generico_id}`}>Ver la ficha</Link></p>
      ) : !datos ? (
        <p className="aviso">Esta receta aún no tiene MPI. Elígela o créala en <Link href="/produccion/validar?tab=recetas">Recetas sin MPI</Link>.</p>
      ) : (
        <>
          <div className="dos-col pagina-ancha" style={{ marginBottom: '1rem' }}>
            <section className="tarjeta">
              <h2 className="sec-tit">Antes de aprobar, revisa</h2>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: '.35rem' }}>
                <li><strong>Neto esperado en gramos</strong>: {r.unidad === 'g' ? `el recetario dice ${r.rendimiento} g; confírmalo.`
                  : `el recetario dice ${r.rendimiento ?? '—'} ${r.unidad ?? ''}. Pesa una tanda terminada.`}
                  {pr.suma_entrada_g ? ` Lo que entra suma ≈ ${pr.suma_entrada_g.toLocaleString('es-CO')} g${pr.suma_completa ? '' : ' (sin contar lo que va en unidades)'}.` : ''}</li>
                <li><strong>Vida útil</strong>: el recetario no la trae; agrégala según dónde se guarde.</li>
                {(pr.puntos ?? []).length > 0 && <li><strong>Puntos críticos</strong>: los propuso la app con el texto de los pasos ({(pr.puntos ?? []).map((x) => tipoPunto(x.tipo).t.toLowerCase()).join(', ')}). Quita o ajusta los que no sirvan.</li>}
                {sugeridos.length > 0 && <li><strong>Alérgenos sugeridos por los ingredientes</strong>: {sugeridos.join(', ')}. Ya van marcados; desmarca los que no apliquen.</li>}
                {faltan.length > 0 && <li style={{ color: 'var(--aviso)' }}><strong>{faltan.length} ingrediente(s) sin emparejar</strong> no entran a la ficha:{' '}
                  {faltan.map((l) => l.nombre ?? l.codigo).join(', ')}. <Link href="/produccion/validar?tab=ingredientes">Emparéjalos</Link> y vuelve, o agrégalos abajo.</li>}
              </ul>
            </section>
            <details className="tarjeta">
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Receta original del recetario</summary>
              <ul className="renglones" style={{ marginTop: '.5rem' }}>
                {p.lineas.map((l, i) => <li key={i}><span>{l.nombre ?? l.codigo}{l.generico && l.generico !== l.nombre ? <span className="suave"> → {l.generico}</span> : ''}</span>
                  <span className="n">{l.cantidad ?? '—'} {l.unidad}</span></li>)}
              </ul>
              <p style={{ whiteSpace: 'pre-line', fontSize: '.9rem' }}>{r.procedimiento ?? 'Sin procedimiento.'}</p>
              {r.alergenos.length > 0 && <p className="suave" style={{ fontSize: '.85rem' }}>Alérgenos declarados: {r.alergenos.join(', ')}</p>}
            </details>
          </div>
          <EditorFicha datos={datos} inicial={inicial} receta={{ fuente: FUENTE, codigo: r.codigo }} volverA={volver} />
        </>
      )}
    </>
  );
}
