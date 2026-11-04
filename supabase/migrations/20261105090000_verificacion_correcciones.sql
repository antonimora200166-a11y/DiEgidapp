-- =====================================================================================
-- SGI Di Égida · 36 · Hoja de verificación: lo que faltaba (Anthony, 05/11/2026)
-- Lo que se vio al usarla:
--   · «Es el mismo» solo dejaba el par en Revisar duplicados: ahora se une desde la hoja
--     (public.unir_genericos), eligiendo cuál se queda, con el factor si van en unidades distintas.
--   · Al unir, el genérico que queda puede terminar con dos presentaciones (Conejo entero:
--     «Unidad» que se pesa y «Unidad 5060 g»), una con precio y otra sin él:
--       - las compras del genérico absorbido siguen contando para el que queda (genericos.unido_en);
--       - la presentación sin costo hereda el costo por g / ml / und de su genérico
--         (privado.heredar_costo), al unir y una vez ahora para lo que ya se unió;
--       - una presentación repetida se quita desde la hoja (public.quitar_repetido).
--   · No había dónde poner un precio que se conoce: public.fijar_costo lo guarda como costo de
--     referencia «a mano», por unidad de compra, por kg/L o por g/ml/und. Es el costo con que el
--     conteo inicial valoriza el saldo; después manda el kardex.
-- =====================================================================================

-- ---------------------------------------------------------------- rangos de costo creíble (los de la hoja)
create or replace function privado.costo_creible(p_ub public.unidad_base, p_cu numeric)
returns boolean language sql immutable set search_path = ''
as $$
  select case p_ub when 'g' then p_cu between 0.5 and 400 when 'ml' then p_cu between 0.5 and 600
                   else p_cu between 20 and 1000000 end
$$;

