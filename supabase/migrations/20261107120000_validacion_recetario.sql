-- =====================================================================================
-- SGI Di Égida · Producción · 2 · Validar las MPI de cocina con el recetario (Anthony, 05/11/2026)
-- Las 194 MPI de cocina no tienen ficha. El recetario de la cocina (egida-datos-recetas.json)
-- trae 104 subrecetas y 279 ingredientes con códigos propios. Se cargan TAL CUAL en tablas de
-- trabajo (supabase/datos/recetario_cocina.sql) con una propuesta de ficha armada solo con lo
-- escrito, y el chef las valida en la app en tres pasos:
--   1. Ingredientes: cada código del recetario se empareja una vez con su genérico del catálogo
--      (la app propone el más parecido; el chef confirma, cambia, lo marca nuevo o lo excluye).
--   2. MPI: a cada MPI se le elige su receta, o se marca «sin receta» o «no es una MPI»
--      (propuesta para inactivar). Las recetas sin MPI pueden crear su MPI (provisional).
--   3. Aprobar: la propuesta abre en el editor de fichas; al guardar nace la ficha v1 con origen
--      RECETARIO COCINA. Nada del recetario se vuelve ficha sin ese paso.
-- Ver y decidir: chef y administración (privado.edita_ficha). Ver: quien ve cocina.
-- =====================================================================================

create table public.recetario_ingredientes (
  fuente        text not null,
  codigo        text not null,                 -- INS001, OTR024… del recetario
  nombre        text not null,
  categoria     text,
  presentacion  text,
  unidad        text,                          -- g, ml, und: unidad de las cantidades en las recetas
  contenido     numeric,
  precio        numeric,
  area          text,
  propuesto_id  uuid references public.genericos (id),   -- lo que propone la app por parecido
  similitud     numeric,
  generico_id   uuid references public.genericos (id),   -- lo que confirmó el chef
  estado        text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'CONFIRMADO', 'NUEVO', 'EXCLUIDO')),
  decidido_por  uuid,
  decidido_en   timestamptz,
  primary key (fuente, codigo),
  check ((estado = 'CONFIRMADO') = (generico_id is not null))
);

create table public.recetario_recetas (
  fuente        text not null,
  codigo        text not null,                 -- PR001, P001…
  clase         text not null,                 -- subreceta (MPI) o plato
  nombre        text not null,
  descripcion   text,
  rendimiento   numeric,
  unidad        text,                          -- g, ml, und, porciones
  alergenos     text[] not null default '{}',
  procedimiento text,
  componentes   jsonb not null default '[]',   -- [{tipo: ing|sub, codigo, cantidad, unidad}]
  propuesta     jsonb not null default '{}',   -- {pasos, puntos, observaciones, metodo, alergenos_*, suma_entrada_g}
  propuesto_id  uuid references public.genericos (id),
  similitud     numeric,
  generico_id   uuid references public.genericos (id),   -- la MPI que el chef dijo que es
  estado        text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'APROBADA', 'DESCARTADA')),
  ficha_id      uuid references public.fichas (id),
  decidido_por  uuid,
  decidido_en   timestamptz,
  primary key (fuente, codigo),
  check ((estado = 'APROBADA') = (ficha_id is not null))
);
create unique index recetario_recetas_una_por_mpi on public.recetario_recetas (fuente, generico_id) where generico_id is not null;

