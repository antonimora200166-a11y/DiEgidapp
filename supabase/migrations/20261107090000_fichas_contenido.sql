-- =====================================================================================
-- SGI Di Égida · Producción · 1 · Fichas técnicas completas (Anthony, 05/11/2026)
-- La ficha deja de ser solo una lista de ingredientes. Ahora guarda lo que necesita quien la
-- consulta o la prepara:
--   · procedimiento paso a paso, tiempo, método, porciones, descripción y presentación;
--   · puntos críticos (temperatura, tiempo, higiene, calidad) y alérgenos: son lo único que se
--     muestra en «Indicaciones importantes» antes de producir;
--   · empaque y vida útil POR forma de almacenamiento (el Súper limón dura 3 días refrigerado y
--     90 congelado);
--   · quién la escribió, desde dónde se cargó y qué cambió en cada versión.
-- Reglas acordadas:
--   · Cada cambio crea una versión nueva; ninguna versión se modifica después (los lotes
--     conservan la receta con que se hicieron). Guardar sin cambios no crea versión.
--   · Editan: chef (cocina), jefe de barra (bar) y administración. El sous chef ya no.
--   · Las fotos quedan para después (fotos oficiales, livianas): aquí no hay nada de fotos.
-- =====================================================================================

-- ---------------------------------------------------------------- vigencia
-- Una versión reemplazada el mismo día en que nació queda con vigente_hasta = vigente_desde − 1:
-- nunca fue la vigente de un día completo y así ningún filtro «vigente hoy» la cuenta dos veces.
do $$
declare v_c text;
begin
  select c.conname into v_c from pg_constraint c
   where c.conrelid = 'public.fichas'::regclass and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%vigente_hasta >= vigente_desde%';
  if v_c is not null then execute format('alter table public.fichas drop constraint %I', v_c); end if;
end
$$;
alter table public.fichas add constraint fichas_vigencia_check
  check (vigente_hasta is null or vigente_hasta >= vigente_desde - 1);

-- ---------------------------------------------------------------- contenido de la ficha
alter table public.fichas
  add column procedimiento  text[] not null default '{}',   -- un paso por elemento, en orden
  add column descripcion    text,                           -- qué es y cómo debe quedar
  add column presentacion   text,                           -- cómo se sirve o entrega (menaje, decoración)
  add column metodo         text,                           -- técnica: reducción, maceración, shake…
  add column tiempo_min     integer check (tiempo_min > 0), -- tiempo de preparación de una tanda
  add column porciones      numeric check (porciones > 0),  -- porciones o unidades que salen de una tanda
  add column empaque        text,
  add column alergenos      text[] not null default '{}',
  add column observaciones  text,
  add column origen         text not null default 'APP',    -- APP, SGI-COSTOS, RECETARIO COCINA, CARTA COCTELERÍA
  add column motivo_cambio  text,                           -- qué cambió respecto a la versión anterior
  add column creado_por     uuid default auth.uid();

comment on column public.fichas.procedimiento is 'Pasos en orden. Lo que se muestra al producir sale de aquí y de ficha_puntos_criticos.';
comment on column public.fichas.origen is 'De dónde salió esta versión: APP (escrita en la app) o el documento del que se cargó.';

-- las que ya estaban: las escritas en la app dejaron rastro en la bitácora; las demás vinieron de los Sheets
update public.fichas f set origen = case
  when exists (select 1 from public.bitacora b where b.entidad = 'fichas' and b.detalle ->> 'ficha_id' = f.id::text) then 'APP'
  else 'SGI-COSTOS' end;

create table public.ficha_puntos_criticos (
  id        uuid primary key default gen_random_uuid(),
  ficha_id  uuid not null references public.fichas (id),
  orden     integer not null check (orden > 0),
  tipo      text not null check (tipo in ('TEMPERATURA', 'TIEMPO', 'HIGIENE', 'CALIDAD', 'OTRO')),
  texto     text not null check (length(trim(texto)) between 3 and 400),
  unique (ficha_id, orden)
);
comment on table public.ficha_puntos_criticos is
  'Puntos críticos de una versión de ficha. Son lo único que la pantalla Producir muestra como «Indicaciones importantes».';

