import Link from 'next/link';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, menuDe, type Area } from '@/lib/roles';
import Icono from '@/components/Icono';

type ResumenArea = {
  area: Area; conteo_tocan: number; conteo_zonas: number; recepciones_hoy: number; lotes_hoy: number;
  por_vencer: { producto: string; lote: string; lote_id: string; vence: string }[]; bajo_minimo: number; lotes_sin_costo: number;
  kardex: boolean; provisionales?: number; pares?: number; propuestas?: number; carta_sin_precio?: number;
};
type Resumen = { hoy: string; areas: ResumenArea[]; errores_semana: number | null };
type Pendiente = { texto: string; href: string; icono: string; tono: 'urgente' | 'aviso' | 'info' };

const nombreArea = (a: Area) => (a === 'BAR' ? 'Bar' : 'Cocina');
const fecha = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });

// Lo que pide atención hoy, de lo más urgente a lo informativo. Solo sale lo que tiene algo.
function pendientesDe(r: ResumenArea, varias: boolean, hoy: string): Pendiente[] {
  const en = varias ? ` en ${nombreArea(r.area).toLowerCase()}` : '';
  const p: Pendiente[] = [];
  for (const v of r.por_vencer) {
    p.push({ texto: `${v.producto} ${v.vence < hoy ? 'venció' : v.vence === hoy ? 'vence hoy' : `vence el ${fecha(v.vence)}`} (lote ${v.lote})`,
             href: `/historial/lote/${v.lote_id}`, icono: 'producir', tono: v.vence <= hoy ? 'urgente' : 'aviso' });
  }
  if (!r.kardex) p.push({ texto: `Falta el conteo inicial${en}: sin él no hay existencias ni costos`, href: '/conteo', icono: 'contar', tono: 'urgente' });
  if (r.conteo_tocan) p.push({ texto: `Toca contar ${r.conteo_tocan} producto(s) en ${r.conteo_zonas} zona(s)${en}`, href: '/conteo', icono: 'contar', tono: 'aviso' });
  if (r.bajo_minimo) p.push({ texto: `${r.bajo_minimo} producto(s) en el mínimo${en}: arma el pedido`, href: `/pedido?area=${r.area}`, icono: 'recibir', tono: 'aviso' });
  if (r.lotes_sin_costo) p.push({ texto: `${r.lotes_sin_costo} lote(s) del último mes sin costo completo${en}`, href: '/producir/sin-costo', icono: 'producir', tono: 'info' });
  if (r.propuestas) p.push({ texto: `${r.propuestas} propuesta(s) de unidad por revisar${en}`, href: '/catalogo/unidades', icono: 'catalogo', tono: 'info' });
  if (r.pares) p.push({ texto: `${r.pares} posible(s) duplicado(s) por decidir${en}`, href: '/catalogo/revision', icono: 'revision', tono: 'info' });
  if (r.provisionales) p.push({ texto: `${r.provisionales} producto(s) provisional(es) por validar${en}`, href: '/catalogo?estado=PROVISIONAL', icono: 'catalogo', tono: 'info' });
  if (r.carta_sin_precio) p.push({ texto: `${r.carta_sin_precio} cóctel(es) o plato(s) sin precio de carta${en}`, href: `/carta?area=${r.area}`, icono: 'fichas', tono: 'info' });
  return p;
}

export default async function Inicio() {
  const perfil = await perfilActual();
  const menu = menuDe(perfil);
  const areas = areasDe(perfil);
  const supabase = await supabaseServidor();
  const { data } = perfil.rol === 'servicio' ? { data: null } : await supabase.rpc('resumen_hoy');
  const resumen = data as Resumen | null;
  const varias = (resumen?.areas.length ?? 0) > 1;
  const pendientes = (resumen?.areas ?? []).flatMap((r) => pendientesDe(r, varias, resumen!.hoy));
  if (resumen?.errores_semana) pendientes.push({ texto: `${resumen.errores_semana} error(es) de la app esta semana`, href: '/admin/registro?ver=errores', icono: 'registro', tono: 'info' });
  const hecho = (resumen?.areas ?? []).reduce((t, r) => ({ rec: t.rec + r.recepciones_hoy, lotes: t.lotes + r.lotes_hoy }), { rec: 0, lotes: 0 });

  return (
    <>
      <h1>Hola, {perfil.nombre.split(' ')[0]}</h1>
      {areas.length > 0 && <p className="suave" style={{ marginTop: '-.6rem' }}>Operas en: {areas.map(nombreArea).join(' y ')}.</p>}

      {resumen && (
        <section aria-labelledby="hoy">
          <h2 id="hoy" style={{ marginTop: '.5rem' }}>Hoy</h2>
          {pendientes.length ? (
            <ul className="pendientes">
              {pendientes.map((p) => (
                <li key={p.texto} className={`p-${p.tono}`}>
                  <Link href={p.href}><Icono nombre={p.icono} /><span>{p.texto}</span><span aria-hidden>›</span></Link>
                </li>
              ))}
            </ul>
          ) : <p className="exito" style={{ marginTop: 0 }}>Nada pendiente por ahora. ✔</p>}
          <p className="suave" style={{ fontSize: '.85rem', margin: '.5rem 0 0' }}>
            Registrado hoy: {hecho.rec} recepción(es) · {hecho.lotes} lote(s).
          </p>
        </section>
      )}

      <h2>Pantallas</h2>
      {menu.length ? (
        <nav className="menu">
          {menu.map((o) => (
            <Link key={o.ruta} href={o.ruta} className="tarjeta">
              <Icono nombre={o.icono} className="icono-menu" />
              <span><strong>{o.titulo}</strong><span>{o.detalle}</span></span>
            </Link>
          ))}
        </nav>
      ) : (
        <p className="tarjeta">Todavía no hay pantallas para tu rol. Las de servicio llegan con la carta y las fichas.</p>
      )}
    </>
  );
}
