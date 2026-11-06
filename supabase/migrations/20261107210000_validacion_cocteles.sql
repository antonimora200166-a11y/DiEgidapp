-- =====================================================================================
-- SGI Di Égida · Producción · 5 · Validación también para la carta de coctelería (Anthony, 05/11/2026)
-- Las funciones de 20261107120000 servían solo al recetario de cocina (MPI). Ahora cada fuente
-- dice su área, el tipo de lo que valida y la clase de receta:
--   RECETARIO COCINA  → COCINA · MPI    · subreceta
--   CARTA COCTELERÍA  → BAR    · BEBIDA · bebida   (supabase/datos/recetario_cocteles.sql)
-- Las 50 bebidas del bar ya tienen ficha (SGI-COSTOS) con los mismos códigos C01…C45 (sangrías
-- en jarra J y copa C): la propuesta se empareja primero por código. Al aprobar nace una versión
-- nueva que conserva los ingredientes ya costeados y suma procedimiento, descripción,
-- presentación, método y alérgenos de la carta. Decide el jefe de barra (o administración).
-- =====================================================================================

create or replace function privado.fuente_area(p text) returns public.area_app language sql immutable set search_path = ''
as $$ select (case when p = 'CARTA COCTELERÍA' then 'BAR' else 'COCINA' end)::public.area_app $$;
create or replace function privado.fuente_tipo(p text) returns public.tipo_generico language sql immutable set search_path = ''
as $$ select (case when p = 'CARTA COCTELERÍA' then 'BEBIDA' else 'MPI' end)::public.tipo_generico $$;
create or replace function privado.fuente_clase(p text) returns text language sql immutable set search_path = ''
as $$ select case when p = 'CARTA COCTELERÍA' then 'bebida' else 'subreceta' end $$;

create or replace function privado.exige_ver_fuente(p_fuente text)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.ve_area(privado.fuente_area(p_fuente)) then
    raise exception 'Sin permiso para ver las fichas de %.', privado.fuente_area(p_fuente) using errcode = '42501';
  end if;
end
$$;
create or replace function privado.exige_editar_fuente(p_fuente text)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.edita_ficha(privado.fuente_area(p_fuente)) then
    raise exception 'Solo % o administración validan estas fichas.',
      case when privado.fuente_area(p_fuente) = 'BAR' then 'el jefe de barra' else 'el chef' end using errcode = '42501';
  end if;
end
$$;
revoke execute on function privado.exige_ver_fuente(text), privado.exige_editar_fuente(text) from public;

-- quién ve cada tabla: según el área de la fuente
drop policy if exists recetario_ingredientes_leer on public.recetario_ingredientes;
drop policy if exists recetario_recetas_leer on public.recetario_recetas;
drop policy if exists mpi_revision_leer on public.mpi_revision;
create policy recetario_ingredientes_leer on public.recetario_ingredientes for select to authenticated using (privado.ve_area(privado.fuente_area(fuente)));
create policy recetario_recetas_leer on public.recetario_recetas for select to authenticated using (privado.ve_area(privado.fuente_area(fuente)));
create policy mpi_revision_leer on public.mpi_revision for select to authenticated
  using (privado.ve_area((select g.area from public.genericos g where g.id = generico_id)));