create table public.ficha_almacenamientos (
  ficha_id        uuid not null references public.fichas (id),
  conservacion    text not null check (conservacion in ('Ambiente', 'Refrigerado', 'Congelado')),
  vida_util_dias  integer not null check (vida_util_dias > 0),
  nota            text,                       -- «2-5 °C», «en bolsa de vacío», …
  primary key (ficha_id, conservacion)
);
comment on table public.ficha_almacenamientos is
  'Vida útil de lo producido según dónde se guarde. El lote vence = fecha de producción + la vida útil de la zona donde queda.';

-- Una versión guardada no cambia: ni su receta ni su contenido. Solo se le pone fin a su vigencia.
create or replace function privado.ficha_inmutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'vigente_hasta') = (to_jsonb(old) - 'vigente_hasta') then
    return new;
  end if;
  raise exception 'Una versión de ficha no se modifica: guarda los cambios como versión nueva.' using errcode = 'P0001';
end
$$;
create trigger fichas_inmutables before update on public.fichas
  for each row execute function privado.ficha_inmutable();
-- Una línea solo cambia de genérico cuando se unen dos genéricos duplicados (decidir_par,
-- unir_unidades_distintas): es el mismo ingrediente con otro código, no un cambio de receta.
create or replace function privado.ficha_linea_inmutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'generico_id') = (to_jsonb(old) - 'generico_id') then
    return new;
  end if;
  raise exception 'Una versión de ficha no se modifica: guarda los cambios como versión nueva.' using errcode = 'P0001';
end
$$;
create trigger ficha_lineas_inmutables before update or delete on public.ficha_lineas
  for each row execute function privado.ficha_linea_inmutable();
create trigger ficha_puntos_inmutables before update or delete on public.ficha_puntos_criticos
  for each row execute function privado.bloquear_cambios();
create trigger ficha_almacenamientos_inmutables before update or delete on public.ficha_almacenamientos
  for each row execute function privado.bloquear_cambios();

-- ---------------------------------------------------------------- quién edita fichas
create or replace function privado.edita_ficha(p_area public.area_app)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select privado.tiene_rol('admin')
      or (p_area = 'BAR' and privado.tiene_rol('jefe_bar'))
      or (p_area = 'COCINA' and privado.tiene_rol('chef'))
$$;
revoke execute on function privado.edita_ficha(public.area_app) from public;

drop policy if exists fichas_escribir on public.fichas;
drop policy if exists fichas_editar on public.fichas;
drop policy if exists ficha_lineas_escribir on public.ficha_lineas;
drop policy if exists ficha_lineas_editar on public.ficha_lineas;
drop policy if exists ficha_lineas_borrar on public.ficha_lineas;
create policy fichas_escribir on public.fichas for insert to authenticated
  with check (privado.edita_ficha((select g.area from public.genericos g where g.id = generico_id)));
create policy ficha_lineas_escribir on public.ficha_lineas for insert to authenticated
  with check (privado.edita_ficha((select g.area from public.fichas f join public.genericos g on g.id = f.generico_id where f.id = ficha_id)));

alter table public.ficha_puntos_criticos enable row level security;
alter table public.ficha_almacenamientos enable row level security;
create policy ficha_puntos_leer on public.ficha_puntos_criticos for select to authenticated using (true);
create policy ficha_almacenamientos_leer on public.ficha_almacenamientos for select to authenticated using (true);
revoke all on public.ficha_puntos_criticos, public.ficha_almacenamientos from anon;
revoke insert, update, delete, truncate on public.ficha_puntos_criticos, public.ficha_almacenamientos from authenticated;
create trigger ficha_puntos_auditar after insert on public.ficha_puntos_criticos for each row execute function privado.auditar();
create trigger ficha_almacenamientos_auditar after insert on public.ficha_almacenamientos for each row execute function privado.auditar();

-- ---------------------------------------------------------------- huella de una versión
-- Todo lo que el usuario escribe en una ficha, sin ids ni fechas: dos versiones con la misma
-- huella son la misma ficha (guardar sin cambios no crea versión).
create or replace function privado.huella_ficha(p_ficha uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'f', (select jsonb_build_object('codigo', f.codigo, 'neto', f.neto_esperado, 'nota', f.nota, 'proc', f.procedimiento,
                                    'desc', f.descripcion, 'pres', f.presentacion, 'met', f.metodo, 'tiempo', f.tiempo_min,
                                    'porc', f.porciones, 'emp', f.empaque, 'alerg', f.alergenos, 'obs', f.observaciones)
            from public.fichas f where f.id = p_ficha),
    'l', (select coalesce(jsonb_agg(jsonb_build_array(l.generico_id, l.cantidad, l.unidad, l.nota) order by l.linea), '[]')
            from public.ficha_lineas l where l.ficha_id = p_ficha),
    'p', (select coalesce(jsonb_agg(jsonb_build_array(p.tipo, p.texto) order by p.orden), '[]')
            from public.ficha_puntos_criticos p where p.ficha_id = p_ficha),
    'a', (select coalesce(jsonb_agg(jsonb_build_array(a.conservacion, a.vida_util_dias, a.nota) order by a.conservacion), '[]')
            from public.ficha_almacenamientos a where a.ficha_id = p_ficha))
