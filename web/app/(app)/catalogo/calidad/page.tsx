import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, editaArea, type Area } from '@/lib/roles';
import { Insignia } from '@/components/Insignia';
import Icono from '@/components/Icono';
import PestanasCalidad from '@/components/PestanasCalidad';

export const metadata = { title: 'Calidad del catálogo' };

// Bandeja de Calidad del catálogo (CAL-01): todo lo que hay por revisar en el maestro, con cuántos quedan de
// cada tipo, en un solo lugar. Cada tarjeta abre su revisión; nada cambia desde aquí.
export default async function Calidad() {
  const perfil = await perfilActual();
  const esAdmin = perfil.rol === 'admin';
  const valida: Area[] = (['BAR', 'COCINA'] as Area[]).filter((a) => esAdmin || editaArea(perfil, a));
  if (!valida.length && perfil.rol !== 'auditor') redirect('/catalogo');
  const areas = valida.length ? valida : areasDe(perfil).length ? areasDe(perfil) : (['BAR', 'COCINA'] as Area[]);

  const supabase = await supabaseServidor();
  const [resumen, pares, unidades, clases, ...verif] = await Promise.all([
    supabase.rpc('resumen_hoy'),
    supabase.from('revision_catalogo').select('id', { count: 'exact', head: true }).is('decision', null).in('area', areas),
    supabase.rpc('lista_propuestas_unidad'),
    supabase.rpc('lista_propuestas_clase'),
    ...areas.map((a) => supabase.rpc('lista_verificacion', { p_area: a })),
  ]);
  const provisionales = (((resumen.data as { areas?: { area: Area; provisionales?: number }[] } | null)?.areas) ?? [])
    .filter((r) => areas.includes(r.area)).reduce((t, r) => t + (r.provisionales ?? 0), 0);
  const pendientes = (d: unknown) => ((d ?? []) as { estado: string }[]).filter((x) => x.estado === 'PENDIENTE').length;
  const verificar = verif.flatMap((r) => (r.data ?? []) as { verificado_en: string | null; clase_abc: string | null }[])
    .filter((f) => !f.verificado_en && (f.clase_abc === 'A' || f.clase_abc === 'B')).length;

  const tarjetas: { t: string; n: number | null; d: string; href: string; icono: string; accion: string }[] = [
    { t: 'Verificar insumos A/B', n: verificar, d: 'Unidad, contenido y precio de lo que más pesa en la compra, con el empaque en la mano.', href: '/catalogo/verificar', icono: 'contar', accion: 'Verificar' },
    { t: 'Provisionales por validar', n: provisionales, d: 'Productos creados al recibir o contar que esperan al jefe del área.', href: '/catalogo?estado=PROVISIONAL', icono: 'catalogo', accion: 'Validar' },
    { t: 'Posibles duplicados', n: pares.count ?? 0, d: 'Pares que parecen el mismo insumo: unirlos o dejarlos como distintos.', href: '/catalogo/revision', icono: 'revision', accion: 'Decidir' },
    { t: 'Unidades por revisar', n: pendientes(unidades.data), d: 'Unidad base, contenido y categoría propuestos para cada insumo.', href: '/catalogo/unidades', icono: 'existencias', accion: 'Revisar' },
    { t: 'Clasificar insumos', n: pendientes(clases.data), d: 'Desechables, aseo, menaje y herramientas separados de la materia prima.', href: '/catalogo/clases', icono: 'bajas', accion: 'Clasificar' },
    ...(esAdmin ? [{ t: 'Precios desde fotos', n: null, d: 'Suba fotos de facturas, tiquetes o listas y la IA propone el precio de cada producto.', href: '/catalogo/precios', icono: 'escanear', accion: 'Subir fotos' }] : []),
  ];
  const total = tarjetas.reduce((t, x) => t + (x.n ?? 0), 0);

  return (
    <>
      <PestanasCalidad activa="bandeja" esAdmin={esAdmin} />
      <h1 className="pagina-ancha titulo-gestion">Calidad del catálogo</h1>
      <p className="suave mt-0">
        {total ? <>Quedan <strong>{total.toLocaleString('es-CO')}</strong> revisiones pendientes. Empiece por los insumos A/B: son los que más mueven el costo.</>
          : 'El catálogo está al día: no hay revisiones pendientes.'}
      </p>
      <div className="bandeja-calidad">
        {tarjetas.map((x) => (
          <Link key={x.href} href={x.href} className={`tarjeta bc-item${x.n ? ' pendiente' : ''}`}>
            <span className="bc-cab">
              <Icono nombre={x.icono} className="icono-menu" />
              {x.n !== null && <b className="bc-n">{x.n.toLocaleString('es-CO')}</b>}
            </span>
            <strong>{x.t}</strong>
            <span className="suave">{x.d}</span>
            <span className="bc-pie">
              {x.n === null ? <span /> : x.n ? <Insignia tono="aviso">Por revisar</Insignia> : <Insignia tono="ok">Al día</Insignia>}
              <span className="bc-accion">{x.accion} ›</span>
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
