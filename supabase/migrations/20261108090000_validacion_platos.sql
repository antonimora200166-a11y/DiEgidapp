-- =====================================================================================
-- SGI Di Égida · Producción · 6 · Validación de los platos de la carta de cocina (Anthony, 07/11/2026)
-- Las recetas de plato ya están en el recetario de cocina (fuente RECETARIO COCINA, clase plato),
-- con sus componentes apuntando a las subrecetas (MPI) y a los ingredientes de esa misma fuente.
-- No se copian: CARTA COCINA es una fuente «de vista» que lee esas filas y valida genéricos PLATO.
--   RECETARIO COCINA  → COCINA · MPI    · subreceta
--   CARTA COCINA      → COCINA · PLATO  · plato      (filas de RECETARIO COCINA)
--   CARTA COCTELERÍA  → BAR    · BEBIDA · bebida
-- privado.fuente_tabla dice en qué filas vive cada fuente. Los platos se crean y enlazan en
-- supabase/datos/platos_cocina.sql. Al aprobar, la ficha nace con origen RECETARIO COCINA.
-- Decide el chef (o administración).
-- =====================================================================================

create or replace function privado.fuente_tabla(p text) returns text language sql immutable set search_path = ''
as $$ select case when p = 'CARTA COCINA' then 'RECETARIO COCINA' else p end $$;
create or replace function privado.fuente_area(p text) returns public.area_app language sql immutable set search_path = ''
as $$ select (case when p = 'CARTA COCTELERÍA' then 'BAR' else 'COCINA' end)::public.area_app $$;
create or replace function privado.fuente_tipo(p text) returns public.tipo_generico language sql immutable set search_path = ''
as $$ select (case p when 'CARTA COCTELERÍA' then 'BEBIDA' when 'CARTA COCINA' then 'PLATO' else 'MPI' end)::public.tipo_generico $$;
create or replace function privado.fuente_clase(p text) returns text language sql immutable set search_path = ''
as $$ select case p when 'CARTA COCTELERÍA' then 'bebida' when 'CARTA COCINA' then 'plato' else 'subreceta' end $$;
revoke execute on function privado.fuente_tabla(text) from public;

-- ---------------------------------------------------------------- tablero de avance
create or replace function public.validacion_recetario_resumen(p_fuente text default 'RECETARIO COCINA')
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_t text := privado.fuente_tabla(p_fuente);
begin
  perform privado.exige_ver_fuente(p_fuente);
  return jsonb_build_object(
    'puede_editar', privado.edita_ficha(privado.fuente_area(p_fuente)),
    'ingredientes', (select jsonb_build_object(
        'total', count(*), 'confirmados', count(*) filter (where estado = 'CONFIRMADO'),
        'nuevos', count(*) filter (where estado = 'NUEVO'), 'excluidos', count(*) filter (where estado = 'EXCLUIDO'),
        'pendientes', count(*) filter (where estado = 'PENDIENTE'),
        'exactos', count(*) filter (where estado = 'PENDIENTE' and similitud >= 0.99))
      from public.recetario_ingredientes where fuente = v_t),
    'mpi', (select jsonb_build_object(
        'total', count(*),
        'con_ficha', count(*) filter (where privado.ficha_vigente(g.id) is not null),
        'aprobadas', count(*) filter (where exists (select 1 from public.recetario_recetas r where r.fuente = v_t and r.generico_id = g.id and r.estado = 'APROBADA')),
        'receta_elegida', count(*) filter (where exists (select 1 from public.recetario_recetas r where r.fuente = v_t and r.generico_id = g.id and r.estado = 'PENDIENTE')),
        'sin_receta', count(*) filter (where mr.estado = 'SIN_RECETA'),
        'no_es_mpi', count(*) filter (where mr.estado = 'NO_ES_MPI'))
      from public.genericos g left join public.mpi_revision mr on mr.generico_id = g.id
     where g.area = privado.fuente_area(p_fuente) and g.activo and g.tipo = privado.fuente_tipo(p_fuente)),
    'recetas', (select jsonb_build_object(
        'subrecetas', count(*), 'aprobadas', count(*) filter (where estado = 'APROBADA'),
        'sin_mpi', count(*) filter (where generico_id is null and estado = 'PENDIENTE'))
      from public.recetario_recetas where fuente = v_t and clase = privado.fuente_clase(p_fuente)));
end
$$;