$$;
revoke execute on function privado.huella_ficha(uuid) from public;

-- texto limpio o null
create or replace function privado.texto_o_null(p text, p_max integer default 4000)
returns text language sql immutable set search_path = ''
as $$ select left(nullif(trim(regexp_replace(p, '\s+', ' ', 'g')), ''), p_max) $$;

-- ---------------------------------------------------------------- guardar (v2: siempre versión nueva)
-- p: {generico_id, codigo, neto_esperado, nota, motivo_cambio,
--     descripcion, presentacion, metodo, tiempo_min, porciones, empaque, observaciones, origen?,
--     alergenos: [text], procedimiento: [text],
--     puntos: [{tipo, texto}], almacenamientos: [{conservacion, vida_util_dias, nota}],
--     lineas: [{generico_id, cantidad, unidad, nota, factor?}]}
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
  v_tiempo numeric;
  v_porc   numeric;
  v_motivo text := privado.texto_o_null(p ->> 'motivo_cambio', 300);
  v_origen text := coalesce(privado.texto_o_null(p ->> 'origen', 40), 'APP');
  v_l      jsonb; v_n int; v_ing record; v_cant numeric; v_unidad text; v_factor numeric;
  v_lotes  int := 0;
  v_pasos  text[] := '{}';
  v_alerg  text[] := '{}';
  v_t      text;
  v_cons   text[] := '{}';
  v_vida   numeric;
  f text[] := '{}'; a text[] := '{}';
  v_vistos uuid[] := '{}';
  v_version int;
