-- =====================================================================================
-- SGI Di Égida · Bandeja de alertas y seguimiento (bloque 7) · 09/11/2026
-- Especificación de Anthony (06/11/2026): alertas generadas por reglas, cada una con su impacto
-- estimado en pesos; se asignan a un responsable con fecha, se comentan, se marcan en curso o
-- resueltas con la causa encontrada. Las no resueltas pasan al siguiente período. Historial
-- completo de quién hizo qué.
-- Reglas: variación real vs. teórico en rojo · insumo con faltante no explicado alto · producto
-- sobre la meta de % costo · subida de precio de proveedor · rendimiento fuera de banda ·
-- pérdidas sobre el promedio · ventas sin ficha.
-- Pesos solo para administración (06–07/11): el responsable ve sus alertas sin el impacto en
-- pesos y puede comentarlas, marcarlas en curso o resolverlas.
-- Una alerta no está atada a un período: si el problema sigue, la misma alerta abierta se
-- actualiza (clave única mientras no se resuelva). Si se resolvió y vuelve a pasar, nace otra.
-- =====================================================================================

insert into public.parametros (clave, valor, descripcion) values
  ('ALERTA_FALTANTE_MIN', '50000', 'Alerta de insumo: faltante no explicado desde estos pesos en el período.'),
  ('ALERTA_SUBIDA_PCT', '15', 'Alerta de precio: subida del costo por unidad base desde este % contra la compra anterior.'),
  ('ALERTA_PERDIDAS_FACTOR', '1.3', 'Alerta de pérdidas: cuando las del período superan el promedio de los 3 anteriores por este factor.')
on conflict do nothing;

create table if not exists public.alertas (
  id               uuid primary key default gen_random_uuid(),
  regla            text not null check (regla in ('VARIACION_ROJA', 'FALTANTE_INSUMO', 'SOBRE_META', 'SUBIDA_PRECIO',
                                                  'RENDIMIENTO', 'PERDIDAS_ALTAS', 'VENTAS_SIN_FICHA')),
  clave            text not null,
  area             public.area_app,
  titulo           text not null,             -- sin pesos: lo ve también el responsable
  detalle          text,
  enlace           text,                      -- a la ficha, el lote, la recepción o el período
  impacto          numeric,                   -- pesos estimados (solo administración)
  periodo_desde    date,                      -- período en que se detectó por primera vez
  periodo_hasta    date,
  estado           text not null default 'ABIERTA' check (estado in ('ABIERTA', 'EN_CURSO', 'RESUELTA')),
  responsable_id   uuid references public.perfiles (id),
  fecha_compromiso date,
  causa            text,
  vigente          boolean not null default true,   -- la regla la sigue encontrando
  detectada_en     timestamptz not null default now(),
  ultima_deteccion timestamptz not null default now(),
  resuelta_en      timestamptz,
  resuelta_por     uuid references public.perfiles (id)
);
create unique index if not exists alertas_clave_abierta_idx on public.alertas (clave) where estado <> 'RESUELTA';
create index if not exists alertas_responsable_idx on public.alertas (responsable_id) where estado <> 'RESUELTA';

create table if not exists public.alerta_eventos (
  id         bigint generated always as identity primary key,
  alerta_id  uuid not null references public.alertas (id),
  accion     text not null check (accion in ('CREADA', 'ASIGNADA', 'COMENTARIO', 'EN_CURSO', 'RESUELTA', 'REABIERTA', 'ACTUALIZADA')),
  texto      text,
  datos      jsonb,
  usuario_id uuid default auth.uid(),
  en         timestamptz not null default now()
);
create index if not exists alerta_eventos_alerta_idx on public.alerta_eventos (alerta_id, id);
create trigger alerta_eventos_inmutables before update or delete on public.alerta_eventos
  for each row execute function privado.bloquear_cambios();
create trigger alertas_sin_borrado before delete on public.alertas
  for each row execute function privado.bloquear_cambios();

