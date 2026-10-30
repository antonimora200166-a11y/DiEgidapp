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

  return (
    <>
      <p className="pagina-ancha" style={{ margin: '0 0 .3rem' }}><Link href={`/fichas?area=${d.resultado.area}`}>← Fichas técnicas</Link></p>
      <h1>{d.ficha ? `${d.ficha.codigo} · ` : ''}{d.resultado.nombre}</h1>
      <p className="suave" style={{ marginTop: '-.6rem' }}>
        {d.resultado.codigo} · resultado en {d.resultado.unidad_base}
        {d.ficha && <> · versión {d.ficha.version} desde {new Date(d.ficha.vigente_desde + 'T12:00:00').toLocaleDateString('es-CO')}
          {Number(d.ficha.lotes) > 0 && ` · usada en ${d.ficha.lotes} lote(s)`}</>}
      </p>
      <EditorFicha key={d.ficha?.id ?? 'nueva'} datos={d} />
    </>
  );
}
