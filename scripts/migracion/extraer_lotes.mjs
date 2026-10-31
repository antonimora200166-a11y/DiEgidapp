// Lotes históricos de producción de bar: BD_PRODUCCION + BD_CONSUMOS del libro SGI-COSTOS
//   → supabase/datos/lotes_historicos_bar.sql
// Solo referencia: no entran al kardex (el kardex nace con el conteo inicial). Guardan el costo,
// el rendimiento y la merma de cada lote tal como los calculó el .gs, y por qué quedó sin costo.
// No se copian responsable, supervisor ni usuario (datos personales del personal).
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerXlsx, fechaExcel } from './xlsx.mjs';
import { uuid, lit, ent, redondear } from './comun.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const libro = leerXlsx(join(raiz, 'referencia', 'SGI-COSTOS · Producción y costo de MPI (LLENAR AQUÍ).xlsx'));
const filas = (n) => libro[n].filter((f) => f._fila > 1 && f.A);

const fecha = (v) => (typeof v === 'number' ? fechaExcel(v) : v ? String(v).slice(0, 10) : null);
const txt = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
const lista = (v) => `array[${(txt(v) ?? '').split(/[;,]/).map((s) => s.trim()).filter(Boolean).map(lit).join(', ')}]::text[]`;
const num = (v, d = 6) => (ent(v) === null ? 'null' : String(redondear(v, d)));

const lotes = filas('BD_PRODUCCION');
const consumos = filas('BD_CONSUMOS');
// nombres del personal: si aparecen en las observaciones, la observación no se copia
const personas = new Set(lotes.flatMap((f) => [f.G, f.H, f.W]).map(txt).filter((s) => s && !s.startsWith('(')));
const conNombre = (s) => s && [...personas].some((p) => p.split(/\s+/).some((w) => w.length > 3 && s.toLowerCase().includes(w.toLowerCase())));

const vLotes = lotes.map((f) => `(${lit(uuid('lote_historico', f.A))}, ${lit(f.A)}, ${lit(fecha(f.B))}, ${lit(txt(f.C))}, ${lit(f.D)}, `
  + `${lit(txt(f.F))}, ${lit(txt(f.I))}, ${num(f.J)}, ${num(f.K)}, ${num(f.L)}, ${num(f.M)}, ${lit(txt(f.N))}, ${num(f.O)}, ${lit(txt(f.P))}, `
  + `${num(f.Q)}, ${num(f.R)}, ${num(f.T, 2)}, ${num(f.U)}, ${lit(txt(f.AD) ?? 'SIN COSTO')}, ${lit(txt(f.Y) ?? 'ACTIVA')}, ${lista(f.AB)}, `
  + `${ent(f.AC) ?? 0}, ${lit(conNombre(txt(f.V)) ? null : txt(f.V))})`);
const vCons = consumos.map((f) => `(${lit(uuid('lote_historico_consumo', f.A))}, ${lit(uuid('lote_historico', f.B))}, `
  + `${Number(String(f.A).split('-').pop()) || 0}, ${lit(f.D)}, ${lit(txt(f.F))}, ${lit(txt(f.G) ?? txt(f.E))}, ${num(f.H)}, ${lit(txt(f.I) ?? 'g')}, `
  + `${num(f.J)}, ${lit(txt(f.K))}, ${num(f.L)}, ${num(f.M, 2)}, ${lit(txt(f.N))}, ${lista(f.P)})`);

const out = [`-- =====================================================================================
-- SGI Di Égida · Lotes históricos de producción de bar (BD_PRODUCCION + BD_CONSUMOS)
-- Generado por scripts/migracion/extraer_lotes.mjs. NO editar a mano.
-- Solo referencia de costo, rendimiento y merma: no entra al kardex. Idempotente.
-- Los códigos de MPI e insumo se resuelven contra el catálogo; los que no estén quedan fuera
-- y la bitácora dice cuántos.
-- =====================================================================================

insert into public.lotes_historicos (id, codigo, fecha, sesion, generico_id, nombre_original, tecnica, tiempo_min,
       entrada_g, neto_g, unidades, empaque, vida_util_dias, conservacion, rendimiento, rendimiento_ficha,
       costo_total, costo_g, estado_costo, estado_lote, hallazgos, lineas_sin_precio, observaciones)
select v.id::uuid, v.codigo, v.fecha::date, v.sesion, g.id, v.nombre, v.tecnica, v.tiempo::numeric, v.entrada::numeric, v.neto::numeric,
       v.unidades::numeric, v.empaque, v.vida::numeric, v.conservacion, v.rend::numeric, v.rend_ficha::numeric, v.costo::numeric,
       v.costo_g::numeric, v.estado_costo, v.estado_lote,
       v.hallazgos, v.sin_precio, v.obs
  from (values
  ${vLotes.join(',\n  ')}
  ) as v (id, codigo, fecha, sesion, cod, nombre, tecnica, tiempo, entrada, neto, unidades, empaque, vida, conservacion,
          rend, rend_ficha, costo, costo_g, estado_costo, estado_lote, hallazgos, sin_precio, obs)
  join public.genericos g on g.codigo = v.cod
on conflict do nothing;

insert into public.lote_historico_consumos (id, lote_id, linea, generico_id, tipo, nombre_original, cantidad, unidad,
       merma, lote_origen, costo_unitario, costo, fuente_costo, hallazgos)
select v.id::uuid, v.lote::uuid, v.linea, g.id, v.tipo, v.nombre, v.cantidad::numeric, v.unidad, v.merma::numeric, v.origen,
       v.cu::numeric, v.costo::numeric, v.fuente, v.hallazgos
  from (values
  ${vCons.join(',\n  ')}
  ) as v (id, lote, linea, cod, tipo, nombre, cantidad, unidad, merma, origen, cu, costo, fuente, hallazgos)
  join public.genericos g on g.codigo = v.cod
  join public.lotes_historicos l on l.id = v.lote::uuid
on conflict do nothing;

-- costo de referencia de los MPI que aún no tienen: el último lote histórico con costo completo.
-- Sirve para valorizar el conteo inicial. El costo del .gs es por gramo: se pasa a la unidad base.
insert into public.costos_referencia (producto_id, costo_unitario_base, fuente, n_compras, ultima_compra, calculado_en)
select distinct on (p.id) p.id, round(l.costo_total / privado.a_base(l.generico_id, l.neto_g, 'g'), 6),
       'LOTE HISTÓRICO ' || l.codigo, null, l.fecha, current_date
  from public.lotes_historicos l
  join public.productos p on p.generico_id = l.generico_id and p.activo
 where l.estado_costo = 'COMPLETO' and l.estado_lote = 'ACTIVA' and l.costo_total > 0 and l.neto_g > 0
   and privado.a_base(l.generico_id, l.neto_g, 'g') > 0
   and not exists (select 1 from public.costos_referencia cr where cr.producto_id = p.id)
 order by p.id, l.fecha desc, l.codigo desc
on conflict do nothing;

select privado.bitacora('MIGRACIÓN LOTES HISTÓRICOS', 'lotes_historicos', 'BAR', jsonb_build_object(
  'lotes_libro', ${lotes.length}, 'lotes_cargados', (select count(*) from public.lotes_historicos),
  'consumos_libro', ${consumos.length}, 'consumos_cargados', (select count(*) from public.lote_historico_consumos)));
`];
writeFileSync(join(raiz, 'supabase', 'datos', 'lotes_historicos_bar.sql'), out.join('\n'));
console.log(`✔ ${lotes.length} lotes y ${consumos.length} consumos → supabase/datos/lotes_historicos_bar.sql`);