-- Se leen y cambian por las funciones (enmascaran los pesos para quien no es administración).
alter table public.alertas enable row level security;
alter table public.alerta_eventos enable row level security;
create policy alertas_leer on public.alertas for select to authenticated using (privado.ve_precios());
create policy alerta_eventos_leer on public.alerta_eventos for select to authenticated using (privado.ve_precios());
revoke insert, update, delete on public.alertas, public.alerta_eventos from authenticated, anon;

-- ---------------------------------------------------------------- una alerta detectada
create or replace function privado.alerta_detectada(p_regla text, p_clave text, p_area public.area_app, p_titulo text, p_detalle text,
                                                    p_enlace text, p_impacto numeric, p_desde date, p_hasta date)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  select id into v_id from public.alertas where clave = p_clave and estado <> 'RESUELTA';
  if v_id is not null then
    update public.alertas set titulo = p_titulo, detalle = p_detalle, enlace = p_enlace, impacto = round(p_impacto),
                              vigente = true, ultima_deteccion = now() where id = v_id;
    return false;
  end if;
  insert into public.alertas (regla, clave, area, titulo, detalle, enlace, impacto, periodo_desde, periodo_hasta)
  values (p_regla, p_clave, p_area, p_titulo, p_detalle, p_enlace, round(p_impacto), p_desde, p_hasta) returning id into v_id;
  insert into public.alerta_eventos (alerta_id, accion, texto) values (v_id, 'CREADA', p_titulo);
  return true;
end
$$;

-- ---------------------------------------------------------------- las 7 reglas sobre un período
create or replace function privado.generar_alertas(p_desde date, p_hasta date)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_nuevas int := 0; r record; v_a public.area_app; v_per jsonb; v_calc jsonb; v_x jsonb;
  v_min numeric := privado.parametro_num('ALERTA_FALTANTE_MIN', 50000);
  v_subida numeric := privado.parametro_num('ALERTA_SUBIDA_PCT', 15);
  v_rend numeric := privado.parametro_num('DESVIO_REND_AVISO_PP', 5);
  v_factor numeric := privado.parametro_num('ALERTA_PERDIDAS_FACTOR', 1.3);
  v_dias int := p_hasta - p_desde + 1;
  v_imp numeric := 1 + privado.parametro_num('IMPOCONSUMO_PCT', 8) / 100;
