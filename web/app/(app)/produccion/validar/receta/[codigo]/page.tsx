import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { tipoPunto } from '@/lib/fichas';
import { FUENTES, claveFuente, paramFuente } from '@/lib/recetario';
import PestanasProduccion from '@/components/PestanasProduccion';
import EditorFicha, { type DatosFicha, type InicialFicha } from '../../../../fichas/[generico]/EditorFicha';
import { inicialDesdePropuesta, type Propuesta } from '@/lib/propuesta-ficha';

export const metadata = { title: 'Aprobar propuesta de ficha' };

// Paso final: la propuesta abre en el editor de fichas; quien decide la corrige y la aprueba.
export default async function AprobarReceta({ params, searchParams }: { params: Promise<{ codigo: string }>; searchParams: Promise<{ fuente?: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio') redirect('/');
  const { codigo } = await params;
  const clave = claveFuente((await searchParams).fuente);
  const F = FUENTES[clave];
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('propuesta_receta', { p_fuente: F.fuente, p_codigo: decodeURIComponent(codigo) });
  if (error) { if (/No existe/.test(error.message)) notFound(); throw new Error(error.message); }
  const p = data as Propuesta;
  const r = p.receta;
  const pr = p.propuesta ?? {};
  const pf = paramFuente(clave) ? paramFuente(clave) + '&' : '';
  const volver = `/produccion/validar?${pf}tab=mpi`;

  let datos: DatosFicha | null = null;
  if (r.generico_id) {
    const f = await supabase.rpc('ficha_para_editar', { p_generico: r.generico_id });
    if (f.error) throw new Error(f.error.message);
    datos = f.data as DatosFicha;
  }
  const sugeridos = pr.alergenos_sugeridos ?? [];
  const faltan = F.lineasDeReceta ? p.lineas.filter((l) => !l.generico_id) : [];
  const inicial: InicialFicha | undefined = datos ? inicialDesdePropuesta(p, datos, F.lineasDeReceta) : undefined;

  return (
    <>
      {F.area === 'COCINA' && <PestanasProduccion activa="fichas" area="COCINA" />}
      <p className="pagina-ancha" style={{ margin: '0 0 .3rem' }}><Link href={volver}>← {F.titulo}</Link></p>
      <h1 style={{ marginBottom: '.2rem' }}>{r.nombre}</h1>
      <p className="suave" style={{ marginTop: 0 }}>
        <span className="cod">{r.codigo}</span> de {(clave === 'platos' ? FUENTES.cocina.fuente : F.fuente).toLowerCase()}{F.lineasDeReceta && r.rendimiento ? ` · rinde ${Number(r.rendimiento).toLocaleString('es-CO')} ${r.unidad}` : ''}
        {pr.concepto ? ` · ${pr.concepto.toLowerCase()}` : ''}
        {datos && <> · {datos.ficha ? 'completa' : 'será'} la ficha de <Link href={`/fichas/${datos.resultado.id}`}><strong>{datos.resultado.nombre}</strong></Link>
          {datos.ficha ? ` (hoy v${datos.ficha.version})` : ''}</>}
      </p>

      {r.estado === 'APROBADA' ? (
        <p className="exito">Ya se aprobó. <Link href={`/fichas/${r.generico_id}`}>Ver la ficha</Link></p>
      ) : !datos || !inicial ? (
        <p className="aviso">Aún no tiene {F.resultado} elegida. Elíjala en <Link href={`/produccion/validar?${pf}tab=recetas`}>{F.recetas}</Link>.</p>
      ) : (
        <>
          <div className="dos-col pagina-ancha" style={{ marginBottom: '1rem' }}>
            <section className="tarjeta">
              <h2 className="sec-tit">Antes de aprobar, revise</h2>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: '.35rem' }}>
                {clave === 'platos' ? (
                  <>
                    <li><strong>Porciones</strong>: la receta rinde {r.rendimiento ?? 1} {r.unidad ?? 'porciones'}. Las MPI van en porciones: si una no tiene el peso de su porción, escríbalo en la línea (factor) o la ficha no la costea.</li>
                    <li><strong>Componentes</strong>: cada subreceta es una MPI; si alguna sale «sin emparejar», elíjale su MPI en <Link href="/produccion/validar?tab=recetas">Validar MPI</Link>.</li>
                  </>
                ) : F.conIngredientes ? (
                  <>
                    <li><strong>Neto esperado en gramos</strong>: {r.unidad === 'g' ? `el recetario dice ${r.rendimiento} g; confírmelo.`
                      : `el recetario dice ${r.rendimiento ?? '—'} ${r.unidad ?? ''}. Pese una tanda terminada.`}
                      {pr.suma_entrada_g ? ` Lo que entra suma ≈ ${pr.suma_entrada_g.toLocaleString('es-CO')} g${pr.suma_completa ? '' : ' (sin contar lo que va en unidades)'}.` : ''}</li>
                    <li><strong>Vida útil</strong>: el recetario no la trae; agréguela según dónde se guarde.</li>
                  </>
                ) : (
                  <li><strong>Ingredientes</strong>: se dejan los de la ficha (ya costeados). Compárelos con los de la carta a la derecha y ajuste cantidades si cambiaron.</li>
                )}
                {(pr.puntos ?? []).length > 0 && <li><strong>Puntos críticos</strong>: los propuso la app con el texto de los pasos ({(pr.puntos ?? []).map((x) => tipoPunto(x.tipo).t.toLowerCase()).join(', ')}). Quite o ajuste los que no sirvan.</li>}
                {sugeridos.length > 0 && <li><strong>Alérgenos sugeridos por los ingredientes</strong>: {sugeridos.join(', ')}. Ya van marcados; desmarque los que no apliquen.</li>}
                {(pr.observaciones ?? []).length > 0 && <li><strong>Notas del documento</strong>: van en observaciones.</li>}
                {faltan.length > 0 && <li style={{ color: 'var(--aviso)' }}><strong>{faltan.length} ingrediente(s) sin emparejar</strong> no entran a la ficha:{' '}
                  {faltan.map((l) => l.nombre ?? l.codigo).join(', ')}. <Link href={faltan.some((l) => l.tipo === 'ing') ? '/produccion/validar?tab=ingredientes' : '/produccion/validar?tab=recetas'}>Emparéjelos</Link> y vuelva, o agréguelos abajo.</li>}
              </ul>
            </section>
            <details className="tarjeta" open={!F.lineasDeReceta}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{F.lineasDeReceta ? 'Receta original del recetario' : 'Así está en la carta'}</summary>
              <ul className="renglones" style={{ marginTop: '.5rem' }}>
                {p.lineas.map((l, i) => <li key={i}><span>{l.nombre ?? l.codigo}{l.generico && l.generico !== l.nombre ? <span className="suave"> → {l.generico}</span> : ''}
                  {l.nota && <span className="suave" style={{ display: 'block', fontSize: '.78rem' }}>{l.nota}</span>}</span>
                  <span className="n">{l.cantidad ?? '—'} {l.unidad}</span></li>)}
              </ul>
              {(pr.decoracion ?? []).length > 0 && <p style={{ fontSize: '.88rem' }}><strong>Decoración:</strong> {pr.decoracion!.join(' · ')}</p>}
              <p style={{ whiteSpace: 'pre-line', fontSize: '.9rem' }}>{r.procedimiento ?? 'Sin procedimiento.'}</p>
            </details>
          </div>
          <EditorFicha datos={datos} inicial={inicial} receta={{ fuente: F.fuente, codigo: r.codigo }} volverA={volver} />
        </>
      )}
    </>
  );
}
