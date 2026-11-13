import Link from 'next/link';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, menuDe, navDe, grupoDe, GRUPOS_MENU, type Area } from '@/lib/roles';
import Icono from '@/components/Icono';
import { Insignia } from '@/components/Insignia';
import TarjetaCierre, { periodosPorCerrar, type PeriodoAbierto } from '@/components/TarjetaCierre';
import { fecha } from '@/lib/formato';

type ResumenArea = {
  area: Area; conteo_tocan: number; conteo_zonas: number; recepciones_hoy: number; lotes_hoy: number;
  por_vencer: { producto: string; lote: string; lote_id: string; vence: string }[]; bajo_minimo: number; lotes_sin_costo: number;
  kardex: boolean; provisionales?: number; pares?: number; propuestas?: number; carta_sin_precio?: number;
};
type Resumen = { hoy: string; areas: ResumenArea[]; errores_semana: number | null };
// cifra grande + qué es; el área va aparte, pequeña. «urgente» y «aviso» llevan insignia con palabra.
type Pendiente = { cifra?: number; texto: string; area?: string; href: string; icono: string; tono: 'urgente' | 'aviso' | 'info' };

const nombreArea = (a: Area) => (a === 'BAR' ? 'Bar' : 'Cocina');
const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

// Lo que pide atención hoy, de lo más urgente a lo informativo. Solo sale lo que tiene algo.
function pendientesDe(r: ResumenArea, varias: boolean, hoy: string, vePrecios: boolean): Pendiente[] {
  const area = varias ? nombreArea(r.area) : undefined;
  const p: Pendiente[] = [];
  for (const v of r.por_vencer) {
    p.push({ texto: `${v.producto} ${v.vence < hoy ? 'venció' : v.vence === hoy ? 'vence hoy' : `vence el ${fecha(v.vence)}`}`, area: [area, `lote ${v.lote}`].filter(Boolean).join(' · '),
             href: `/historial/lote/${v.lote_id}`, icono: 'producir', tono: v.vence <= hoy ? 'urgente' : 'aviso' });
  }
  if (!r.kardex) p.push({ texto: 'Falta el conteo inicial: sin él no hay existencias ni costos', area, href: '/conteo', icono: 'contar', tono: 'urgente' });
  if (r.conteo_tocan) p.push({ cifra: r.conteo_tocan, texto: `${plural(r.conteo_tocan, 'producto', 'productos')} por contar en ${r.conteo_zonas} ${plural(r.conteo_zonas, 'zona', 'zonas')}`, area, href: '/conteo', icono: 'contar', tono: 'aviso' });
  if (r.bajo_minimo) p.push({ cifra: r.bajo_minimo, texto: `${plural(r.bajo_minimo, 'producto', 'productos')} en el mínimo: arme el pedido`, area, href: `/pedido?area=${r.area}`, icono: 'recibir', tono: 'aviso' });
  if (vePrecios && r.lotes_sin_costo) p.push({ cifra: r.lotes_sin_costo, texto: `${plural(r.lotes_sin_costo, 'lote', 'lotes')} del último mes sin costo completo`, area, href: '/producir/sin-costo', icono: 'producir', tono: 'info' });
  if (r.propuestas) p.push({ cifra: r.propuestas, texto: `${plural(r.propuestas, 'propuesta', 'propuestas')} de unidad por revisar`, area, href: '/catalogo/unidades', icono: 'catalogo', tono: 'info' });
  if (r.pares) p.push({ cifra: r.pares, texto: `${plural(r.pares, 'posible duplicado', 'posibles duplicados')} por decidir`, area, href: '/catalogo/revision', icono: 'revision', tono: 'info' });
  if (r.provisionales) p.push({ cifra: r.provisionales, texto: `${plural(r.provisionales, 'producto provisional', 'productos provisionales')} por validar`, area, href: '/catalogo?estado=PROVISIONAL', icono: 'catalogo', tono: 'info' });
  if (vePrecios && r.carta_sin_precio) p.push({ cifra: r.carta_sin_precio, texto: `${plural(r.carta_sin_precio, 'cóctel o plato', 'cócteles o platos')} sin precio de carta`, area, href: `/carta?area=${r.area}`, icono: 'fichas', tono: 'info' });
  return p;
}