begin
  -- lo que no se vuelva a encontrar queda «ya no se detecta» (sigue abierto hasta que alguien lo resuelva)
  update public.alertas set vigente = false where estado <> 'RESUELTA';

  foreach v_a in array array['BAR', 'COCINA']::public.area_app[] loop
    -- 1 y 2 · variación en rojo y faltantes por insumo: períodos cerrados que tocan el rango y el abierto
    for v_per in
      select p.resumen || jsonb_build_object('cerrado', true) from public.periodos p
       where p.area = v_a and p.hasta >= p_desde and p.desde <= p_hasta
    loop
      if v_per ->> 'semaforo' = 'ROJO' then
        v_nuevas := v_nuevas + privado.alerta_detectada('VARIACION_ROJA', format('VARIACION:%s:%s', v_a, v_per ->> 'desde'), v_a,
          format('%s: el costo real superó al teórico por %s puntos (%s → %s)', case v_a when 'BAR' then 'Bar' else 'Cocina' end,
                 replace((v_per ->> 'variacion_pp'), '.', ','), to_char((v_per ->> 'desde')::date, 'DD/MM'), to_char((v_per ->> 'hasta')::date, 'DD/MM')),
          'Revisar el detalle por insumo del período en Consulta.', format('/consulta?area=%s', v_a),
          (v_per ->> 'cmv_real')::numeric - (v_per ->> 'cmv_teorico')::numeric, (v_per ->> 'desde')::date, (v_per ->> 'hasta')::date)::int;
      end if;
      for v_x in select x from public.periodos p, jsonb_array_elements(
                   (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from public.periodo_insumos i where i.periodo_id = p.id)) x
                  where p.area = v_a and p.desde = (v_per ->> 'desde')::date and (x ->> 'dif_valor')::numeric >= v_min loop
        v_nuevas := v_nuevas + privado.alerta_detectada('FALTANTE_INSUMO', format('FALTANTE:%s:%s', v_x ->> 'generico_id', v_per ->> 'desde'), v_a,
          format('%s: faltaron %s %s que no se explican con las ventas ni las bajas', v_x ->> 'nombre',
                 to_char((v_x ->> 'real_q')::numeric - (v_x ->> 'teorico_q')::numeric, 'FM999G999G990'), v_x ->> 'unidad_base'),
          format('Período %s → %s.', to_char((v_per ->> 'desde')::date, 'DD/MM'), to_char((v_per ->> 'hasta')::date, 'DD/MM')),
          format('/catalogo/generico/%s', v_x ->> 'generico_id'), (v_x ->> 'dif_valor')::numeric,
          (v_per ->> 'desde')::date, (v_per ->> 'hasta')::date)::int;
      end loop;
    end loop;

    -- 6 · pérdidas del período sobre el promedio de los 3 anteriores de igual largo
    select coalesce(sum(-coalesce(m.costo_total, 0)) filter (where m.fecha between p_desde and p_hasta), 0) as actual,
           coalesce(sum(-coalesce(m.costo_total, 0)) filter (where m.fecha between p_desde - 3 * v_dias and p_desde - 1), 0) / 3 as promedio
      into r
      from public.movimientos m join public.ubicaciones u on u.codigo = m.ubicacion
      left join public.movimientos o on o.id = m.reversa_de
     where u.area = v_a and coalesce(o.tipo, m.tipo) = 'SALIDA_BAJA';
    if r.promedio > 0 and r.actual > r.promedio * v_factor then
      v_nuevas := v_nuevas + privado.alerta_detectada('PERDIDAS_ALTAS', format('PERDIDAS:%s:%s', v_a, p_desde), v_a,
        format('%s: las bajas del período van %s %% por encima del promedio', case v_a when 'BAR' then 'Bar' else 'Cocina' end,
               round((r.actual / r.promedio - 1) * 100)),
        format('Período %s → %s contra los 3 anteriores.', to_char(p_desde, 'DD/MM'), to_char(p_hasta, 'DD/MM')),
        '/historial', r.actual - r.promedio, p_desde, p_hasta)::int;
    end if;
  end loop;

  -- 3 y 7 · productos vendidos sobre la meta y ventas sin ficha completa
  v_calc := privado.consulta_ventas_calculo(p_desde, p_hasta, null);
  for v_x in select x from jsonb_array_elements(v_calc -> 'productos') x loop
    if (v_x ->> 'completa')::boolean and (v_x ->> 'pct_carta') is not null
       and (v_x ->> 'pct_carta')::numeric > (v_x ->> 'meta_pct')::numeric + (v_x ->> 'banda_pp')::numeric
       and (v_x ->> 'unidades')::numeric - (v_x ->> 'unidades_sin_valor')::numeric > 0 then
      v_nuevas := v_nuevas + privado.alerta_detectada('SOBRE_META', format('META:%s', v_x ->> 'generico_id'), (v_x ->> 'area')::public.area_app,
        format('%s: %s %% de costo contra una meta de %s %%', v_x ->> 'nombre', replace(v_x ->> 'pct_carta', '.', ','), v_x ->> 'meta_pct'),
        format('%s vendidos en el período. Revisar receta, porción o precio.', to_char((v_x ->> 'unidades')::numeric - (v_x ->> 'unidades_sin_valor')::numeric, 'FM999G990')),
        format('/fichas/%s', v_x ->> 'generico_id'),
        ((v_x ->> 'unidades')::numeric - (v_x ->> 'unidades_sin_valor')::numeric)
          * ((v_x ->> 'costo_unit')::numeric - (v_x ->> 'neto_carta')::numeric * (v_x ->> 'meta_pct')::numeric / 100),
        p_desde, p_hasta)::int;
    elsif not (v_x ->> 'completa')::boolean and (v_x ->> 'valor_neto')::numeric > 0 then
      v_nuevas := v_nuevas + privado.alerta_detectada('VENTAS_SIN_FICHA', format('SINFICHA:%s', v_x ->> 'generico_id'), (v_x ->> 'area')::public.area_app,
        format('%s se vende sin ficha completa: su costo no entra en el teórico', v_x ->> 'nombre'),
        format('%s vendidos en el período.', to_char((v_x ->> 'unidades')::numeric, 'FM999G990')),
        format('/fichas/%s', v_x ->> 'generico_id'), (v_x ->> 'valor_neto')::numeric, p_desde, p_hasta)::int;
    end if;
  end loop;
  if (v_calc -> 'sin_equivalencia' ->> 'productos')::int > 0 then
    v_nuevas := v_nuevas + privado.alerta_detectada('VENTAS_SIN_FICHA', 'SINEQUIVALENCIA', null,
      format('%s producto(s) vendidos en Odoo no tienen equivalencia con la carta', v_calc -> 'sin_equivalencia' ->> 'productos'),
      'Resolverlos en Consulta → Cargar ventas.', '/consulta/ventas', (v_calc -> 'sin_equivalencia' ->> 'valor')::numeric, p_desde, p_hasta)::int;
  end if;

  -- 4 · subida de precio: última compra del período contra la anterior del mismo insumo
  for r in
    with c as (
      select p.generico_id, rc.fecha, rl.costo_unitario_base as cu, rl.cantidad_base as q, pv.nombre as proveedor,
             format('/historial/recepcion/%s', rc.id) as enlace
        from public.recepcion_lineas rl join public.recepciones rc on rc.id = rl.recepcion_id
        join public.productos p on p.id = rl.producto_id left join public.proveedores pv on pv.id = rc.proveedor_id
       where rl.costo_unitario_base > 0
         and not exists (select 1 from public.anulaciones an where an.documento_tipo = 'RECEPCION' and an.documento_id = rc.id
                                                             and (an.linea_id is null or an.linea_id = rl.id))
      union all
      select ch.generico_id, ch.fecha, ch.costo_unitario_base, ch.cantidad_base, ch.proveedor, null
        from public.compras_historicas ch where ch.computable and ch.costo_unitario_base > 0),
    o as (select c.*, row_number() over (partition by generico_id order by fecha desc) as n from c),
    u as (select a.*, b.cu as cu_antes, b.fecha as fecha_antes from o a join o b on b.generico_id = a.generico_id and b.n = 2 where a.n = 1)
    select u.*, g.nombre, g.area, g.unidad_base from u join public.genericos g on g.id = u.generico_id
     where u.fecha between p_desde and p_hasta and u.cu >= u.cu_antes * (1 + v_subida / 100)
  loop
    v_nuevas := v_nuevas + privado.alerta_detectada('SUBIDA_PRECIO', format('PRECIO:%s:%s', r.generico_id, r.fecha), r.area,
      format('%s subió %s %% contra la compra anterior', r.nombre, round((r.cu / r.cu_antes - 1) * 100)),
      format('Compra del %s%s; la anterior fue el %s.', to_char(r.fecha, 'DD/MM'), coalesce(' a ' || r.proveedor, ''), to_char(r.fecha_antes, 'DD/MM')),
      coalesce(r.enlace, format('/catalogo/generico/%s', r.generico_id)), (r.cu - r.cu_antes) * r.q, p_desde, p_hasta)::int;
  end loop;

  -- 5 · rendimiento de lote fuera de la banda de la ficha
  for r in
    select l.id, l.codigo, l.area, l.fecha, l.desvio_pp, l.costo_total, g.nombre
      from public.lotes_produccion l join public.productos p on p.id = l.producto_id join public.genericos g on g.id = p.generico_id
     where l.fecha between p_desde and p_hasta and abs(l.desvio_pp) > v_rend
       and not exists (select 1 from public.anulaciones an where an.documento_tipo = 'LOTE' and an.documento_id = l.id)
  loop
    v_nuevas := v_nuevas + privado.alerta_detectada('RENDIMIENTO', format('REND:%s', r.id), r.area,
      format('Lote %s de %s: rindió %s puntos %s de lo que dice la ficha', r.codigo, r.nombre, replace(abs(r.desvio_pp)::text, '.', ','),
             case when r.desvio_pp < 0 then 'menos' else 'más' end),
      format('Producido el %s.', to_char(r.fecha, 'DD/MM')), format('/produccion/lotes/%s', r.codigo),
      coalesce(r.costo_total, 0) * abs(r.desvio_pp) / 100, p_desde, p_hasta)::int;
  end loop;

  return v_nuevas;