-- ---------------------------------------------------------------- 2. genérico ↔ receta
create or replace function public.validacion_mpi(p_fuente text default 'RECETARIO COCINA')
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_t text := privado.fuente_tabla(p_fuente);
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
                       from public.recetario_recetas r where r.fuente = v_t and r.generico_id = g.id),
          'candidatas', coalesce((
            select jsonb_agg(jsonb_build_object('codigo', c.codigo, 'nombre', c.nombre, 'similitud', c.sim, 'rendimiento', c.rendimiento, 'unidad', c.unidad)
                             order by c.sim desc)
              from (select r.codigo, r.nombre, r.rendimiento, r.unidad,
                           case when r.codigo = (select f.codigo from public.fichas f where f.id = privado.ficha_vigente(g.id)) then 1
                                else round(extensions.similarity(g.nombre_norm, privado.normalizar(r.nombre))::numeric, 2) end as sim
                      from public.recetario_recetas r
                     where r.fuente = v_t and r.clase = privado.fuente_clase(p_fuente) and r.estado = 'PENDIENTE' and r.generico_id is null
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
        from public.recetario_recetas r where r.fuente = v_t and r.clase = privado.fuente_clase(p_fuente)), '[]'));
end
$$;

-- elige (o quita, con p_generico null) el genérico de una receta
create or replace function public.elegir_receta_mpi(p_fuente text, p_codigo text, p_generico uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_t text := privado.fuente_tabla(p_fuente);
  v_r public.recetario_recetas%rowtype;
  v_g public.genericos%rowtype;
begin
  perform privado.exige_editar_fuente(p_fuente);
  select * into v_r from public.recetario_recetas where fuente = v_t and codigo = p_codigo for update;
  if v_r.codigo is null or v_r.clase <> privado.fuente_clase(p_fuente) then raise exception 'Esa receta no está en %.', p_fuente; end if;
  if v_r.estado = 'APROBADA' then raise exception 'La receta % ya es ficha: cámbiala desde su ficha.', v_r.nombre; end if;
  if p_generico is not null then
    select * into v_g from public.genericos where id = p_generico;
    if v_g.id is null or v_g.area <> privado.fuente_area(p_fuente) or v_g.tipo <> privado.fuente_tipo(p_fuente) or not v_g.activo then
      raise exception 'Elige % activo del área.', case privado.fuente_tipo(p_fuente) when 'BEBIDA' then 'una bebida' when 'PLATO' then 'un plato' else 'una MPI' end;
    end if;
    if exists (select 1 from public.recetario_recetas o where o.fuente = v_t and o.generico_id = p_generico and o.estado = 'APROBADA') then
      raise exception '% ya tiene su receta aprobada.', v_g.nombre;
    end if;
    update public.recetario_recetas set generico_id = null where fuente = v_t and generico_id = p_generico and codigo <> p_codigo;
    delete from public.mpi_revision where generico_id = p_generico;
  end if;
  update public.recetario_recetas set generico_id = p_generico, decidido_por = auth.uid(), decidido_en = now()
   where fuente = v_t and codigo = p_codigo;
  perform privado.bitacora(case when p_generico is null then 'RECETA SIN ' || privado.fuente_tipo(p_fuente) else 'RECETA ↔ ' || privado.fuente_tipo(p_fuente) end,
                           'recetario_recetas', p_codigo,
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
    update public.recetario_recetas set generico_id = null
     where fuente = privado.fuente_tabla(p_fuente) and generico_id = p_generico and estado = 'PENDIENTE';
    insert into public.mpi_revision (generico_id, estado, nota) values (p_generico, p_estado, privado.texto_o_null(p_nota, 300))
    on conflict (generico_id) do update set estado = excluded.estado, nota = excluded.nota, decidido_por = auth.uid(), decidido_en = now();
  else
    raise exception 'Marca no válida: %', p_estado;
  end if;
  return jsonb_build_object('ok', true);
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
  select * into v_r from public.recetario_recetas where fuente = privado.fuente_tabla(p_fuente) and codigo = p_codigo;
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

-- p: el mismo jsonb de public.guardar_ficha + {fuente, receta}. La ficha nace con el origen de las filas (RECETARIO COCINA, CARTA COCTELERÍA).
create or replace function public.aprobar_receta(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_r   public.recetario_recetas%rowtype;
  v_res jsonb;
begin
  perform privado.exige_editar_fuente(p ->> 'fuente');
  select * into v_r from public.recetario_recetas
   where fuente = privado.fuente_tabla(p ->> 'fuente') and codigo = p ->> 'receta' and clase = privado.fuente_clase(p ->> 'fuente') for update;
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