-- ---------------------------------------------------------------- presentaciones sin costo heredan el del genérico
-- Promedio (ponderado por compras) del costo de referencia de las otras presentaciones activas.
-- Solo donde no hay costo ni kardex. Devuelve cuántas heredaron.
create or replace function privado.heredar_costo(p_generico uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_cu numeric; v_n int; v_hechos int := 0;
begin
  select sum(cr.costo_unitario_base * coalesce(cr.n_compras, 1)) / nullif(sum(coalesce(cr.n_compras, 1)), 0), count(*)
    into v_cu, v_n
    from public.costos_referencia cr join public.productos p on p.id = cr.producto_id
   where p.generico_id = p_generico and p.activo and cr.fuente not like 'Mismo genérico%';
  if v_cu is null then return 0; end if;
  insert into public.costos_referencia (producto_id, costo_unitario_base, fuente, n_compras, ultima_compra, calculado_en)
  select p.id, round(v_cu, 6), 'Mismo genérico: promedio de ' || v_n || ' presentación(es) con costo', null, null, current_date
    from public.productos p
   where p.generico_id = p_generico and p.activo
     and not exists (select 1 from public.costos_referencia x where x.producto_id = p.id)
     and not exists (select 1 from public.movimientos m where m.producto_id = p.id);
  get diagnostics v_hechos = row_count;
  return v_hechos;
end
$$;

-- ---------------------------------------------------------------- a dónde se unió cada genérico
alter table public.genericos add column unido_en uuid references public.genericos (id);
comment on column public.genericos.unido_en is
  'Genérico en que se unió (public.decidir_par). Sus compras históricas cuentan para ese genérico.';

-- public.decidir_par deja «Unido en <código> (…)» en la nota del absorbido al desactivarlo:
-- de ahí sale unido_en, y el que queda reparte su costo a las presentaciones que no lo tienen.
create or replace function privado.generico_unido()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_cod text; v_queda uuid;
begin
  if old.activo and not new.activo and new.unido_en is null then
    v_cod := (regexp_match(coalesce(new.nota, ''), 'Unido en ([A-Za-z0-9_]+) \([^)]*\)\.?\s*$'))[1];
    if v_cod is not null then
      select g.id into v_queda from public.genericos g where g.codigo = v_cod;
      if v_queda is not null and v_queda <> new.id then
        new.unido_en := v_queda;
        perform privado.heredar_costo(v_queda);
      end if;
    end if;
  end if;
  return new;
end
$$;
create trigger genericos_unido before update of activo on public.genericos
  for each row execute function privado.generico_unido();

-- lo que ya se unió
update public.genericos g set unido_en = q.id
  from public.genericos q
 where not g.activo and g.unido_en is null
   and q.codigo = (regexp_match(coalesce(g.nota, ''), 'Unido en ([A-Za-z0-9_]+) \('))[1] and q.id <> g.id;
select privado.heredar_costo(g.id)
  from public.genericos g
 where g.activo
   and exists (select 1 from public.productos p join public.costos_referencia cr on cr.producto_id = p.id where p.generico_id = g.id and p.activo)
   and exists (select 1 from public.productos p where p.generico_id = g.id and p.activo
                  and not exists (select 1 from public.costos_referencia cr where cr.producto_id = p.id));

-- ---------------------------------------------------------------- unir dos genéricos desde la hoja
-- Crea (o reutiliza) el par en revision_catalogo y lo decide con public.decidir_par y todas sus reglas.
create or replace function public.unir_genericos(p_queda uuid, p_va uuid, p_factor numeric default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  q public.genericos%rowtype; v public.genericos%rowtype;
  v_par public.revision_catalogo%rowtype;
  v_id text;
begin
  select * into q from public.genericos where id = p_queda;
  select * into v from public.genericos where id = p_va;
  if q.id is null or v.id is null or q.id = v.id then raise exception 'Los dos genéricos deben existir y ser distintos.'; end if;
  if q.area <> v.area then raise exception 'Solo se unen genéricos de la misma área.'; end if;
  if not privado.edita_area(q.area) then
    raise exception 'Solo el jefe de % o el admin unen duplicados.', q.area using errcode = '42501';
  end if;
  if not q.activo then return privado.resultado(false, null, null, array['«' || q.nombre || '» ya no está activo.'], '{}', '{}'); end if;
  if not v.activo then return privado.resultado(false, null, null, array['«' || v.nombre || '» ya se unió o se dio de baja.'], '{}', '{}'); end if;

  select * into v_par from public.revision_catalogo rc
   where rc.decision is null
     and ((rc.a_generico_id = q.id and rc.b_generico_id = v.id) or (rc.a_generico_id = v.id and rc.b_generico_id = q.id))
   limit 1;
  if v_par.id is null then
    v_id := 'VER:' || least(q.codigo, v.codigo) || '|' || greatest(q.codigo, v.codigo);
    if exists (select 1 from public.revision_catalogo where id = v_id) then
      v_id := v_id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');   -- se había separado antes
    end if;
    insert into public.revision_catalogo (id, area, tipo, parecido, propuesta, motivo, a_fuente, a_nombre, a_generico_id,
                                          b_fuente, b_nombre, b_generico_id)
    values (v_id, q.area, 'CASI-DUPLICADO', round(extensions.similarity(q.nombre_norm, v.nombre_norm)::numeric, 3), 'FUSIONAR',
            'Unido desde la hoja de verificación A/B.', 'CATALOGO', q.nombre, q.id, 'CATALOGO', v.nombre, v.id)
    returning * into v_par;
  end if;

  return public.decidir_par(v_par.id, 'FUSIONAR', case when v_par.a_generico_id = q.id then 'A' else 'B' end,
                            'Unido desde la hoja de verificación.', p_factor);
end
$$;

-- ---------------------------------------------------------------- quitar una presentación repetida
-- Las dos son del mismo genérico; la repetida sale (inactiva, nada se borra) y sus nombres de
-- factura pasan a la que queda, con su costo si a esa le faltaba.
create or replace function public.quitar_repetido(p_repetido uuid, p_queda uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record; q record;
begin
  select p.*, g.area, g.nombre as g_nombre into r from public.productos p join public.genericos g on g.id = p.generico_id where p.id = p_repetido for update of p;
  select p.* into q from public.productos p where p.id = p_queda for update;
  if r.id is null or q.id is null or r.id = q.id then raise exception 'Los dos productos deben existir y ser distintos.'; end if;
  if r.generico_id <> q.generico_id then
    return privado.resultado(false, null, null, array['Son de genéricos distintos: para eso está «Unir».'], '{}', '{}');
  end if;
  if not privado.edita_area(r.area) then
    raise exception 'Solo el jefe de % o el admin quitan repetidos.', r.area using errcode = '42501';
  end if;
  if not r.activo or not q.activo then return privado.resultado(false, null, null, array['Uno de los dos ya está inactivo.'], '{}', '{}'); end if;
  if exists (select 1 from public.existencias e where e.producto_id = r.id and e.cantidad <> 0) then
    return privado.resultado(false, null, null,
      array['«' || r.presentacion || '» tiene saldo en el kardex: trasládalo o cuéntalo en cero antes de quitarlo.'], '{}', '{}');
  end if;

  update public.alias set producto_id = q.id where producto_id = r.id;
  insert into public.costos_referencia (producto_id, costo_unitario_base, fuente, n_compras, ultima_compra, calculado_en)
  select q.id, cr.costo_unitario_base, cr.fuente, cr.n_compras, cr.ultima_compra, current_date
    from public.costos_referencia cr where cr.producto_id = r.id
  on conflict (producto_id) do update
     set costo_unitario_base = excluded.costo_unitario_base, fuente = excluded.fuente, n_compras = excluded.n_compras,
         ultima_compra = excluded.ultima_compra, calculado_en = excluded.calculado_en
   where public.costos_referencia.fuente like 'Mismo genérico%';
  update public.productos set activo = false,
         nota = concat_ws(' · ', nota, 'Repetido de ' || q.codigo || ' (hoja de verificación, '
                          || to_char(now() at time zone 'America/Bogota', 'YYYY-MM-DD') || ').')
   where id = r.id;
  perform privado.bitacora('PRODUCTO REPETIDO QUITADO', 'productos', r.codigo, jsonb_build_object('queda', q.codigo));
  return privado.resultado(true, q.id, q.codigo, '{}', '{}',
    array['«' || r.g_nombre || ' · ' || r.presentacion || '» quedó inactivo; sus nombres de factura pasan a «' || q.presentacion || '».']);
end
$$;

-- ---------------------------------------------------------------- poner un precio a mano
-- p_por: COMPRA (precio de 1 unidad de compra) · KILO (1 kg o 1 L) · BASE (1 g, 1 ml o 1 und).
-- p_otras: también a las otras presentaciones del genérico que no tienen costo propio.
create or replace function public.fijar_costo(p_producto uuid, p_valor numeric, p_por text, p_otras boolean default true)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_por text := upper(trim(coalesce(p_por, '')));
  v_cu numeric;
  v_fuente text;
  v_otras int := 0;
begin
  select p.*, g.area, g.nombre as g_nombre, g.unidad_base as ub into r
    from public.productos p join public.genericos g on g.id = p.generico_id where p.id = p_producto;
  if r.id is null then raise exception 'No existe el producto.'; end if;
  if not privado.edita_area(r.area) then
    raise exception 'Solo el jefe de % o el admin ponen precios.', r.area using errcode = '42501';
  end if;
  if p_valor is null or p_valor <= 0 then return privado.resultado(false, null, null, array['El precio debe ser mayor que cero.'], '{}', '{}'); end if;
  if exists (select 1 from public.movimientos m where m.producto_id = r.id) then
    return privado.resultado(false, null, null,
      array['Ya tiene costo del kardex: el precio nuevo entra con la próxima recepción.'], '{}', '{}');
  end if;

  if v_por = 'COMPRA' then
    if r.contenido_variable or r.contenido_base is null then
      return privado.resultado(false, null, null,
        array['Se pesa al recibir: pon el precio por kg / L o por ' || r.ub || '.'], '{}', '{}');
    end if;
    v_cu := p_valor / r.contenido_base;
  elsif v_por = 'KILO' then
    if r.ub = 'und' then return privado.resultado(false, null, null, array['Va por unidad: pon el precio de 1 und.'], '{}', '{}'); end if;
    v_cu := p_valor / 1000;
  elsif v_por = 'BASE' then
    v_cu := p_valor;
  else
    raise exception 'p_por debe ser COMPRA, KILO o BASE.';
  end if;

  if not privado.costo_creible(r.ub, v_cu) then
    return privado.resultado(false, null, null,
      array['Da $' || round(v_cu, 2) || ' por ' || r.ub || ', que no es creíble: revisa el precio, la unidad o el contenido.'], '{}', '{}');
  end if;

  v_fuente := 'A mano · ' || coalesce((select nombre from public.perfiles where id = auth.uid()), 'sin usuario')
              || ' · ' || to_char(now() at time zone 'America/Bogota', 'DD/MM/YYYY');
  insert into public.costos_referencia (producto_id, costo_unitario_base, fuente, n_compras, ultima_compra, calculado_en)
  values (r.id, round(v_cu, 6), v_fuente, null, null, current_date)
  on conflict (producto_id) do update
     set costo_unitario_base = excluded.costo_unitario_base, fuente = excluded.fuente, n_compras = null,
         ultima_compra = null, calculado_en = excluded.calculado_en;

  if coalesce(p_otras, true) then
    insert into public.costos_referencia (producto_id, costo_unitario_base, fuente, n_compras, ultima_compra, calculado_en)
    select p.id, round(v_cu, 6), 'Mismo genérico: ' || v_fuente, null, null, current_date
      from public.productos p
     where p.generico_id = r.generico_id and p.activo and p.id <> r.id
       and not exists (select 1 from public.movimientos m where m.producto_id = p.id)
    on conflict (producto_id) do update
       set costo_unitario_base = excluded.costo_unitario_base, fuente = excluded.fuente, calculado_en = excluded.calculado_en
     where public.costos_referencia.fuente like 'Mismo genérico%';
    get diagnostics v_otras = row_count;
  end if;

  perform privado.bitacora('COSTO PUESTO A MANO', 'costos_referencia', r.codigo,
                           jsonb_build_object('valor', p_valor, 'por', v_por, 'costo_base', round(v_cu, 6), 'otras', v_otras));
  return privado.resultado(true, r.id, r.codigo, '{}', '{}',
    array_remove(array['Costo: $' || round(v_cu, 2) || ' por ' || r.ub || '.',
                       case when v_otras > 0 then 'También en ' || v_otras || ' presentación(es) más del mismo genérico.' end], null));
end
$$;

-- ---------------------------------------------------------------- la hoja, con lo nuevo
-- · cuentan las compras de los genéricos que se unieron en este (misma unidad);
-- · dice de dónde sale el costo (kardex, compras, a mano, otra presentación);
-- · trae las otras presentaciones activas del genérico, para quitar repetidos.
drop function public.lista_verificacion(public.area_app);
create function public.lista_verificacion(p_area public.area_app)
returns table (producto_id uuid, codigo text, generico_id uuid, generico text, marca text, presentacion text,
               tipo public.tipo_generico, categoria text, clase_abc public.clase_abc, unidad_base public.unidad_base,
               unidad_compra text, contenido_base numeric, contenido_variable boolean,
               valor_compras numeric, n_compras integer, ult_fecha date, ult_proveedor text, ult_nombre text,
               ult_valor numeric, ult_cantidad_base numeric, costo_base numeric, costo_fuente text,
               costo_min numeric, costo_max numeric, tiene_ficha boolean, tiene_kardex boolean,
               parecidos jsonb, hermanos jsonb, alertas text[], verificado_en timestamptz, verificado_por text)
language plpgsql stable security definer set search_path = '' set pg_trgm.similarity_threshold = 0.45
as $$
#variable_conflict use_column
begin
  if not (privado.tiene_rol('admin', 'auditor') or privado.edita_area(p_area)) then
    raise exception 'Solo administración o el jefe del área ven la hoja de verificación.' using errcode = '42501';
  end if;

  return query
  with prod as (
    select p.*, g.nombre as g_nombre, g.tipo as g_tipo, g.unidad_base as g_ub, g.nombre_norm,
           (select c.nombre from public.categorias c where c.codigo = g.categoria) as cat_nombre
      from public.productos p join public.genericos g on g.id = p.generico_id
     where p.activo and g.activo and g.area = p_area and g.tipo in ('MPe', 'MPI')
  ),
  compras as (
    select pr.id as pid, ch.fecha, ch.proveedor, ch.nombre_factura as nombre, ch.valor_total, ch.cantidad_base,
           ch.costo_unitario_base as cub
      from prod pr join public.compras_historicas ch
        on ch.computable
       and (ch.producto_id = pr.id
            or (ch.producto_id is null
                and (ch.generico_id = pr.generico_id
                     or exists (select 1 from public.genericos u where u.id = ch.generico_id and u.unido_en = pr.generico_id
                                   and u.unidad_base = pr.g_ub))))
    union all
    select pr.id, re.fecha, pv.nombre, pr.g_nombre, rl.valor_total, rl.cantidad_base, rl.costo_unitario_base
      from prod pr
      join public.recepcion_lineas rl on rl.producto_id = pr.id and rl.valor_total > 0 and rl.cantidad_base > 0
      join public.recepciones re on re.id = rl.recepcion_id
      left join public.proveedores pv on pv.id = re.proveedor_id
     where not exists (select 1 from public.anulaciones an where an.documento_id = re.id and (an.linea_id is null or an.linea_id = rl.id))
  ),
  resumen as (
    select c.pid, sum(c.valor_total) as valor, count(*)::int as n, min(c.cub) as cmin, max(c.cub) as cmax,
           sum(c.valor_total) / nullif(sum(c.cantidad_base), 0) as cprom
      from compras c group by c.pid
  ),
  ultima as (
    select distinct on (c.pid) c.* from compras c order by c.pid, c.fecha desc
  ),
  base as (
    select pr.*, r.valor, r.n, r.cmin, r.cmax, u.fecha as u_fecha, u.proveedor as u_prov, u.nombre as u_nombre,
           u.valor_total as u_valor, u.cantidad_base as u_cant,
           coalesce(cp.costo_promedio, cr.costo_unitario_base, r.cprom) as costo,
           case when cp.costo_promedio is not null then 'kardex'
                when cr.fuente like 'A mano%' then 'a mano'
                when cr.fuente like 'Mismo genérico%' then 'de otra presentación'
                when cr.costo_unitario_base is not null then 'compras (referencia)'
                when r.cprom is not null then 'compras' end as fuente,
           exists (select 1 from public.fichas fi where fi.generico_id = pr.generico_id) as ficha,
           exists (select 1 from public.movimientos m where m.producto_id = pr.id) as kardex,
           (select cantidad from privado.cantidad_presentacion(pr.presentacion)) as pres_cant,
           (select unidad from privado.cantidad_presentacion(pr.presentacion)) as pres_ub,
           (select coalesce(jsonb_agg(jsonb_build_object('generico_id', s.id, 'nombre', s.nombre, 'unidad_base', s.unidad_base,
                                                         'parecido', round(s.sim::numeric, 2)) order by s.sim desc), '[]')
              from (select o.id, o.nombre, o.unidad_base, extensions.similarity(o.nombre_norm, pr.nombre_norm) as sim
                      from public.genericos o
                     where o.activo and o.area = p_area and o.tipo = pr.g_tipo and o.id <> pr.generico_id
                       and o.nombre_norm operator(extensions.%) pr.nombre_norm
                       and not exists (select 1 from public.revision_catalogo rc
                                        where rc.decision = 'SEPARAR'
                                          and ((rc.a_generico_id = o.id and rc.b_generico_id = pr.generico_id)
                                            or (rc.b_generico_id = o.id and rc.a_generico_id = pr.generico_id)))
                     order by sim desc limit 3) s) as parecidos,
           (select coalesce(jsonb_agg(jsonb_build_object('producto_id', h.id, 'codigo', h.codigo, 'marca', h.marca,
                                                         'presentacion', h.presentacion) order by h.codigo), '[]')
              from public.productos h where h.generico_id = pr.generico_id and h.activo and h.id <> pr.id) as hermanos
      from prod pr
      left join resumen r on r.pid = pr.id
      left join ultima u on u.pid = pr.id
      left join public.costos_producto cp on cp.producto_id = pr.id
      left join public.costos_referencia cr on cr.producto_id = pr.id
  )
  select b.id, b.codigo, b.generico_id, b.g_nombre, b.marca, b.presentacion, b.g_tipo, b.cat_nombre, b.clase_abc, b.g_ub,
         b.unidad_compra, b.contenido_base, b.contenido_variable, b.valor, coalesce(b.n, 0), b.u_fecha, b.u_prov, b.u_nombre,
         b.u_valor, b.u_cant, b.costo, b.fuente, b.cmin, b.cmax, b.ficha, b.kardex, b.parecidos, b.hermanos,
         array_remove(array[
           case when b.g_tipo = 'MPe' and b.costo is null then 'SIN_PRECIO' end,
           case when b.g_tipo = 'MPI' and not b.ficha then 'MPI_SIN_FICHA' end,
           case when not b.contenido_variable and b.pres_cant is not null and b.pres_ub = b.g_ub::text
                     and abs(b.pres_cant - b.contenido_base) > 0.02 * b.pres_cant then 'PRESENTACION' end,
           case when b.pres_ub is not null and b.g_ub::text <> 'und' and b.pres_ub <> b.g_ub::text then 'UNIDAD_TEXTO' end,
           case when not b.contenido_variable and (
                     (b.unidad_compra in ('KG', 'LT', 'L') and b.contenido_base <> 1000)
                  or (b.unidad_compra in ('GR', 'G', 'ML') and b.contenido_base <> 1)
                  or (b.contenido_base = 1 and b.g_ub <> 'und' and b.unidad_compra not in ('GR', 'G', 'ML'))) then 'CONTENIDO' end,
           case when b.costo is not null and not privado.costo_creible(b.g_ub, b.costo) then 'PRECIO_RARO' end,
           case when b.cmin > 0 and b.cmax / b.cmin > 2 then 'PRECIOS_DISPARES' end,
           case when exists (select 1 from jsonb_array_elements(b.parecidos) e where (e ->> 'parecido')::numeric >= 0.6) then 'PARECIDO' end,
           case when jsonb_array_length(b.hermanos) > 0 then 'VARIAS_PRESENTACIONES' end
         ], null),
         b.verificado_en, pe.nombre
    from base b left join public.perfiles pe on pe.id = b.verificado_por
   order by b.clase_abc nulls last, b.valor desc nulls last, b.g_nombre, b.marca, b.presentacion;
end
$$;

revoke execute on function public.lista_verificacion(public.area_app), public.unir_genericos(uuid, uuid, numeric),
                           public.quitar_repetido(uuid, uuid), public.fijar_costo(uuid, numeric, text, boolean) from public, anon;
grant execute on function public.lista_verificacion(public.area_app), public.unir_genericos(uuid, uuid, numeric),
                          public.quitar_repetido(uuid, uuid), public.fijar_costo(uuid, numeric, text, boolean) to authenticated;
