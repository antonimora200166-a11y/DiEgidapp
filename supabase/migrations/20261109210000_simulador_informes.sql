-- =====================================================================================
-- SGI Di Égida · Simulador de carta y informe quincenal (09/11/2026)
-- · propuestas_carta: lo que se simuló (precio nuevo y/o cantidades nuevas en la ficha) y la
--   decisión que se tomó. El costo nuevo lo calcula la base desde la ficha vigente; el efecto
--   sobre el área lo calcula web/lib/simulador.ts con la mezcla de ventas y se guarda tal cual.
--   Aprobar puede fijar el precio nuevo (con fijar_precio, que deja su historia); el cambio de
--   receta se hace como versión nueva de la ficha en Fichas: aquí solo queda la propuesta.
-- · informes_quincenales: las cifras de un período cerrado y el resumen de 5 líneas. La IA solo
--   redacta con las cifras que le da la base; cada versión del informe queda guardada.
-- Todo es de administración (pesos).
-- =====================================================================================

-- ---------------------------------------------------------------- propuestas
create table if not exists public.propuestas_carta (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,
  generico_id    uuid not null references public.genericos (id),
  area           public.area_app not null,
  ficha_id       uuid references public.fichas (id),
  precio_actual  numeric,
  precio_nuevo   numeric not null check (precio_nuevo > 0),
  costo_actual   numeric,
  costo_nuevo    numeric,
  pct_actual     numeric,
  pct_nuevo      numeric,
  cambios        jsonb not null default '[]',   -- [{generico_id, nombre, unidad, cantidad_actual, cantidad_nueva}]
  resultado      jsonb not null default '{}',   -- efecto sobre el área (web/lib/simulador.ts)
  nota           text,
  estado         text not null default 'PROPUESTA' check (estado in ('PROPUESTA', 'APROBADA', 'DESCARTADA')),
  creada_por     uuid default auth.uid() references public.perfiles (id),
  creada_en      timestamptz not null default now(),
  decidida_por   uuid references public.perfiles (id),
  decidida_en    timestamptz,
  motivo         text,
  precio_aplicado boolean not null default false
);
create index if not exists propuestas_carta_generico_idx on public.propuestas_carta (generico_id, creada_en desc);
create trigger propuestas_carta_sin_borrado before delete on public.propuestas_carta
  for each row execute function privado.bloquear_cambios();

alter table public.propuestas_carta enable row level security;
create policy propuestas_carta_leer on public.propuestas_carta for select to authenticated using (privado.ve_precios());
revoke insert, update, delete on public.propuestas_carta from authenticated, anon;

-- costo de la ficha vigente con cantidades nuevas: cada línea escala con su cantidad
-- (costo_línea × cantidad_nueva / cantidad_actual). Las líneas sin costo dejan el total en null.
create or replace function privado.costo_simulado(p_generico uuid, p_cambios jsonb)
returns table (costo_actual numeric, costo_nuevo numeric, completa boolean, cambios jsonb)
language sql stable security definer set search_path = ''
as $$
  with c as (
    select cf.linea, cf.generico_id, cf.generico as nombre, cf.unidad, cf.cantidad, cf.costo, cf.falta,
           (select (x ->> 'cantidad_nueva')::numeric from jsonb_array_elements(coalesce(p_cambios, '[]')) x
             where (x ->> 'generico_id')::uuid = cf.generico_id limit 1) as nueva
      from privado.costo_ficha_completo(privado.ficha_vigente(p_generico)) cf)
  select round(sum(costo), 2),
         round(sum(case when nueva is null then costo when cantidad > 0 then costo * nueva / cantidad end), 2),
         count(*) > 0 and bool_and(falta is null),
         coalesce(jsonb_agg(jsonb_build_object('generico_id', generico_id, 'nombre', nombre, 'unidad', unidad,
                                               'cantidad_actual', cantidad, 'cantidad_nueva', nueva) order by linea)
                  filter (where nueva is not null and nueva <> cantidad), '[]')
    from c
$$;

