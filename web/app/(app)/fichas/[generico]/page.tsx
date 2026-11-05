import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import EditorFicha, { type DatosFicha } from './EditorFicha';

export const metadata = { title: 'Ficha técnica' };

export default async function Ficha({ params }: { params: Promise<{ generico: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio') redirect('/');
  const { generico } = await params;
  if (!/^[0-9a-f-]{36}$/.test(generico)) notFound();
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('ficha_para_editar', { p_generico: generico });
  if (error) { if (/Solo los MPI/.test(error.message)) notFound(); throw new Error(error.message); }
  const d = data as DatosFicha;
  // costo de la receta vigente: kardex si lo hay; si no, estimado (referencia o receta de la MPI)
  const [costo, estimados] = d.ficha
    ? await Promise.all([supabase.rpc('costo_ficha', { p_ficha: d.ficha.id }), supabase.rpc('ficha_estimados', { p_ficha: d.ficha.id })])
    : [{ data: null }, { data: null }];
  const lineas = (costo.data ?? []) as { linea: number; generico: string; costo: number | null; falta: string | null }[];
  const estimada = new Set(((estimados.data ?? []) as { linea: number; estimado: boolean }[]).filter((x) => x.estimado).map((x) => x.linea));
  const total = lineas.reduce((t, l) => t + Number(l.costo ?? 0), 0);
  const faltan = lineas.filter((l) => l.falta);
  const neto = d.ficha?.neto_esperado ? Number(d.ficha.neto_esperado) : null;
  const pesos = (n: number) => '$' + n.toLocaleString('es-CO', { maximumFractionDigits: n < 10 ? 2 : 0 });

  return (
    <>
      <p className="pagina-ancha" style={{ margin: '0 0 .3rem' }}><Link href="/fichas">← Fichas técnicas</Link></p>
      <h1>{d.ficha ? `${d.ficha.codigo} · ` : ''}{d.resultado.nombre}</h1>
      <p className="suave" style={{ marginTop: '-.6rem' }}>
        {d.resultado.codigo} · resultado en {d.resultado.unidad_base}
        {d.ficha && <> · versión {d.ficha.version} desde {new Date(d.ficha.vigente_desde + 'T12:00:00').toLocaleDateString('es-CO')}
          {Number(d.ficha.lotes) > 0 && ` · usada en ${d.ficha.lotes} lote(s)`}</>}
      </p>
      {d.ficha && lineas.length > 0 && (
        <div className={faltan.length ? 'aviso' : 'tarjeta'} style={{ marginBottom: '.8rem' }}>
          <strong>Costo de la receta: {faltan.length ? 'incompleto' : pesos(total)}</strong>
          {!faltan.length && d.resultado.tipo === 'MPI' && neto && <> · {pesos(total / neto)} por {d.resultado.unidad_base} (rinde {neto.toLocaleString('es-CO')} {d.resultado.unidad_base})</>}
          {!faltan.length && estimada.size > 0 && <div className="suave" style={{ fontSize: '.85rem' }}>
            Estimado: {estimada.size} de {lineas.length} ingrediente(s) aún sin kardex usan su precio de referencia o la receta de su MPI.</div>}
          {faltan.length > 0 && <ul style={{ margin: '.3rem 0 0', paddingLeft: '1.1rem', fontSize: '.88rem' }}>{faltan.map((l) => <li key={l.linea}>{l.falta}</li>)}</ul>}
          {d.ficha.nota?.includes('Neto esperado estimado') && <div className="suave" style={{ fontSize: '.82rem', marginTop: '.3rem' }}>El rendimiento (neto esperado) es una estimación: confírmalo con el próximo lote.</div>}
        </div>
      )}
      <EditorFicha key={d.ficha?.id ?? 'nueva'} datos={d} />
    </>
  );
}