end
$$;

-- ---------------------------------------------------------------- lo que ven las pantallas
create or replace function public.generar_alertas(p_desde date, p_hasta date)
returns integer
language plpgsql security definer set search_path = ''
as $$
begin
  if not privado.ve_precios() then
    raise exception 'Sin permiso: las alertas las revisa administración.' using errcode = '42501';
  end if;
  return privado.generar_alertas(p_desde, p_hasta);
end
$$;

-- Administración ve todas con su impacto; los demás, solo las que tienen asignadas y sin pesos.
create or replace function public.alertas_lista(p_todas boolean default false)
returns table (id uuid, regla text, area public.area_app, titulo text, detalle text, enlace text, impacto numeric, estado text,
               responsable_id uuid, responsable text, fecha_compromiso date, causa text, vigente boolean,
               detectada_en timestamptz, ultima_deteccion timestamptz, periodo_desde date, periodo_hasta date, eventos integer)
language sql stable security definer set search_path = ''
as $$
  select a.id, a.regla, a.area, a.titulo, a.detalle, a.enlace, case when privado.ve_precios() then a.impacto end, a.estado,
         a.responsable_id, pr.nombre, a.fecha_compromiso, a.causa, a.vigente, a.detectada_en, a.ultima_deteccion,
         a.periodo_desde, a.periodo_hasta, (select count(*)::int from public.alerta_eventos e where e.alerta_id = a.id)
    from public.alertas a left join public.perfiles pr on pr.id = a.responsable_id
   where (privado.ve_precios() or a.responsable_id = auth.uid())
     and (p_todas or a.estado <> 'RESUELTA')
   order by (a.estado = 'RESUELTA'), a.impacto desc nulls last, a.detectada_en desc