-- MPI que el chef revisó y no tienen receta en el recetario, o que no son MPI (propuesta para inactivar)
create table public.mpi_revision (
  generico_id   uuid primary key references public.genericos (id),
  estado        text not null check (estado in ('SIN_RECETA', 'NO_ES_MPI')),
  nota          text,
  decidido_por  uuid default auth.uid(),
  decidido_en   timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['recetario_ingredientes', 'recetario_recetas', 'mpi_revision'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (privado.ve_area(''COCINA''))', t || '_leer', t);
  end loop;
  -- las tablas del recetario se recargan del archivo: las decisiones quedan en la bitácora desde cada función
  create trigger mpi_revision_auditar after insert or update or delete on public.mpi_revision for each row execute function privado.auditar();
end
$$;

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
          where g.area = 'COCINA' and g.activo and g.tipo in ('MPe', 'MPI', 'SIN_COSTO')
            and g.clase in ('MATERIA_PRIMA', 'DESECHABLE')
          order by 2 desc, g.nombre limit 1) x where x.sim >= 0.3)
   where t.fuente = p_fuente and t.estado = 'PENDIENTE';

  update public.recetario_recetas t
     set (propuesto_id, similitud) = (
       select x.id, x.sim from (
         select g.id, round(extensions.similarity(g.nombre_norm, privado.normalizar(t.nombre))::numeric, 2) as sim
           from public.genericos g
          where g.area = 'COCINA' and g.activo and g.tipo = 'MPI'
            and not exists (select 1 from public.recetario_recetas o where o.fuente = t.fuente and o.generico_id = g.id)
          order by 2 desc, g.nombre limit 1) x where x.sim >= 0.3)
   where t.fuente = p_fuente and t.clase = 'subreceta' and t.estado = 'PENDIENTE' and t.generico_id is null;
end
$$;
revoke execute on function privado.recetario_proponer(text) from public;

create or replace function privado.exige_editar_cocina()
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.edita_ficha('COCINA') then
    raise exception 'Solo el chef o administración validan las fichas de cocina.' using errcode = '42501';
  end if;
end
$$;
revoke execute on function privado.exige_editar_cocina() from public;

create or replace function privado.exige_ver_cocina()
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.ve_area('COCINA') then
    raise exception 'Sin permiso para ver las fichas de cocina.' using errcode = '42501';
  end if;
end
$$;
revoke execute on function privado.exige_ver_cocina() from public;

