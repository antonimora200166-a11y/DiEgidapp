-- =====================================================================================
-- SGI Di Égida · 21 · Corregir y crear fichas técnicas desde la app
-- public.lista_fichas(área)      : MPI, cócteles y platos del área con el estado de su ficha.
-- public.ficha_para_editar(gen)  : la ficha vigente con sus líneas y lo que se puede usar.
-- public.guardar_ficha(p)        : guarda la receta. Si la ficha vigente nunca se usó en un lote,
--   se corrige en su lugar (queda en bitácora); si ya costeó lotes, nace una versión nueva y la
--   anterior queda vigente hasta hoy, para que esos lotes conserven la receta con que se hicieron.
--   Una línea en una unidad sin conversión puede traer su equivalencia, que se registra en
--   conversiones (DECLARADO) para que la ficha costee.
-- Corrige el jefe del área o administración (privado.edita_generico).
-- =====================================================================================

-- ---------------------------------------------------------------- utilidades
create or replace function privado.ficha_vigente(p_generico uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select f.id from public.fichas f
   where f.generico_id = p_generico and f.vigente_desde <= privado.hoy()
     and (f.vigente_hasta is null or f.vigente_hasta >= privado.hoy())
   order by f.version desc limit 1
$$;

-- ---------------------------------------------------------------- lista
create or replace function public.lista_fichas(p_area public.area_app)
returns table (generico_id uuid, nombre text, tipo public.tipo_generico, unidad_base public.unidad_base,
               ficha_id uuid, codigo text, version integer, neto_esperado numeric, lineas integer, faltan integer,
               primer_falta text, lotes integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.ve_costos() or not (privado.opera_en(p_area) or privado.tiene_rol('admin', 'auditor')) then
    raise exception 'Sin permiso para ver las fichas de %.', p_area using errcode = '42501';
  end if;
  return query
  select g.id, g.nombre, g.tipo, g.unidad_base, f.id, f.codigo, f.version, f.neto_esperado,
         (select count(*)::int from public.ficha_lineas l where l.ficha_id = f.id),
         (select count(*)::int from public.costo_ficha(f.id) c
           where c.falta like 'La ficha no trae cantidad%' or c.falta like 'Falta la conversión%'),
         (select c.falta from public.costo_ficha(f.id) c
           where c.falta like 'La ficha no trae cantidad%' or c.falta like 'Falta la conversión%' order by c.linea limit 1),
         (select count(*)::int from public.lotes_produccion lp where lp.ficha_id = f.id)
    from public.genericos g
    left join public.fichas f on f.id = privado.ficha_vigente(g.id)
   where g.area = p_area and g.activo and g.tipo in ('MPI', 'BEBIDA', 'PLATO')
   order by g.tipo, f.codigo nulls last, g.nombre;
end
$$;

-- ---------------------------------------------------------------- leer para editar
create or replace function public.ficha_para_editar(p_generico uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_gen public.genericos%rowtype;
  v_fid uuid;
begin
  select * into v_gen from public.genericos where id = p_generico;
  if v_gen.id is null or v_gen.tipo not in ('MPI', 'BEBIDA', 'PLATO') then
    raise exception 'Solo los MPI, cócteles y platos tienen ficha técnica.';
  end if;
  if not privado.ve_costos() or not (privado.opera_en(v_gen.area) or privado.tiene_rol('admin', 'auditor')) then
    raise exception 'Sin permiso para ver las fichas de %.', v_gen.area using errcode = '42501';
  end if;
  v_fid := privado.ficha_vigente(v_gen.id);

  return jsonb_build_object(
    'resultado', jsonb_build_object('id', v_gen.id, 'codigo', v_gen.codigo, 'nombre', v_gen.nombre, 'tipo', v_gen.tipo,
                                    'unidad_base', v_gen.unidad_base, 'area', v_gen.area),
    'puede_editar', privado.edita_area(v_gen.area),
    'ficha', (select jsonb_build_object('id', f.id, 'codigo', f.codigo, 'version', f.version, 'neto_esperado', f.neto_esperado,
                                        'nota', f.nota, 'vigente_desde', f.vigente_desde,
                                        'lotes', (select count(*) from public.lotes_produccion lp where lp.ficha_id = f.id))
                from public.fichas f where f.id = v_fid),
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object('generico_id', g.id, 'generico', g.nombre, 'tipo', g.tipo, 'unidad_base', g.unidad_base,
                                          'cantidad', l.cantidad, 'unidad', l.unidad, 'nota', l.nota,
                                          'factor', privado.a_base(g.id, 1, l.unidad),
                                          'costo', c.costo, 'falta', c.falta) order by l.linea)
        from public.ficha_lineas l join public.genericos g on g.id = l.generico_id
        left join public.costo_ficha(v_fid) c on c.linea = l.linea
       where l.ficha_id = v_fid), '[]'),
    -- lo que puede ir en la receta: insumos, MPI y lo sin costo del área, con las unidades que ya convierte
    'ingredientes', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'nombre', g.nombre, 'tipo', g.tipo, 'unidad_base', g.unidad_base,
                                          'unidades', (select coalesce(jsonb_agg(c.unidad order by c.unidad), '[]')
                                                         from public.conversiones c where c.generico_id = g.id))
                       order by g.nombre)
        from public.genericos g
       where g.area = v_gen.area and g.activo and g.tipo in ('MPe', 'MPI', 'SIN_COSTO') and g.id <> v_gen.id), '[]'));