$$;

create or replace function public.alerta_eventos_lista(p_alerta uuid)
returns table (accion text, texto text, usuario text, en timestamptz)
language sql stable security definer set search_path = ''
as $$
  select e.accion, e.texto, pr.nombre, e.en
    from public.alerta_eventos e join public.alertas a on a.id = e.alerta_id left join public.perfiles pr on pr.id = e.usuario_id
   where e.alerta_id = p_alerta and (privado.ve_precios() or a.responsable_id = auth.uid())
   order by e.id
$$;

-- p: {id, accion: ASIGNAR | COMENTAR | EN_CURSO | RESOLVER | REABRIR, responsable_id, fecha, texto, causa}
create or replace function public.alerta_accion(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v public.alertas; v_admin boolean := privado.ve_precios(); v_acc text := p ->> 'accion'; v_texto text := nullif(trim(coalesce(p ->> 'texto', '')), '');
begin
  select * into v from public.alertas where id = (p ->> 'id')::uuid;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'No existe esa alerta.'); end if;
  if not v_admin and v.responsable_id is distinct from auth.uid() then
    raise exception 'Sin permiso: la alerta no está asignada a ti.' using errcode = '42501';
  end if;
  case v_acc
    when 'ASIGNAR' then
      if not v_admin then raise exception 'Sin permiso: las alertas las asigna administración.' using errcode = '42501'; end if;
      if (p ->> 'responsable_id') is null then return jsonb_build_object('ok', false, 'error', 'Escoge el responsable.'); end if;
      update public.alertas set responsable_id = (p ->> 'responsable_id')::uuid, fecha_compromiso = (p ->> 'fecha')::date where id = v.id;
      insert into public.alerta_eventos (alerta_id, accion, texto, datos)
      values (v.id, 'ASIGNADA', (select nombre from public.perfiles where id = (p ->> 'responsable_id')::uuid)
                                || coalesce(' · para el ' || to_char((p ->> 'fecha')::date, 'DD/MM/YYYY'), ''), p);
    when 'COMENTAR' then
      if v_texto is null then return jsonb_build_object('ok', false, 'error', 'Escribe el comentario.'); end if;
      insert into public.alerta_eventos (alerta_id, accion, texto) values (v.id, 'COMENTARIO', v_texto);
    when 'EN_CURSO' then
      if v.estado = 'RESUELTA' then return jsonb_build_object('ok', false, 'error', 'La alerta ya está resuelta.'); end if;
      update public.alertas set estado = 'EN_CURSO' where id = v.id;
      insert into public.alerta_eventos (alerta_id, accion, texto) values (v.id, 'EN_CURSO', v_texto);
    when 'RESOLVER' then
      if nullif(trim(coalesce(p ->> 'causa', '')), '') is null then
        return jsonb_build_object('ok', false, 'error', 'Escribe la causa que encontraste.');
      end if;
      update public.alertas set estado = 'RESUELTA', causa = trim(p ->> 'causa'), resuelta_en = now(), resuelta_por = auth.uid() where id = v.id;
      insert into public.alerta_eventos (alerta_id, accion, texto) values (v.id, 'RESUELTA', trim(p ->> 'causa'));
    when 'REABRIR' then
      if not v_admin then raise exception 'Sin permiso: las alertas las reabre administración.' using errcode = '42501'; end if;
      if exists (select 1 from public.alertas where clave = v.clave and estado <> 'RESUELTA' and id <> v.id) then
        return jsonb_build_object('ok', false, 'error', 'Ya hay una alerta abierta por lo mismo.');
      end if;
      update public.alertas set estado = 'ABIERTA', resuelta_en = null, resuelta_por = null where id = v.id;
      insert into public.alerta_eventos (alerta_id, accion, texto) values (v.id, 'REABIERTA', v_texto);
    else
      return jsonb_build_object('ok', false, 'error', 'Acción no válida.');
  end case;
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.responsables_alertas()
returns table (id uuid, nombre text, rol public.rol_app)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.nombre, p.rol from public.perfiles p
   where p.activo and privado.ve_precios() and p.rol in ('admin', 'jefe_bar', 'chef', 'sous_chef', 'aux_bar', 'aux_cocina')
   order by p.nombre
$$;

revoke execute on function public.generar_alertas(date, date), public.alertas_lista(boolean), public.alerta_eventos_lista(uuid),
                           public.alerta_accion(jsonb), public.responsables_alertas() from public, anon;
grant execute on function public.generar_alertas(date, date), public.alertas_lista(boolean), public.alerta_eventos_lista(uuid),
                          public.alerta_accion(jsonb), public.responsables_alertas() to authenticated;

-- ---------------------------------------------------------------- se revisan solas al cargar ventas y al cerrar
create or replace function privado.alertas_tras_ventas() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform privado.generar_alertas(new.desde, new.hasta);
  return null;
end $$;
-- al final de la transacción, cuando ya están las líneas de la carga
create constraint trigger ventas_cargas_alertas after insert on public.ventas_cargas deferrable initially deferred
  for each row execute function privado.alertas_tras_ventas();

create or replace function privado.alertas_tras_cierre() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform privado.generar_alertas(new.desde, new.hasta);
  return null;
end $$;
-- después de guardar los insumos del período (en la misma transacción del cierre)
create constraint trigger periodos_alertas after insert on public.periodos deferrable initially deferred
  for each row execute function privado.alertas_tras_cierre();