-- ---------------------------------------------------------------- tablero de avance
create or replace function public.validacion_recetario_resumen(p_fuente text default 'RECETARIO COCINA')
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform privado.exige_ver_cocina();
  return jsonb_build_object(
    'puede_editar', privado.edita_ficha('COCINA'),
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
     where g.area = 'COCINA' and g.activo and g.tipo = 'MPI'),
    'recetas', (select jsonb_build_object(
        'subrecetas', count(*), 'aprobadas', count(*) filter (where estado = 'APROBADA'),
        'sin_mpi', count(*) filter (where generico_id is null and estado = 'PENDIENTE'))
      from public.recetario_recetas where fuente = p_fuente and clase = 'subreceta'));
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
  perform privado.exige_ver_cocina();
  return query
  select t.codigo, t.nombre, t.categoria, t.presentacion, t.unidad, t.area, t.estado,
         t.propuesto_id, gp.nombre, gp.tipo::text, gp.unidad_base::text, t.similitud,
         t.generico_id, gc.nombre, gc.unidad_base::text,
         (select count(*)::int from public.recetario_recetas r, jsonb_array_elements(r.componentes) c
           where r.fuente = t.fuente and c ->> 'tipo' = 'ing' and c ->> 'codigo' = t.codigo),
         (select count(*)::int from public.recetario_recetas r, jsonb_array_elements(r.componentes) c
           where r.fuente = t.fuente and r.clase = 'subreceta' and c ->> 'tipo' = 'ing' and c ->> 'codigo' = t.codigo)
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
  perform privado.exige_editar_cocina();
  if p_decision not in ('CONFIRMAR', 'NUEVO', 'EXCLUIR', 'PENDIENTE') then raise exception 'Decisión no válida: %', p_decision; end if;
  if p_generico is not null then
    select * into v_gen from public.genericos where id = p_generico;
    if v_gen.id is null or v_gen.area <> 'COCINA' or not v_gen.activo or v_gen.tipo not in ('MPe', 'MPI', 'SIN_COSTO') then
      raise exception 'Elige un insumo, MPI o sin costo activo de cocina.';
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
  perform privado.exige_ver_cocina();
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
                           round(extensions.similarity(g.nombre_norm, privado.normalizar(r.nombre))::numeric, 2) as sim
                      from public.recetario_recetas r
                     where r.fuente = p_fuente and r.clase = 'subreceta' and r.estado = 'PENDIENTE' and r.generico_id is null
                     order by 5 desc limit 3) c where c.sim >= 0.2), '[]')) as x
          from public.genericos g left join public.mpi_revision mr on mr.generico_id = g.id
         where g.area = 'COCINA' and g.activo and g.tipo = 'MPI') s), '[]'),
    'recetas', coalesce((
      select jsonb_agg(jsonb_build_object('codigo', r.codigo, 'nombre', r.nombre, 'rendimiento', r.rendimiento, 'unidad', r.unidad,
                                          'estado', r.estado, 'generico_id', r.generico_id,
                                          'mpi', (select g.nombre from public.genericos g where g.id = r.generico_id),
                                          'propuesto_id', r.propuesto_id, 'similitud', r.similitud,
                                          'propuesto', (select g.nombre from public.genericos g where g.id = r.propuesto_id),
                                          'componentes', jsonb_array_length(r.componentes),
                                          'pasos', jsonb_array_length(coalesce(r.propuesta -> 'pasos', '[]'))) order by r.nombre)
        from public.recetario_recetas r where r.fuente = p_fuente and r.clase = 'subreceta'), '[]'));
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
  perform privado.exige_editar_cocina();
  select * into v_r from public.recetario_recetas where fuente = p_fuente and codigo = p_codigo for update;
  if v_r.codigo is null or v_r.clase <> 'subreceta' then raise exception 'Esa receta no es una subreceta del recetario.'; end if;
  if v_r.estado = 'APROBADA' then raise exception 'La receta % ya es ficha: cámbiala desde la ficha de su MPI.', v_r.nombre; end if;
  if p_generico is not null then
    select * into v_g from public.genericos where id = p_generico;
    if v_g.id is null or v_g.area <> 'COCINA' or v_g.tipo <> 'MPI' or not v_g.activo then
      raise exception 'Elige una MPI activa de cocina.';
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
  perform privado.exige_editar_cocina();
  if not exists (select 1 from public.genericos g where g.id = p_generico and g.area = 'COCINA' and g.tipo = 'MPI') then
    raise exception 'Esa no es una MPI de cocina.';
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
  perform privado.exige_editar_cocina();
  select * into v_r from public.recetario_recetas where fuente = p_fuente and codigo = p_codigo for update;
  if v_r.codigo is null or v_r.clase <> 'subreceta' then raise exception 'Esa receta no es una subreceta del recetario.'; end if;
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
  perform privado.exige_ver_cocina();
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
               'nombre', coalesce(i.nombre, s.nombre),
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
  perform privado.exige_editar_cocina();
  select * into v_r from public.recetario_recetas where fuente = p ->> 'fuente' and codigo = p ->> 'receta' for update;
  if v_r.codigo is null then raise exception 'No existe esa receta en el recetario.'; end if;
  if v_r.estado = 'APROBADA' then raise exception 'La receta % ya se aprobó.', v_r.nombre; end if;
  if v_r.generico_id is null or v_r.generico_id::text <> p ->> 'generico_id' then
    raise exception 'La ficha debe ser de la MPI elegida para la receta %.', v_r.nombre;
  end if;
  v_res := public.guardar_ficha((p - 'fuente' - 'receta') || jsonb_build_object('origen', v_r.fuente,
             'motivo_cambio', coalesce(nullif(trim(p ->> 'motivo_cambio'), ''), 'Validada con la receta ' || v_r.codigo || ' del recetario de cocina')));
  if coalesce((v_res ->> 'ok')::boolean, false) and v_res ->> 'id' is not null
     and exists (select 1 from public.fichas f where f.id = (v_res ->> 'id')::uuid and f.origen = v_r.fuente) then
    update public.recetario_recetas set estado = 'APROBADA', ficha_id = (v_res ->> 'id')::uuid, decidido_por = auth.uid(), decidido_en = now()
     where fuente = v_r.fuente and codigo = v_r.codigo;
    delete from public.mpi_revision where generico_id = v_r.generico_id;
  end if;
  return v_res;
end
$$;