end
$$;

-- ---------------------------------------------------------------- guardar
-- p: {generico_id, codigo, neto_esperado, nota,
--     lineas: [{generico_id, cantidad, unidad, nota, factor?}]}   factor: «1 <unidad> = factor <unidad base>»
create or replace function public.guardar_ficha(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_gen    public.genericos%rowtype;
  v_vieja  public.fichas%rowtype;
  v_id     uuid;
  v_codigo text := nullif(trim(p ->> 'codigo'), '');
  v_neto   numeric;
  v_nota   text := nullif(trim(p ->> 'nota'), '');
  v_l      jsonb; v_n int; v_ing record; v_cant numeric; v_unidad text; v_factor numeric;
  v_lotes  int := 0;
  v_modo   text;
  f text[] := '{}'; a text[] := '{}';
  v_vistos uuid[] := '{}';
begin
  select * into v_gen from public.genericos where id = privado.uuid_o_null(p ->> 'generico_id') for update;
  if v_gen.id is null or v_gen.tipo not in ('MPI', 'BEBIDA', 'PLATO') then
    raise exception 'Solo los MPI, cócteles y platos tienen ficha técnica.';
  end if;
  if not privado.edita_area(v_gen.area) then
    raise exception 'Solo el jefe de % o administración corrigen fichas.', v_gen.area using errcode = '42501';
  end if;
  select * into v_vieja from public.fichas where id = privado.ficha_vigente(v_gen.id);
  if v_vieja.id is not null then
    select count(*) into v_lotes from public.lotes_produccion lp where lp.ficha_id = v_vieja.id;
  end if;

  if v_codigo is null then f := f || 'Falta el código de la ficha (#5, C02…).'::text;
  elsif exists (select 1 from public.fichas o join public.genericos og on og.id = o.generico_id
                 where o.codigo = v_codigo and og.area = v_gen.area and o.generico_id <> v_gen.id
                   and (o.vigente_hasta is null or o.vigente_hasta >= privado.hoy())) then
    f := f || ('El código ' || v_codigo || ' ya lo usa otra ficha de ' || v_gen.area || '.');
  end if;
  v_neto := privado.num_o_null(p ->> 'neto_esperado');
  if nullif(trim(p ->> 'neto_esperado'), '') is not null and (v_neto is null or v_neto <= 0) then
    f := f || 'El neto esperado debe ser un número mayor que cero.'::text;
  elsif v_neto is null and v_gen.tipo = 'MPI' then
    a := a || ('Sin neto esperado (en ' || v_gen.unidad_base || ') no hay costo estándar por ' || v_gen.unidad_base || ' ni comparación de rendimiento.');
  end if;
  if jsonb_typeof(p -> 'lineas') is distinct from 'array' or jsonb_array_length(p -> 'lineas') = 0 then
    f := f || 'La ficha necesita al menos un ingrediente.'::text;
  end if;

  for v_l, v_n in select e.value, e.ordinality from jsonb_array_elements(coalesce(p -> 'lineas', '[]')) with ordinality e
  loop
    select g.id, g.nombre, g.tipo, g.area, g.activo, g.unidad_base into v_ing
      from public.genericos g where g.id = privado.uuid_o_null(v_l ->> 'generico_id');
    if v_ing.id is null or not v_ing.activo or v_ing.area <> v_gen.area then
      f := f || ('Línea ' || v_n || ': el ingrediente no está activo en el catálogo de ' || v_gen.area || '.'); continue;
    end if;
    if v_ing.tipo in ('BEBIDA', 'PLATO') then f := f || ('Línea ' || v_n || ' (' || v_ing.nombre || '): un plato o cóctel no es ingrediente.'); continue; end if;
    if v_ing.id = v_gen.id then f := f || ('Línea ' || v_n || ': una ficha no se usa a sí misma.'); continue; end if;
    if v_ing.id = any (v_vistos) then a := a || ('«' || v_ing.nombre || '» está dos veces en la receta.'); end if;
    v_vistos := v_vistos || v_ing.id;
    v_cant := privado.num_o_null(v_l ->> 'cantidad');
    v_unidad := lower(coalesce(nullif(trim(v_l ->> 'unidad'), ''), v_ing.unidad_base::text));
    v_factor := privado.num_o_null(v_l ->> 'factor');
    if nullif(trim(v_l ->> 'cantidad'), '') is not null and (v_cant is null or v_cant <= 0) then
      f := f || ('Línea ' || v_n || ' (' || v_ing.nombre || '): la cantidad debe ser mayor que cero.');
    elsif v_cant is null then
      a := a || ('«' || v_ing.nombre || '» sin cantidad: la ficha queda incompleta.');
    end if;
    if v_unidad !~ '^[a-z]+$' then f := f || ('Línea ' || v_n || ': unidad no válida «' || v_unidad || '».'); continue; end if;
    if privado.a_base(v_ing.id, 1, v_unidad) is null then
      if v_factor is not null and v_factor > 0 then
        null;   -- se registra al guardar
      elsif v_unidad not in ('dash', 'gts', 'gota') then
        a := a || ('«' || v_ing.nombre || '» en ' || v_unidad || ' no tiene conversión a ' || v_ing.unidad_base || ': la ficha no lo costea.');
      end if;
    elsif v_factor is not null then
      a := a || ('«' || v_ing.nombre || '»: ' || v_unidad || ' ya tenía conversión; se dejó la registrada.');
    end if;
  end loop;

  if cardinality(f) > 0 then return privado.resultado(false, null, null, f, '{}', a); end if;

  -- conversiones nuevas que trajo la receta
  for v_l in select value from jsonb_array_elements(p -> 'lineas')
  loop
    v_unidad := lower(coalesce(nullif(trim(v_l ->> 'unidad'), ''), ''));
    v_factor := privado.num_o_null(v_l ->> 'factor');
    if v_factor > 0 and v_unidad <> '' and privado.a_base((v_l ->> 'generico_id')::uuid, 1, v_unidad) is null then
      insert into public.conversiones (generico_id, unidad, factor_a_base, estado, nota)
      values ((v_l ->> 'generico_id')::uuid, v_unidad, v_factor, 'DECLARADO', 'Desde la ficha ' || v_codigo || ' de ' || v_gen.nombre)
      on conflict (generico_id, unidad) do nothing;
    end if;
  end loop;

  if v_vieja.id is null or v_lotes > 0 then
    -- ficha nueva, o versión nueva de una que ya costeó lotes
    if v_vieja.id is not null then
      update public.fichas set vigente_hasta = greatest(privado.hoy() - 1, vigente_desde) where id = v_vieja.id;
    end if;
    insert into public.fichas (codigo, generico_id, version, neto_esperado, vigente_desde, nota)
    values (v_codigo, v_gen.id,
            coalesce((select max(x.version) from public.fichas x where x.generico_id = v_gen.id), 0) + 1,
            v_neto, privado.hoy(), v_nota)
    returning id into v_id;
    v_modo := case when v_vieja.id is null then 'FICHA CREADA' else 'FICHA VERSIÓN NUEVA' end;
  else
    v_id := v_vieja.id;
    update public.fichas set codigo = v_codigo, neto_esperado = v_neto, nota = v_nota where id = v_id;
    delete from public.ficha_lineas where ficha_id = v_id;   -- auditado línea por línea en bitácora
    v_modo := 'FICHA CORREGIDA';
  end if;

  insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad, nota)
  select v_id, e.ordinality, (e.value ->> 'generico_id')::uuid, privado.num_o_null(e.value ->> 'cantidad'),
         lower(coalesce(nullif(trim(e.value ->> 'unidad'), ''), (select g.unidad_base::text from public.genericos g where g.id = (e.value ->> 'generico_id')::uuid))),
         nullif(trim(e.value ->> 'nota'), '')
    from jsonb_array_elements(p -> 'lineas') with ordinality e;

  perform privado.bitacora(v_modo, 'fichas', v_codigo,
    jsonb_build_object('generico', v_gen.codigo, 'ficha_id', v_id, 'lineas', jsonb_array_length(p -> 'lineas'),
                       'version_anterior', v_vieja.version));
  if v_modo = 'FICHA VERSIÓN NUEVA' then
    a := a || ('Como la versión ' || v_vieja.version || ' ya costeó ' || v_lotes || ' lote(s), se creó la versión '
               || (select f2.version from public.fichas f2 where f2.id = v_id) || '. Los lotes viejos conservan su receta.');
  end if;
  return privado.resultado(true, v_id, v_codigo, '{}', '{}', a);
end
$$;

revoke execute on function privado.ficha_vigente(uuid) from public;
revoke execute on function public.lista_fichas(public.area_app), public.ficha_para_editar(uuid), public.guardar_ficha(jsonb) from public, anon;
grant execute on function public.lista_fichas(public.area_app), public.ficha_para_editar(uuid), public.guardar_ficha(jsonb) to authenticated;
