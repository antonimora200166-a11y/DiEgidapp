import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { editaArea, vePrecios, type Area } from '@/lib/roles';
import ComprasProveedor, { type CompraProveedor } from './ComprasProveedor';
import Dependencia, { type DatosDependencia } from './Dependencia';
import Repetidos, { type Par } from './Repetidos';
import Directorio, { type FichaProveedor } from './Directorio';
import Pestanas from './Pestanas';
import type { AnalisisGuardado } from './acciones';

// Pantalla de proveedores: solo estudio y organización (no se registran compras ni precios aquí).
export const metadata = { title: 'Proveedores' };
export const maxDuration = 300;   // el análisis de riesgos busca en la web: puede tardar un par de minutos

export default async function Proveedores() {
  const perfil = await perfilActual();
  const edita = perfil.rol === 'admin' || (['BAR', 'COCINA'] as Area[]).some((a) => editaArea(perfil, a));
  if (!vePrecios(perfil)) redirect('/');   // compras en pesos: solo administración
  const supabase = await supabaseServidor();
  const [compras, parecidos, dependencia, analisis, lista] = await Promise.all([
    supabase.rpc('compras_por_proveedor'),
    supabase.rpc('proveedores_parecidos'),
    supabase.rpc('dependencia_proveedores', { p_meses: 12 }),
    supabase.from('analisis_proveedores').select('id, creado_en, resultado').order('creado_en', { ascending: false }).limit(12),
    supabase.rpc('lista_proveedores'),
  ]);
  if (compras.error) throw new Error(compras.error.message);
  if (dependencia.error) throw new Error(dependencia.error.message);
  const pares = (parecidos.data ?? []) as Par[];

  return (
    <>
      <h1 className="pagina-ancha">Proveedores</h1>
      <p className="suave pagina-ancha" style={{ marginTop: 0 }}>
        Para estudiar y organizar a quién le compramos: cuánto dependemos de cada uno, qué riesgos vienen, quién está repetido y qué le
        compramos a cada quien. Las compras y los precios se registran en Recibir y en Precios desde fotos.
      </p>
      <Pestanas pestanas={[
        { clave: 'dependencia', titulo: 'Dependencia y riesgos',
          contenido: <Dependencia datos={dependencia.data as DatosDependencia} analisis={(analisis.data ?? []) as AnalisisGuardado[]} puedeAnalizar={edita} /> },
        { clave: 'compras', titulo: 'Qué le compramos a cada uno',
          contenido: <ComprasProveedor filas={(compras.data ?? []) as CompraProveedor[]} /> },
        { clave: 'repetidos', titulo: `Repetidos${pares.length ? ` (${pares.length})` : ''}`,
          contenido: <Repetidos pares={pares} soloLectura={!edita} /> },
        { clave: 'directorio', titulo: 'Directorio',
          contenido: <Directorio proveedores={(lista.data ?? []) as FichaProveedor[]} soloLectura={!edita} /> },
      ]} />
    </>
  );
}