-- ---------------------------------------------------------------- Producción · Fichas: «Incompleta» es la receta
-- (cantidades, conversiones, neto). Un insumo sin precio deja el costo en «—», no la ficha incompleta:
-- en cocina casi nada tiene precio todavía.
create or replace function public.produccion_fichas(p_area public.area_app)
returns table (generico_id uuid, generico_codigo text, nombre text, unidad_base public.unidad_base,
               ficha_id uuid, ficha_codigo text, version integer, vigente_desde date, origen text,
               neto_esperado numeric, entrada_esperada numeric, rendimiento numeric,
               costo_tanda numeric, costo_unidad numeric, costo_completo boolean, estimado boolean,
               faltan integer, primer_falta text, lineas integer, pasos integer, puntos integer, alergenos text[],
               almacenamientos jsonb, lotes integer, estado text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.ve_area(p_area) then
    raise exception 'Sin permiso para ver las fichas de %.', p_area using errcode = '42501';
  end if;
  return query
  select g.id, g.codigo, g.nombre, g.unidad_base, f.id, f.codigo, f.version, f.vigente_desde, f.origen,
         f.neto_esperado, x.entrada,
         case when f.neto_esperado > 0 and x.entrada > 0 then round(f.neto_esperado / x.entrada, 6) end,
         x.total,
         case when x.completa and f.neto_esperado > 0 then round(x.total / f.neto_esperado, 6) end,
         coalesce(x.completa, false), coalesce(x.estimado, false),
         coalesce(x.faltan, 0), x.primer_falta, coalesce(x.lineas, 0),
         coalesce(cardinality(f.procedimiento), 0),
         (select count(*)::int from public.ficha_puntos_criticos pc where pc.ficha_id = f.id),
         coalesce(f.alergenos, '{}'),
         coalesce((select jsonb_agg(jsonb_build_object('conservacion', a.conservacion, 'vida_util_dias', a.vida_util_dias)
                                    order by array_position(array['Refrigerado', 'Congelado', 'Ambiente'], a.conservacion))
                     from public.ficha_almacenamientos a where a.ficha_id = f.id), '[]'),
         (select count(*)::int from public.lotes_produccion lp where lp.ficha_id = f.id),
         case when f.id is null then 'SIN_FICHA'
              when coalesce(x.lineas, 0) = 0 or x.faltan > 0 or f.neto_esperado is null then 'INCOMPLETA'
              else 'VIGENTE' end
    from public.genericos g
    left join public.fichas f on f.id = privado.ficha_vigente(g.id)
    left join lateral (
      select count(*)::int as lineas,
             count(*) filter (where c.falta like 'La ficha no trae cantidad%' or c.falta like 'Falta la conversión%')::int as faltan,
             coalesce((array_agg(c.falta order by c.linea) filter (where c.falta like 'La ficha no trae cantidad%' or c.falta like 'Falta la conversión%'))[1],
                      (array_agg(c.falta order by c.linea) filter (where c.falta is not null))[1]) as primer_falta,
             coalesce(sum(c.costo), 0) as total,
             bool_and(c.falta is null) as completa,
             case when bool_and(c.cantidad_base is not null) then sum(c.cantidad_base) end as entrada,
             bool_or(c.costo_unitario is not null and privado.costo_es_estimado(c.generico_id)) as estimado
        from public.costo_ficha(f.id) c
    ) x on f.id is not null
   where g.area = p_area and g.activo and g.tipo = 'MPI'
   order by g.nombre;
end
$$;


revoke execute on function public.validacion_recetario_resumen(text), public.recetario_ingredientes_lista(text),
  public.decidir_ingredientes_recetario(text, text[], text, uuid), public.validacion_mpi(text),
  public.elegir_receta_mpi(text, text, uuid), public.marcar_mpi(uuid, text, text, text),
  public.crear_mpi_desde_receta(text, text, text), public.propuesta_receta(text, text), public.aprobar_receta(jsonb) from public, anon;
grant execute on function public.validacion_recetario_resumen(text), public.recetario_ingredientes_lista(text),
  public.decidir_ingredientes_recetario(text, text[], text, uuid), public.validacion_mpi(text),
  public.elegir_receta_mpi(text, text, uuid), public.marcar_mpi(uuid, text, text, text),
  public.crear_mpi_desde_receta(text, text, text), public.propuesta_receta(text, text), public.aprobar_receta(jsonb) to authenticated;