create or replace function public.guardar_propuesta(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_g record; v_precio numeric; v_c record; v_imp numeric := privado.parametro_num('IMPOCONSUMO_PCT', 8);
        v_nuevo numeric := (p ->> 'precio_nuevo')::numeric; v_id uuid; v_codigo text;
begin
  if not privado.ve_precios() then
    raise exception 'Sin permiso: el simulador es de administración.' using errcode = '42501';
  end if;
  select g.id, g.area, g.nombre, g.tipo into v_g from public.genericos g where g.id = (p ->> 'generico_id')::uuid and g.activo;
  if v_g.id is null or v_g.tipo not in ('BEBIDA', 'PLATO') then
    return jsonb_build_object('ok', false, 'error', 'Escoge un producto de la carta.');
  end if;
  select pv.precio_con_impuesto into v_precio from public.precios_venta pv
   where pv.generico_id = v_g.id and pv.vigente_desde <= privado.hoy() order by pv.vigente_desde desc limit 1;
  v_nuevo := coalesce(v_nuevo, v_precio);
  if v_nuevo is null or v_nuevo <= 0 or v_nuevo > 10000000 then
    return jsonb_build_object('ok', false, 'error', 'El precio propuesto no es válido.');
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p -> 'cambios', '[]')) x
              where coalesce((x ->> 'cantidad_nueva')::numeric, -1) < 0) then
    return jsonb_build_object('ok', false, 'error', 'Las cantidades nuevas no pueden ser negativas.');
  end if;
  select * into v_c from privado.costo_simulado(v_g.id, p -> 'cambios');
  if round(v_nuevo) = round(coalesce(v_precio, 0)) and jsonb_array_length(v_c.cambios) = 0 then
    return jsonb_build_object('ok', false, 'error', 'La propuesta no cambia ni el precio ni la receta.');
  end if;
  v_codigo := privado.siguiente_codigo('PROP', 4);
  insert into public.propuestas_carta (codigo, generico_id, area, ficha_id, precio_actual, precio_nuevo, costo_actual, costo_nuevo,
                                       pct_actual, pct_nuevo, cambios, resultado, nota)
  values (v_codigo, v_g.id, v_g.area, privado.ficha_vigente(v_g.id), v_precio, round(v_nuevo),
          case when v_c.completa then v_c.costo_actual end, case when v_c.completa then v_c.costo_nuevo end,
          case when v_c.completa and v_precio > 0 then round(v_c.costo_actual / (v_precio / (1 + v_imp / 100)) * 100, 1) end,
          case when v_c.completa then round(v_c.costo_nuevo / (round(v_nuevo) / (1 + v_imp / 100)) * 100, 1) end,
          v_c.cambios, coalesce(p -> 'resultado', '{}'), nullif(trim(p ->> 'nota'), ''))
  returning id into v_id;
  perform privado.bitacora('PROPUESTA DE CARTA', 'propuestas_carta', v_codigo || ' · ' || v_g.nombre,
                           jsonb_build_object('precio_nuevo', round(v_nuevo), 'cambios', v_c.cambios));
  return jsonb_build_object('ok', true, 'id', v_id, 'codigo', v_codigo);
end
$$;