begin
  select * into v_gen from public.genericos where id = privado.uuid_o_null(p ->> 'generico_id') for update;
  if v_gen.id is null or v_gen.tipo not in ('MPI', 'BEBIDA', 'PLATO') then
    raise exception 'Solo los MPI, cócteles y platos tienen ficha técnica.';
  end if;
  if not privado.edita_ficha(v_gen.area) then
    raise exception 'Solo % o administración editan las fichas de %.',
      case when v_gen.area = 'BAR' then 'el jefe de barra' else 'el chef' end, v_gen.area using errcode = '42501';
  end if;
  select * into v_vieja from public.fichas where id = privado.ficha_vigente(v_gen.id);
  if v_vieja.id is not null then
    select count(*) into v_lotes from public.lotes_produccion lp where lp.ficha_id = v_vieja.id;
  end if;

  -- encabezado
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
  v_tiempo := privado.num_o_null(p ->> 'tiempo_min');
  if nullif(trim(p ->> 'tiempo_min'), '') is not null and (v_tiempo is null or v_tiempo <= 0 or v_tiempo <> round(v_tiempo)) then
    f := f || 'El tiempo de preparación va en minutos enteros.'::text;
  end if;
  v_porc := privado.num_o_null(p ->> 'porciones');
  if nullif(trim(p ->> 'porciones'), '') is not null and (v_porc is null or v_porc <= 0) then
    f := f || 'Las porciones deben ser un número mayor que cero.'::text;
  end if;
  if v_vieja.id is not null and v_motivo is null then
    f := f || 'Escribe qué cambiaste: queda en la versión nueva para quien la revise.'::text;
  end if;

  -- procedimiento y alérgenos
  if jsonb_typeof(p -> 'procedimiento') = 'array' then
    for v_t in select privado.texto_o_null(e.value #>> '{}', 1500) from jsonb_array_elements(p -> 'procedimiento') e loop
      if v_t is not null then v_pasos := v_pasos || v_t; end if;
    end loop;
  end if;
  if jsonb_typeof(p -> 'alergenos') = 'array' then
    for v_t in select privado.texto_o_null(e.value #>> '{}', 40) from jsonb_array_elements(p -> 'alergenos') e loop
      if v_t is not null and not (v_t = any (v_alerg)) then v_alerg := v_alerg || v_t; end if;
    end loop;
  end if;

  -- puntos críticos
  for v_l, v_n in select e.value, e.ordinality from jsonb_array_elements(coalesce(p -> 'puntos', '[]')) with ordinality e loop
    if coalesce(v_l ->> 'tipo', '') not in ('TEMPERATURA', 'TIEMPO', 'HIGIENE', 'CALIDAD', 'OTRO') then
      f := f || ('Punto crítico ' || v_n || ': elige si es de temperatura, tiempo, higiene, calidad u otro.');
    elsif length(coalesce(privado.texto_o_null(v_l ->> 'texto'), '')) < 3 then
      f := f || ('Punto crítico ' || v_n || ': escribe qué hay que controlar.');
    elsif length(privado.texto_o_null(v_l ->> 'texto')) > 400 then
      f := f || ('Punto crítico ' || v_n || ': es muy largo; déjalo en una o dos frases.');
    end if;
  end loop;

  -- almacenamiento y vida útil
  for v_l, v_n in select e.value, e.ordinality from jsonb_array_elements(coalesce(p -> 'almacenamientos', '[]')) with ordinality e loop
    v_vida := privado.num_o_null(v_l ->> 'vida_util_dias');
    if coalesce(v_l ->> 'conservacion', '') not in ('Ambiente', 'Refrigerado', 'Congelado') then
      f := f || ('Almacenamiento ' || v_n || ': elige ambiente, refrigerado o congelado.');
    elsif v_l ->> 'conservacion' = any (v_cons) then
      f := f || ('«' || (v_l ->> 'conservacion') || '» está dos veces en el almacenamiento.');
    elsif v_vida is null or v_vida <= 0 or v_vida <> round(v_vida) then
      f := f || ('Vida útil en ' || lower(v_l ->> 'conservacion') || ': escribe los días (número entero).');
    end if;
    v_cons := v_cons || (v_l ->> 'conservacion');
  end loop;
  if v_gen.tipo = 'MPI' and cardinality(v_cons) = 0 then
    a := a || 'Sin vida útil: los lotes no tendrán fecha de vencimiento.'::text;
  end if;
  if v_gen.tipo = 'MPI' and jsonb_array_length(coalesce(p -> 'puntos', '[]')) = 0 then
    a := a || 'Ficha sin puntos críticos: al producir se avisará que faltan.'::text;
  end if;

  -- ingredientes
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

  -- conversiones nuevas que trajo la receta (valen aunque la receta no cambie)
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

  v_version := coalesce((select max(x.version) from public.fichas x where x.generico_id = v_gen.id), 0) + 1;
  begin
    -- la versión anterior deja de regir hoy (o nunca rigió un día completo, si nació hoy)
    if v_vieja.id is not null then
      update public.fichas set vigente_hasta = privado.hoy() - 1 where id = v_vieja.id;
    end if;
    insert into public.fichas (codigo, generico_id, version, neto_esperado, vigente_desde, nota, procedimiento, descripcion,
                               presentacion, metodo, tiempo_min, porciones, empaque, alergenos, observaciones, origen, motivo_cambio)
    values (v_codigo, v_gen.id, v_version, v_neto, privado.hoy(), privado.texto_o_null(p ->> 'nota', 2000), v_pasos,
            privado.texto_o_null(p ->> 'descripcion', 2000), privado.texto_o_null(p ->> 'presentacion', 1000),
            privado.texto_o_null(p ->> 'metodo', 120), v_tiempo::int, v_porc, privado.texto_o_null(p ->> 'empaque', 200),
            v_alerg, privado.texto_o_null(p ->> 'observaciones', 2000), v_origen, v_motivo)
    returning id into v_id;

    insert into public.ficha_lineas (ficha_id, linea, generico_id, cantidad, unidad, nota)
    select v_id, e.ordinality, (e.value ->> 'generico_id')::uuid, privado.num_o_null(e.value ->> 'cantidad'),
           lower(coalesce(nullif(trim(e.value ->> 'unidad'), ''), (select g.unidad_base::text from public.genericos g where g.id = (e.value ->> 'generico_id')::uuid))),
           privado.texto_o_null(e.value ->> 'nota', 200)
      from jsonb_array_elements(p -> 'lineas') with ordinality e;
    insert into public.ficha_puntos_criticos (ficha_id, orden, tipo, texto)
    select v_id, e.ordinality, e.value ->> 'tipo', privado.texto_o_null(e.value ->> 'texto')
      from jsonb_array_elements(coalesce(p -> 'puntos', '[]')) with ordinality e;
    insert into public.ficha_almacenamientos (ficha_id, conservacion, vida_util_dias, nota)
    select v_id, e.value ->> 'conservacion', privado.num_o_null(e.value ->> 'vida_util_dias')::int, privado.texto_o_null(e.value ->> 'nota', 120)
      from jsonb_array_elements(coalesce(p -> 'almacenamientos', '[]')) e;

    if v_vieja.id is not null and privado.huella_ficha(v_id) = privado.huella_ficha(v_vieja.id) then
      raise exception using errcode = 'SGI01', message = 'sin cambios';
    end if;
  exception when sqlstate 'SGI01' then
    -- se deshace la versión nueva: la vigente sigue igual
    return privado.resultado(true, v_vieja.id, v_vieja.codigo, '{}', '{}',
                             array['No había cambios en la ficha: sigue la versión ' || v_vieja.version || '.']);
  end;

  perform privado.bitacora(case when v_vieja.id is null then 'FICHA CREADA' else 'FICHA VERSIÓN NUEVA' end, 'fichas', v_codigo,
    jsonb_build_object('generico', v_gen.codigo, 'ficha_id', v_id, 'version', v_version, 'lineas', jsonb_array_length(p -> 'lineas'),
                       'version_anterior', v_vieja.version, 'origen', v_origen), v_motivo);
  if v_vieja.id is not null then
    a := a || ('Se guardó la versión ' || v_version || '.'
               || case when v_lotes > 0 then ' Los ' || v_lotes || ' lote(s) hechos con la versión ' || v_vieja.version || ' conservan su receta.' else '' end);
  end if;
  return privado.resultado(true, v_id, v_codigo, '{}', '{}', a);
end
$$;

-- ---------------------------------------------------------------- leer una ficha (vigente o una versión)
drop function public.ficha_para_editar(uuid);
create function public.ficha_para_editar(p_generico uuid, p_ficha uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_gen public.genericos%rowtype;
  v_vig uuid;
  v_fid uuid;
begin
  select * into v_gen from public.genericos where id = p_generico;
  if v_gen.id is null or v_gen.tipo not in ('MPI', 'BEBIDA', 'PLATO') then
    raise exception 'Solo los MPI, cócteles y platos tienen ficha técnica.';
  end if;
  if not privado.ve_costos() or not (privado.opera_en(v_gen.area) or privado.tiene_rol('admin', 'auditor')) then
    raise exception 'Sin permiso para ver las fichas de %.', v_gen.area using errcode = '42501';
  end if;
  v_vig := privado.ficha_vigente(v_gen.id);
  v_fid := coalesce(p_ficha, v_vig);
  if p_ficha is not null and not exists (select 1 from public.fichas f where f.id = p_ficha and f.generico_id = v_gen.id) then
    raise exception 'Esa versión no es de %.', v_gen.nombre;
  end if;

  return jsonb_build_object(
    'resultado', jsonb_build_object('id', v_gen.id, 'codigo', v_gen.codigo, 'nombre', v_gen.nombre, 'tipo', v_gen.tipo,
                                    'unidad_base', v_gen.unidad_base, 'area', v_gen.area),
    'puede_editar', privado.edita_ficha(v_gen.area),
    'es_vigente', v_fid is not distinct from v_vig,
    'ficha', (select jsonb_build_object('id', f.id, 'codigo', f.codigo, 'version', f.version, 'neto_esperado', f.neto_esperado,
                                        'nota', f.nota, 'vigente_desde', f.vigente_desde, 'vigente_hasta', f.vigente_hasta,
                                        'procedimiento', to_jsonb(f.procedimiento), 'descripcion', f.descripcion,
                                        'presentacion', f.presentacion, 'metodo', f.metodo, 'tiempo_min', f.tiempo_min,
                                        'porciones', f.porciones, 'empaque', f.empaque, 'alergenos', to_jsonb(f.alergenos),
                                        'observaciones', f.observaciones, 'origen', f.origen, 'motivo_cambio', f.motivo_cambio,
                                        'creado_en', f.creado_en,
                                        'creado_por', (select pe.nombre from public.perfiles pe where pe.id = f.creado_por),
                                        'lotes', (select count(*) from public.lotes_produccion lp where lp.ficha_id = f.id))
                from public.fichas f where f.id = v_fid),
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object('generico_id', g.id, 'generico', g.nombre, 'tipo', g.tipo, 'unidad_base', g.unidad_base,
                                          'cantidad', l.cantidad, 'unidad', l.unidad, 'nota', l.nota,
                                          'factor', privado.a_base(g.id, 1, l.unidad), 'cantidad_base', c.cantidad_base,
                                          'costo_unitario', c.costo_unitario, 'costo', c.costo, 'falta', c.falta,
                                          'estimado', c.costo_unitario is not null and privado.costo_es_estimado(g.id)) order by l.linea)
        from public.ficha_lineas l join public.genericos g on g.id = l.generico_id
        left join public.costo_ficha(v_fid) c on c.linea = l.linea
       where l.ficha_id = v_fid), '[]'),
    'puntos', coalesce((select jsonb_agg(jsonb_build_object('tipo', p.tipo, 'texto', p.texto) order by p.orden)
                          from public.ficha_puntos_criticos p where p.ficha_id = v_fid), '[]'),
    'almacenamientos', coalesce((select jsonb_agg(jsonb_build_object('conservacion', a.conservacion, 'vida_util_dias', a.vida_util_dias,
                                                                     'nota', a.nota)
                                                  order by array_position(array['Refrigerado', 'Congelado', 'Ambiente'], a.conservacion))
                                   from public.ficha_almacenamientos a where a.ficha_id = v_fid), '[]'),
    'versiones', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'version', f.version, 'vigente_desde', f.vigente_desde,
                                                               'vigente_hasta', f.vigente_hasta, 'origen', f.origen,
                                                               'motivo_cambio', f.motivo_cambio, 'creado_en', f.creado_en,
                                                               'creado_por', (select pe.nombre from public.perfiles pe where pe.id = f.creado_por),
                                                               'lotes', (select count(*) from public.lotes_produccion lp where lp.ficha_id = f.id))
                                            order by f.version desc)
                             from public.fichas f where f.generico_id = v_gen.id), '[]'),
    -- lo anotado antes de la app, para que quien edita lo pase a la ficha si sirve (no se copia solo)
    'sugerencias', jsonb_build_object(
      'generico', jsonb_build_object('conservacion', v_gen.conservacion, 'vida_util_dias', v_gen.vida_util_dias),
      'lotes', coalesce((select jsonb_agg(x order by x ->> 'fecha' desc) from (
                 select jsonb_build_object('codigo', h.codigo, 'fecha', h.fecha, 'conservacion', h.conservacion,
                                           'vida_util_dias', h.vida_util_dias, 'empaque', h.empaque, 'tecnica', h.tecnica,
                                           'tiempo_min', h.tiempo_min, 'observaciones', h.observaciones) as x
                   from public.lotes_historicos h where h.generico_id = v_gen.id and privado.ve_area('BAR')
                  order by h.fecha desc limit 6) s), '[]')),
    -- lo que puede ir en la receta: materia prima, desechables, MPI y lo sin costo del área
    'ingredientes', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'nombre', g.nombre, 'tipo', g.tipo, 'unidad_base', g.unidad_base,
                                          'unidades', (select coalesce(jsonb_agg(c.unidad order by c.unidad), '[]')
                                                         from public.conversiones c where c.generico_id = g.id))
                       order by g.nombre)
        from public.genericos g
       where g.area = v_gen.area and g.activo and g.tipo in ('MPe', 'MPI', 'SIN_COSTO')
         and g.clase in ('MATERIA_PRIMA', 'DESECHABLE') and g.id <> v_gen.id), '[]'));
end
$$;

-- ---------------------------------------------------------------- lista de Producción · Fichas
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
             count(*) filter (where c.falta is not null)::int as faltan,
             (array_agg(c.falta order by c.linea) filter (where c.falta is not null))[1] as primer_falta,
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

revoke execute on function public.ficha_para_editar(uuid, uuid), public.produccion_fichas(public.area_app),
                           privado.texto_o_null(text, integer) from public, anon;
grant execute on function public.ficha_para_editar(uuid, uuid), public.produccion_fichas(public.area_app) to authenticated;
grant execute on function public.guardar_ficha(jsonb) to authenticated;