-- ---------------------------------------------------------------- propuestas por parecido
-- Ingredientes pendientes → genérico de cocina más parecido (insumos, MPI, sin costo).
-- Subrecetas sin MPI → MPI de cocina más parecida que no tenga ya receta. Umbral 0,3.
create or replace function privado.recetario_proponer(p_fuente text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.recetario_ingredientes t
     set (propuesto_id, similitud) = (
       select x.id, x.sim from (
         select g.id, round(extensions.similarity(g.nombre_norm, privado.normalizar(t.nombre))::numeric, 2) as sim
           from public.genericos g
          where g.area = privado.fuente_area(p_fuente) and g.activo and g.tipo in ('MPe', 'MPI', 'SIN_COSTO')
            and g.clase in ('MATERIA_PRIMA', 'DESECHABLE')
          order by 2 desc, g.nombre limit 1) x where x.sim >= 0.3)
   where t.fuente = p_fuente and t.estado = 'PENDIENTE';

  -- primero por código de ficha (los cócteles C01…), luego por parecido del nombre
  update public.recetario_recetas t
     set propuesto_id = x.id, similitud = 1
    from (select g.id, f.codigo from public.genericos g join public.fichas f on f.id = privado.ficha_vigente(g.id)
           where g.area = privado.fuente_area(p_fuente) and g.activo and g.tipo = privado.fuente_tipo(p_fuente)) x
   where t.fuente = p_fuente and t.estado = 'PENDIENTE' and t.generico_id is null and x.codigo = t.codigo
     and not exists (select 1 from public.recetario_recetas o where o.fuente = t.fuente and o.generico_id = x.id);

  update public.recetario_recetas t
     set (propuesto_id, similitud) = (
       select x.id, x.sim from (
         select g.id, round(extensions.similarity(g.nombre_norm, privado.normalizar(t.nombre))::numeric, 2) as sim
           from public.genericos g
          where g.area = privado.fuente_area(p_fuente) and g.activo and g.tipo = privado.fuente_tipo(p_fuente)
            and not exists (select 1 from public.recetario_recetas o where o.fuente = t.fuente and o.generico_id = g.id)
          order by 2 desc, g.nombre limit 1) x where x.sim >= 0.3)
   where t.fuente = p_fuente and t.clase = privado.fuente_clase(p_fuente) and t.estado = 'PENDIENTE' and t.generico_id is null
     and t.similitud is distinct from 1;
end
$$;
revoke execute on function privado.recetario_proponer(text) from public;


-- ---------------------------------------------------------------- tablero de avance
create or replace function public.validacion_recetario_resumen(p_fuente text default 'RECETARIO COCINA')
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform privado.exige_ver_fuente(p_fuente);
  return jsonb_build_object(
    'puede_editar', privado.edita_ficha(privado.fuente_area(p_fuente)),
    'ingredientes', (select jsonb_build_object(
        'total', count(*), 'confirmados', count(*) filter (where estado = 'CONFIRMADO'),
        'nuevos', count(*) filter (where estado = 'NUEVO'), 'excluidos', count(*) filter (where estado = 'EXCLUIDO'),
        'pendientes', count(*) filter (where estado = 'PENDIENTE'),
        'exactos', count(*) filter (where estado = 'PENDIENTE' and similitud >= 0.99))
      from public.recetario_ingredientes where fuente = p_fuente),
    'mpi', (select jsonb_build_object(
        'total', count(*),
        'con_ficha', count(*) filter (where privado.ficha_vigente(g.id) is not null),
        'aprobadas', count(*) filter (where exists (select 1 from public.recetario_recetas r where r.fuente = p_fuente and r.generico_id = g.id and r.estado = 'APROBADA')),
        'receta_elegida', count(*) filter (where exists (select 1 from public.recetario_recetas r where r.fuente = p_fuente and r.generico_id = g.id and r.estado = 'PENDIENTE')),
        'sin_receta', count(*) filter (where mr.estado = 'SIN_RECETA'),
        'no_es_mpi', count(*) filter (where mr.estado = 'NO_ES_MPI'))
      from public.genericos g left join public.mpi_revision mr on mr.generico_id = g.id
     where g.area = privado.fuente_area(p_fuente) and g.activo and g.tipo = privado.fuente_tipo(p_fuente)),
    'recetas', (select jsonb_build_object(
        'subrecetas', count(*), 'aprobadas', count(*) filter (where estado = 'APROBADA'),
        'sin_mpi', count(*) filter (where generico_id is null and estado = 'PENDIENTE'))
      from public.recetario_recetas where fuente = p_fuente and clase = privado.fuente_clase(p_fuente)));
end
$$;

-- ---------------------------------------------------------------- 1. ingredientes
create or replace function public.recetario_ingredientes_lista(p_fuente text default 'RECETARIO COCINA')
returns table (codigo text, nombre text, categoria text, presentacion text, unidad text, area text, estado text,
               propuesto_id uuid, propuesto text, propuesto_tipo text, propuesto_ub text, similitud numeric,
               generico_id uuid, generico text, generico_ub text, usos integer, usos_subrecetas integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform privado.exige_ver_fuente(p_fuente);
  return query
  select t.codigo, t.nombre, t.categoria, t.presentacion, t.unidad, t.area, t.estado,
         t.propuesto_id, gp.nombre, gp.tipo::text, gp.unidad_base::text, t.similitud,
         t.generico_id, gc.nombre, gc.unidad_base::text,
         (select count(*)::int from public.recetario_recetas r, jsonb_array_elements(r.componentes) c
           where r.fuente = t.fuente and c ->> 'tipo' = 'ing' and c ->> 'codigo' = t.codigo),
         (select count(*)::int from public.recetario_recetas r, jsonb_array_elements(r.componentes) c
           where r.fuente = t.fuente and r.clase = privado.fuente_clase(p_fuente) and c ->> 'tipo' = 'ing' and c ->> 'codigo' = t.codigo)
    from public.recetario_ingredientes t
    left join public.genericos gp on gp.id = t.propuesto_id
    left join public.genericos gc on gc.id = t.generico_id
   where t.fuente = p_fuente
   order by t.nombre;
end
$$;

-- p_decision: CONFIRMAR (con p_generico, o la propuesta de cada uno), NUEVO, EXCLUIR, PENDIENTE (reabrir)
create or replace function public.decidir_ingredientes_recetario(p_fuente text, p_codigos text[], p_decision text, p_generico uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_gen public.genericos%rowtype;
  v_n   integer;
begin
  perform privado.exige_editar_fuente(p_fuente);
  if p_decision not in ('CONFIRMAR', 'NUEVO', 'EXCLUIR', 'PENDIENTE') then raise exception 'Decisión no válida: %', p_decision; end if;
  if p_generico is not null then
    select * into v_gen from public.genericos where id = p_generico;
    if v_gen.id is null or v_gen.area <> privado.fuente_area(p_fuente) or not v_gen.activo or v_gen.tipo not in ('MPe', 'MPI', 'SIN_COSTO') then
      raise exception 'Elige un insumo, MPI o sin costo activo del área.';
    end if;
  end if;
  if p_decision = 'CONFIRMAR' then
    update public.recetario_ingredientes t
       set estado = 'CONFIRMADO', generico_id = coalesce(p_generico, t.propuesto_id), decidido_por = auth.uid(), decidido_en = now()
     where t.fuente = p_fuente and t.codigo = any (p_codigos) and coalesce(p_generico, t.propuesto_id) is not null;
  else
    update public.recetario_ingredientes t
       set estado = case p_decision when 'NUEVO' then 'NUEVO' when 'EXCLUIR' then 'EXCLUIDO' else 'PENDIENTE' end,
           generico_id = null, decidido_por = auth.uid(), decidido_en = now()
     where t.fuente = p_fuente and t.codigo = any (p_codigos);
  end if;
  get diagnostics v_n = row_count;
  perform privado.bitacora('RECETARIO INGREDIENTES ' || p_decision, 'recetario_ingredientes', p_fuente,
                           jsonb_build_object('codigos', to_jsonb(p_codigos), 'generico', p_generico, 'n', v_n));
  return jsonb_build_object('ok', true, 'n', v_n,
    'sin_propuesta', case when p_decision = 'CONFIRMAR' and p_generico is null then cardinality(p_codigos) - v_n else 0 end);
end
$$;

-- ---------------------------------------------------------------- 2. MPI ↔ receta
create or replace function public.validacion_mpi(p_fuente text default 'RECETARIO COCINA')
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform privado.exige_ver_fuente(p_fuente);
  return jsonb_build_object(
    'mpis', coalesce((
      select jsonb_agg(x order by x ->> 'nombre') from (
        select jsonb_build_object(
          'generico_id', g.id, 'codigo', g.codigo, 'nombre', g.nombre, 'unidad_base', g.unidad_base, 'estado_catalogo', g.estado,
          'ficha_id', privado.ficha_vigente(g.id),
          'ficha_origen', (select f.origen from public.fichas f where f.id = privado.ficha_vigente(g.id)),
          'revision', mr.estado, 'nota', mr.nota,
          'receta', (select jsonb_build_object('codigo', r.codigo, 'nombre', r.nombre, 'estado', r.estado, 'rendimiento', r.rendimiento, 'unidad', r.unidad)
                       from public.recetario_recetas r where r.fuente = p_fuente and r.generico_id = g.id),
          'candidatas', coalesce((
            select jsonb_agg(jsonb_build_object('codigo', c.codigo, 'nombre', c.nombre, 'similitud', c.sim, 'rendimiento', c.rendimiento, 'unidad', c.unidad)
                             order by c.sim desc)
              from (select r.codigo, r.nombre, r.rendimiento, r.unidad,
                           case when r.codigo = (select f.codigo from public.fichas f where f.id = privado.ficha_vigente(g.id)) then 1
                                else round(extensions.similarity(g.nombre_norm, privado.normalizar(r.nombre))::numeric, 2) end as sim
                      from public.recetario_recetas r
                     where r.fuente = p_fuente and r.clase = privado.fuente_clase(p_fuente) and r.estado = 'PENDIENTE' and r.generico_id is null
                     order by 5 desc limit 3) c where c.sim >= 0.2), '[]')) as x
          from public.genericos g left join public.mpi_revision mr on mr.generico_id = g.id
         where g.area = privado.fuente_area(p_fuente) and g.activo and g.tipo = privado.fuente_tipo(p_fuente)) s), '[]'),
    'recetas', coalesce((
      select jsonb_agg(jsonb_build_object('codigo', r.codigo, 'nombre', r.nombre, 'rendimiento', r.rendimiento, 'unidad', r.unidad,
                                          'estado', r.estado, 'generico_id', r.generico_id,
                                          'mpi', (select g.nombre from public.genericos g where g.id = r.generico_id),
                                          'propuesto_id', r.propuesto_id, 'similitud', r.similitud,
                                          'propuesto', (select g.nombre from public.genericos g where g.id = r.propuesto_id),
                                          'componentes', jsonb_array_length(r.componentes),
                                          'pasos', jsonb_array_length(coalesce(r.propuesta -> 'pasos', '[]'))) order by r.nombre)
        from public.recetario_recetas r where r.fuente = p_fuente and r.clase = privado.fuente_clase(p_fuente)), '[]'));
end
$$;

-- elige (o quita, con p_generico null) la MPI de una receta
create or replace function public.elegir_receta_mpi(p_fuente text, p_codigo text, p_generico uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.recetario_recetas%rowtype;
  v_g public.genericos%rowtype;
begin
  perform privado.exige_editar_fuente(p_fuente);
  select * into v_r from public.recetario_recetas where fuente = p_fuente and codigo = p_codigo for update;
  if v_r.codigo is null or v_r.clase <> privado.fuente_clase(p_fuente) then raise exception 'Esa receta no está en %.', p_fuente; end if;
  if v_r.estado = 'APROBADA' then raise exception 'La receta % ya es ficha: cámbiala desde la ficha de su MPI.', v_r.nombre; end if;
  if p_generico is not null then
    select * into v_g from public.genericos where id = p_generico;
    if v_g.id is null or v_g.area <> privado.fuente_area(p_fuente) or v_g.tipo <> privado.fuente_tipo(p_fuente) or not v_g.activo then
      raise exception 'Elige % activa del área.', case when privado.fuente_tipo(p_fuente) = 'BEBIDA' then 'una bebida' else 'una MPI' end;
    end if;
    if exists (select 1 from public.recetario_recetas o where o.fuente = p_fuente and o.generico_id = p_generico and o.estado = 'APROBADA') then
      raise exception '% ya tiene su receta aprobada.', v_g.nombre;
    end if;
    update public.recetario_recetas set generico_id = null where fuente = p_fuente and generico_id = p_generico and codigo <> p_codigo;
    delete from public.mpi_revision where generico_id = p_generico;
  end if;
  update public.recetario_recetas set generico_id = p_generico, decidido_por = auth.uid(), decidido_en = now()
   where fuente = p_fuente and codigo = p_codigo;
  perform privado.bitacora(case when p_generico is null then 'RECETA SIN MPI' else 'RECETA ↔ MPI' end, 'recetario_recetas', p_codigo,
                           jsonb_build_object('fuente', p_fuente, 'generico', p_generico, 'antes', v_r.generico_id));
  return jsonb_build_object('ok', true);
end
$$;

-- p_estado: SIN_RECETA, NO_ES_MPI o null (quitar la marca)
create or replace function public.marcar_mpi(p_generico uuid, p_estado text, p_nota text default null, p_fuente text default 'RECETARIO COCINA')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform privado.exige_editar_fuente(p_fuente);
  if not exists (select 1 from public.genericos g where g.id = p_generico and g.area = privado.fuente_area(p_fuente) and g.tipo = privado.fuente_tipo(p_fuente)) then
    raise exception 'Ese genérico no corresponde a %.', p_fuente;
  end if;
  if p_estado is null then
    delete from public.mpi_revision where generico_id = p_generico;
  elsif p_estado in ('SIN_RECETA', 'NO_ES_MPI') then
    update public.recetario_recetas set generico_id = null where fuente = p_fuente and generico_id = p_generico and estado = 'PENDIENTE';
    insert into public.mpi_revision (generico_id, estado, nota) values (p_generico, p_estado, privado.texto_o_null(p_nota, 300))
    on conflict (generico_id) do update set estado = excluded.estado, nota = excluded.nota, decidido_por = auth.uid(), decidido_en = now();
  else
    raise exception 'Marca no válida: %', p_estado;
  end if;
  return jsonb_build_object('ok', true);
end
$$;

-- receta sin MPI → crea la MPI provisional (genérico + producto a granel) y se la asigna
create or replace function public.crear_mpi_desde_receta(p_fuente text, p_codigo text, p_motivo text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_r   public.recetario_recetas%rowtype;
  v_res jsonb;
  v_gen uuid;
begin
  perform privado.exige_editar_fuente(p_fuente);
  select * into v_r from public.recetario_recetas where fuente = p_fuente and codigo = p_codigo for update;
  if v_r.codigo is null or v_r.clase <> 'subreceta' then raise exception 'Solo las subrecetas de cocina crean su MPI; una bebida nueva se crea en el catálogo.'; end if;
  if v_r.generico_id is not null then raise exception 'La receta % ya tiene MPI.', v_r.nombre; end if;
  v_res := public.crear_producto(jsonb_build_object(
    'area', 'COCINA',
    'generico', jsonb_build_object('nombre', v_r.nombre, 'tipo', 'MPI',
                                   'unidad_base', case when v_r.unidad in ('ml', 'und') then v_r.unidad else 'g' end,
                                   'categoria', (select c.codigo from public.categorias c where c.codigo = 'COC_MPI' and c.area = 'COCINA' and c.activo)),
    'marca', 'Di Égida', 'presentacion', 'Granel', 'unidad_compra', 'GR', 'contenido_base', 1,
    'nota', 'Creada desde la receta ' || v_r.codigo || ' del recetario de cocina', 'motivo_forzado', p_motivo));
  if not coalesce((v_res ->> 'ok')::boolean, false) then return v_res; end if;
  select p.generico_id into v_gen from public.productos p where p.id = (v_res ->> 'id')::uuid;
  update public.recetario_recetas set generico_id = v_gen, decidido_por = auth.uid(), decidido_en = now()
   where fuente = p_fuente and codigo = p_codigo;
  perform privado.bitacora('MPI CREADA DESDE RECETA', 'recetario_recetas', p_codigo, jsonb_build_object('fuente', p_fuente, 'generico', v_gen));
  return v_res || jsonb_build_object('generico_id', v_gen);
end
$$;

-- ---------------------------------------------------------------- 3. propuesta y aprobación
create or replace function public.propuesta_receta(p_fuente text, p_codigo text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_r public.recetario_recetas%rowtype;
begin
  perform privado.exige_ver_fuente(p_fuente);
  select * into v_r from public.recetario_recetas where fuente = p_fuente and codigo = p_codigo;
  if v_r.codigo is null then raise exception 'No existe la receta % en el recetario.', p_codigo; end if;
  return jsonb_build_object(
    'receta', jsonb_build_object('fuente', v_r.fuente, 'codigo', v_r.codigo, 'clase', v_r.clase, 'nombre', v_r.nombre,
                                 'descripcion', v_r.descripcion, 'rendimiento', v_r.rendimiento, 'unidad', v_r.unidad,
                                 'alergenos', to_jsonb(v_r.alergenos), 'procedimiento', v_r.procedimiento, 'estado', v_r.estado,
                                 'generico_id', v_r.generico_id, 'ficha_id', v_r.ficha_id),
    'propuesta', v_r.propuesta,
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'tipo', c ->> 'tipo', 'codigo', c ->> 'codigo', 'cantidad', (c ->> 'cantidad')::numeric, 'unidad', c ->> 'unidad',
               'nombre', coalesce(i.nombre, s.nombre, c ->> 'nombre'), 'nota', c ->> 'nota',
               'estado', case when c ->> 'tipo' = 'ing' then i.estado else case when s.generico_id is null then 'SIN_MPI' else 'CONFIRMADO' end end,
               'generico_id', case when c ->> 'tipo' = 'ing' then i.generico_id else s.generico_id end,
               'generico', g.nombre, 'unidad_base', g.unidad_base) order by n)
        from jsonb_array_elements(v_r.componentes) with ordinality as e(c, n)
        left join public.recetario_ingredientes i on c ->> 'tipo' = 'ing' and i.fuente = v_r.fuente and i.codigo = c ->> 'codigo'
        left join public.recetario_recetas s on c ->> 'tipo' = 'sub' and s.fuente = v_r.fuente and s.codigo = c ->> 'codigo'
        left join public.genericos g on g.id = case when c ->> 'tipo' = 'ing' then i.generico_id else s.generico_id end), '[]'));
end
$$;

-- p: el mismo jsonb de public.guardar_ficha + {fuente, receta}. La ficha nace con origen RECETARIO COCINA.
create or replace function public.aprobar_receta(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_r   public.recetario_recetas%rowtype;
  v_res jsonb;
begin
  perform privado.exige_editar_fuente(p ->> 'fuente');
  select * into v_r from public.recetario_recetas where fuente = p ->> 'fuente' and codigo = p ->> 'receta' for update;
  if v_r.codigo is null then raise exception 'No existe esa receta en el recetario.'; end if;
  if v_r.estado = 'APROBADA' then raise exception 'La receta % ya se aprobó.', v_r.nombre; end if;
  if v_r.generico_id is null or v_r.generico_id::text <> p ->> 'generico_id' then
    raise exception 'La ficha debe ser del genérico elegido para %.', v_r.nombre;
  end if;
  v_res := public.guardar_ficha((p - 'fuente' - 'receta') || jsonb_build_object('origen', v_r.fuente,
             'motivo_cambio', coalesce(nullif(trim(p ->> 'motivo_cambio'), ''), 'Completada con ' || v_r.codigo || ' de ' || lower(v_r.fuente))));
  if coalesce((v_res ->> 'ok')::boolean, false) and v_res ->> 'id' is not null
     and exists (select 1 from public.fichas f where f.id = (v_res ->> 'id')::uuid and f.origen = v_r.fuente) then
    update public.recetario_recetas set estado = 'APROBADA', ficha_id = (v_res ->> 'id')::uuid, decidido_por = auth.uid(), decidido_en = now()
     where fuente = v_r.fuente and codigo = v_r.codigo;
    delete from public.mpi_revision where generico_id = v_r.generico_id;
  end if;
  return v_res;
end
$$;