export default async function Inicio() {
  const perfil = await perfilActual();
  const menu = menuDe(perfil);
  const enBarra = new Set(navDe(perfil).principales.map((o) => o.ruta));
  const areas = areasDe(perfil);
  const supabase = await supabaseServidor();
  const esAdmin = perfil.rol === 'admin';
  const [{ data }, periodos] = await Promise.all([
    perfil.rol === 'servicio' ? Promise.resolve({ data: null }) : supabase.rpc('resumen_hoy'),
    esAdmin ? supabase.rpc('consulta_periodos', { p_area: null }) : Promise.resolve({ data: null }),
  ]);
  const resumen = data as Resumen | null;
  const varias = (resumen?.areas.length ?? 0) > 1;
  const orden = { urgente: 0, aviso: 1, info: 2 } as const;
  const pendientes = (resumen?.areas ?? []).flatMap((r) => pendientesDe(r, varias, resumen!.hoy, esAdmin)).sort((a, b) => orden[a.tono] - orden[b.tono]);
  if (resumen?.errores_semana) pendientes.push({ cifra: resumen.errores_semana, texto: `${plural(resumen.errores_semana, 'error', 'errores')} de la app esta semana`, href: '/admin/registro?ver=errores', icono: 'registro', tono: 'info' });
  const hecho = (resumen?.areas ?? []).reduce((t, r) => ({ rec: t.rec + r.recepciones_hoy, lotes: t.lotes + r.lotes_hoy }), { rec: 0, lotes: 0 });
  const porCerrar = periodosPorCerrar(((periodos.data as { abiertos?: PeriodoAbierto[] } | null)?.abiertos) ?? []);
  const grupos = GRUPOS_MENU.map((g) => ({ g, items: menu.filter((o) => grupoDe(o.ruta) === g) })).filter((x) => x.items.length);

  return (
    <>
      <h1>Hola, {perfil.nombre.split(' ')[0]}</h1>
      {areas.length > 0 && <p className="suave" style={{ marginTop: '-.6rem' }}>Operas en: {areas.map(nombreArea).join(' y ')}.</p>}

      {porCerrar.length > 0 && <TarjetaCierre periodos={porCerrar} />}

      {resumen && (
        <section aria-labelledby="hoy">
          <h2 className="mt-2" id="hoy">Hoy</h2>
          {pendientes.length ? (
            <ul className="pendientes">
              {pendientes.map((p) => (
                <li key={p.texto + (p.area ?? '')} className={`p-${p.tono}`}>
                  <Link href={p.href}>
                    <Icono nombre={p.icono} />
                    {p.cifra !== undefined && <b className="p-cifra">{p.cifra.toLocaleString('es-CO')}</b>}
                    <span className="p-texto">{p.texto}{p.area && <small>{p.area}</small>}</span>
                    {p.tono === 'urgente' && <Insignia tono="error">Urgente</Insignia>}
                    {p.tono === 'aviso' && <Insignia tono="aviso">Aviso</Insignia>}
                    <span aria-hidden className="p-flecha">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="exito mt-0">Nada pendiente por ahora. ✔</p>}
          {/* lo hecho en el turno, en cifras (INI-03) */}
          <div className="franja-hoy" aria-label="Registrado hoy">
            <span className="sec-tit">Registrado hoy</span>
            <Link href="/historial"><b>{hecho.rec}</b> {plural(hecho.rec, 'recepción', 'recepciones')}</Link>
            <Link href="/produccion/lotes"><b>{hecho.lotes}</b> {plural(hecho.lotes, 'lote', 'lotes')}</Link>
          </div>
        </section>
      )}

      {menu.length ? grupos.map(({ g, items }) => (
        // en el celular no se repite lo que ya está en la barra de abajo
        <section key={g} className={items.every((o) => enBarra.has(o.ruta)) ? 'grupo-menu solo-en-barra' : 'grupo-menu'}>
          <h2>{g}</h2>
          <nav className="menu" aria-label={g}>
            {items.map((o) => (
              <Link key={o.ruta} href={o.ruta} className={enBarra.has(o.ruta) ? 'tarjeta en-barra' : 'tarjeta'}>
                <Icono nombre={o.icono} className="icono-menu" />
                <span><strong>{o.titulo}</strong><span>{o.detalle}</span></span>
              </Link>
            ))}
          </nav>
        </section>
      )) : (
        <p className="tarjeta">Todavía no hay pantallas para su rol. Las de servicio llegan con la carta y las fichas.</p>
      )}
    </>
  );
}