create or replace function public.propuestas_lista(p_area public.area_app default null)
returns table (id uuid, codigo text, generico_id uuid, nombre text, area public.area_app, precio_actual numeric, precio_nuevo numeric,
               costo_actual numeric, costo_nuevo numeric, pct_actual numeric, pct_nuevo numeric, cambios jsonb, resultado jsonb,
               nota text, estado text, creada_por text, creada_en timestamptz, decidida_por text, decidida_en timestamptz,
               motivo text, precio_aplicado boolean, precio_hoy numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.ve_precios() then
    raise exception 'Sin permiso: el simulador es de administración.' using errcode = '42501';
  end if;
  return query
  select pc.id, pc.codigo, pc.generico_id, g.nombre, pc.area, pc.precio_actual, pc.precio_nuevo, pc.costo_actual, pc.costo_nuevo,
         pc.pct_actual, pc.pct_nuevo, pc.cambios, pc.resultado, pc.nota, pc.estado, a.nombre, pc.creada_en, d.nombre, pc.decidida_en,
         pc.motivo, pc.precio_aplicado,
         (select pv.precio_con_impuesto from public.precios_venta pv where pv.generico_id = pc.generico_id and pv.vigente_desde <= privado.hoy()
           order by pv.vigente_desde desc limit 1)
    from public.propuestas_carta pc join public.genericos g on g.id = pc.generico_id
    left join public.perfiles a on a.id = pc.creada_por left join public.perfiles d on d.id = pc.decidida_por
   where p_area is null or pc.area = p_area
   order by (pc.estado <> 'PROPUESTA'), pc.creada_en desc;
end
$$;

-- p: {id, decision: APROBAR | DESCARTAR, motivo, aplicar_precio}
create or replace function public.decidir_propuesta(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v record; v_dec text := upper(coalesce(p ->> 'decision', '')); v_aplicar boolean := coalesce((p ->> 'aplicar_precio')::boolean, false);
        v_r jsonb; v_aplicado boolean := false;
begin
  if not privado.ve_precios() then
    raise exception 'Sin permiso: el simulador es de administración.' using errcode = '42501';
  end if;
  select pc.*, g.nombre into v from public.propuestas_carta pc join public.genericos g on g.id = pc.generico_id
   where pc.id = (p ->> 'id')::uuid for update of pc;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'No encontré la propuesta.'); end if;
  if v.estado <> 'PROPUESTA' then return jsonb_build_object('ok', false, 'error', 'Esta propuesta ya se decidió.'); end if;
  if v_dec not in ('APROBAR', 'DESCARTAR') then return jsonb_build_object('ok', false, 'error', 'Decisión no válida.'); end if;
  if v_dec = 'DESCARTAR' and nullif(trim(p ->> 'motivo'), '') is null then
    return jsonb_build_object('ok', false, 'error', 'Escribe por qué se descarta.');
  end if;
  if v_dec = 'APROBAR' and v_aplicar and v.precio_nuevo is distinct from v.precio_actual then
    v_r := public.fijar_precio(v.generico_id, v.precio_nuevo);
    if not coalesce((v_r ->> 'ok')::boolean, false) then return v_r; end if;
    v_aplicado := true;
  end if;
  update public.propuestas_carta
     set estado = case v_dec when 'APROBAR' then 'APROBADA' else 'DESCARTADA' end,
         decidida_por = auth.uid(), decidida_en = now(), motivo = nullif(trim(p ->> 'motivo'), ''), precio_aplicado = v_aplicado
   where id = v.id;
  perform privado.bitacora('PROPUESTA ' || case v_dec when 'APROBAR' then 'APROBADA' else 'DESCARTADA' end, 'propuestas_carta',
                           v.codigo || ' · ' || v.nombre, jsonb_build_object('precio_aplicado', v_aplicado, 'motivo', p ->> 'motivo'));
  return jsonb_build_object('ok', true, 'precio_aplicado', v_aplicado, 'receta_pendiente', jsonb_array_length(v.cambios) > 0 and v_dec = 'APROBAR');
end
$$;

-- ---------------------------------------------------------------- informe quincenal
create table if not exists public.informes_quincenales (
  id           uuid primary key default gen_random_uuid(),
  periodo_id   uuid not null references public.periodos (id),
  version      integer not null,
  cifras       jsonb not null,          -- lo que se le dio a la IA (o a quien redactó), congelado
  resumen      text not null,
  modelo       text,                    -- null: redactado a mano
  generado_por uuid default auth.uid() references public.perfiles (id),
  generado_en  timestamptz not null default now(),
  unique (periodo_id, version)
);
create trigger informes_quincenales_inmutables before update or delete on public.informes_quincenales
  for each row execute function privado.bloquear_cambios();
alter table public.informes_quincenales enable row level security;
create policy informes_quincenales_leer on public.informes_quincenales for select to authenticated using (privado.ve_precios());
revoke insert, update, delete on public.informes_quincenales from authenticated, anon;

-- Las cifras del informe: el cierre del período, el anterior del área, los insumos con más
-- diferencia, las alertas abiertas que más pesan y las propuestas sin decidir. Es lo único que
-- la IA puede usar para redactar.
create or replace function public.informe_cifras(p_periodo uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_p record; v_ant jsonb;
begin
  if not privado.ve_precios() then
    raise exception 'Sin permiso: Consulta es de administración.' using errcode = '42501';
  end if;
  select * into v_p from public.periodos where id = p_periodo;
  if v_p.id is null then return null; end if;
  select x.resumen into v_ant from public.periodos x where x.area = v_p.area and x.hasta < v_p.desde order by x.hasta desc limit 1;
  return jsonb_build_object(
    'periodo', v_p.resumen || jsonb_build_object('id', v_p.id, 'forzado', v_p.forzado, 'motivo_forzado', v_p.motivo_forzado),
    'anterior', v_ant,
    'insumos', coalesce((select jsonb_agg(jsonb_build_object('nombre', i.nombre, 'unidad', i.unidad_base, 'teorico', round(i.teorico_q, 1),
                                                             'real', round(i.real_q, 1), 'diferencia_pesos', round(i.dif_valor)))
                           from (select * from public.periodo_insumos where periodo_id = v_p.id order by abs(dif_valor) desc limit 8) i), '[]'),
    'alertas', coalesce((select jsonb_agg(jsonb_build_object('regla', a.regla, 'titulo', a.titulo, 'impacto', round(a.impacto), 'estado', a.estado,
                                                             'responsable', pr.nombre))
                           from (select * from public.alertas where area = v_p.area and estado <> 'RESUELTA'
                                  order by impacto desc nulls last limit 8) a
                           left join public.perfiles pr on pr.id = a.responsable_id), '[]'),
    'alertas_abiertas', (select count(*) from public.alertas where area = v_p.area and estado <> 'RESUELTA'),
    'propuestas_pendientes', (select count(*) from public.propuestas_carta where area = v_p.area and estado = 'PROPUESTA'));
end
$$;

-- p: {periodo_id, resumen, modelo}
create or replace function public.guardar_informe(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_periodo uuid := (p ->> 'periodo_id')::uuid; v_ver integer; v_id uuid; v_txt text := trim(coalesce(p ->> 'resumen', ''));
begin
  if not privado.ve_precios() then
    raise exception 'Sin permiso: Consulta es de administración.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.periodos where id = v_periodo) then
    return jsonb_build_object('ok', false, 'error', 'El informe es de un período cerrado.');
  end if;
  if length(v_txt) < 20 then return jsonb_build_object('ok', false, 'error', 'El resumen está vacío.'); end if;
  if length(v_txt) > 4000 then return jsonb_build_object('ok', false, 'error', 'El resumen es demasiado largo.'); end if;
  perform pg_advisory_xact_lock(hashtext('informe:' || v_periodo::text));
  select coalesce(max(version), 0) + 1 into v_ver from public.informes_quincenales where periodo_id = v_periodo;
  insert into public.informes_quincenales (periodo_id, version, cifras, resumen, modelo)
  values (v_periodo, v_ver, public.informe_cifras(v_periodo), v_txt, nullif(p ->> 'modelo', ''))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'version', v_ver);
end
$$;

create or replace function public.informes_lista(p_periodo uuid)
returns table (id uuid, version integer, resumen text, modelo text, generado_por text, generado_en timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.ve_precios() then
    raise exception 'Sin permiso: Consulta es de administración.' using errcode = '42501';
  end if;
  return query select i.id, i.version, i.resumen, i.modelo, pr.nombre, i.generado_en
    from public.informes_quincenales i left join public.perfiles pr on pr.id = i.generado_por
   where i.periodo_id = p_periodo order by i.version desc;
end
$$;

revoke execute on function privado.costo_simulado(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.guardar_propuesta(jsonb), public.propuestas_lista(public.area_app), public.decidir_propuesta(jsonb),
                           public.informe_cifras(uuid), public.guardar_informe(jsonb), public.informes_lista(uuid) from public, anon;
grant execute on function public.guardar_propuesta(jsonb), public.propuestas_lista(public.area_app), public.decidir_propuesta(jsonb),
                          public.informe_cifras(uuid), public.guardar_informe(jsonb), public.informes_lista(uuid) to authenticated;
