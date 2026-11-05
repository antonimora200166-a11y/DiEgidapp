import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { editaArea, type Area } from '@/lib/roles';
import ComprasProveedor, { type CompraProveedor } from './ComprasProveedor';
import Dependencia, { type DatosDependencia } from './Dependencia';
import Repetidos, { type Par } from './Repetidos';
import Pestanas from './Pestanas';
import type { AnalisisGuardado } from './acciones';

export const metadata = { title: 'Proveedores' };
export const maxDuration = 300;   // el análisis de riesgos busca en la web: puede tardar un par de minutos

export default async function Proveedores() {
  const perfil = await perfilActual();
  const edita = perfil.rol === 'admin' || (['BAR', 'COCINA'] as Area[]).some((a) => editaArea(perfil, a));
  if (!edita && perfil.rol !== 'auditor') redirect('/catalogo');
  const supabase = await supabaseServidor();
  const [compras, parecidos, dependencia, analisis] = await Promise.all([
    supabase.rpc('compras_por_proveedor'),
    supabase.rpc('proveedores_parecidos'),
    supabase.rpc('dependencia_proveedores', { p_meses: 12 }),
    supabase.from('analisis_proveedores').select('id, creado_en, resultado').order('creado_en', { ascending: false }).limit(12),
  ]);
  if (compras.error) throw new Error(compras.error.message);
  if (dependencia.error) throw new Error(dependencia.error.message);
  const pares = (parecidos.data ?? []) as Par[];

  return (
    <>
      <p className="pagina-ancha" style={{ margin: '0 0 .3rem' }}><Link href="/catalogo">← Catálogo</Link></p>
      <h1 className="pagina-ancha">Proveedores</h1>
      <Pestanas pestanas={[
        { clave: 'dependencia', titulo: 'Dependencia y riesgos',
          contenido: <Dependencia datos={dependencia.data as DatosDependencia} analisis={(analisis.data ?? []) as AnalisisGuardado[]} puedeAnalizar={edita} /> },
        { clave: 'repetidos', titulo: `Proveedores repetidos${pares.length ? ` (${pares.length})` : ''}`,
          contenido: <Repetidos pares={pares} soloLectura={!edita} /> },
        { clave: 'compras', titulo: 'Qué le compramos a cada uno',
          contenido: (
            <>
              <p className="suave pagina-ancha">
                Se arma solo con cada recepción, cada foto de <Link href="/catalogo/precios">Precios desde fotos</Link> y las compras de los
                libros anteriores: cómo llama cada proveedor al producto en su factura, el último precio y cuántas veces se le ha comprado.
              </p>
              <ComprasProveedor filas={(compras.data ?? []) as CompraProveedor[]} />
            </>
          ) },
      ]} />
    </>
  );
}
