-- =====================================================================================
-- SGI Di Égida · 04 · Documentos de origen y sus RPC
-- Cada documento se guarda en una sola transacción: compuertas → documento → movimientos.
-- Compuertas (heredadas de FMT-REC-BAR-001 v1.1, FMT-REC-COC-003 v3.4.1 y SGI-COSTOS v1.1):
--   F = fatal, nunca guarda.  B = bloqueo, guarda solo con motivo ≥ MIN_MOTIVO_OVERRIDE.
--   Los avisos no impiden nada.  Toda respuesta es jsonb {ok, id, codigo, fatales, bloqueos, avisos}.
-- Nada se edita ni se borra: se anula con anular_documento, que reversa sus movimientos.
-- =====================================================================================

-- ---------------------------------------------------------------- utilidades
create or replace function privado.fecha_o_null(p text)
returns date language plpgsql immutable as $$
begin return p::date; exception when others then return null; end $$;

create or replace function privado.num_o_null(p text)
returns numeric language plpgsql immutable as $$
begin return nullif(trim(p), '')::numeric; exception when others then return null; end $$;

create or replace function privado.uuid_o_null(p text)
returns uuid language plpgsql immutable as $$
begin return nullif(trim(p), '')::uuid; exception when others then return null; end $$;

-- Roles que registran hechos operativos en un área.
create or replace function privado.puede_operar(p_area public.area_app)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select privado.opera_en(p_area)
     and privado.tiene_rol('admin', 'jefe_bar', 'aux_bar', 'chef', 'sous_chef', 'aux_cocina')
$$;

create or replace function privado.resultado(p_ok boolean, p_id uuid, p_codigo text,
                                             p_fatales text[], p_bloqueos text[], p_avisos text[])
returns jsonb language sql immutable as $$
  select jsonb_build_object('ok', p_ok, 'id', p_id, 'codigo', p_codigo,
                            'fatales', to_jsonb(coalesce(p_fatales, '{}')),
                            'bloqueos', to_jsonb(coalesce(p_bloqueos, '{}')),
                            'avisos', to_jsonb(coalesce(p_avisos, '{}')))
$$;

-- Aplica la regla F/B común. Devuelve null si se puede guardar; si no, el jsonb de rechazo.
create or replace function privado.rechazo(p_entidad text, p_fatales text[], p_bloqueos text[],
                                           p_avisos text[], p_motivo text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if cardinality(p_fatales) > 0 then
    perform privado.bitacora('GUARDADO RECHAZADO', p_entidad, null, to_jsonb(p_fatales));
    return privado.resultado(false, null, null, p_fatales, p_bloqueos, p_avisos);
  end if;
  if cardinality(p_bloqueos) > 0
     and length(coalesce(trim(p_motivo), '')) < privado.parametro_num('MIN_MOTIVO_OVERRIDE', 15) then
    perform privado.bitacora('GUARDADO BLOQUEADO', p_entidad, null, to_jsonb(p_bloqueos));
    return privado.resultado(false, null, null, p_fatales, p_bloqueos,
      p_avisos || ('Corrige, o escribe el motivo del forzado (mínimo '
                   || privado.parametro_num('MIN_MOTIVO_OVERRIDE', 15) || ' caracteres).'));
  end if;
  return null;
end
$$;

-- Validación de fecha común (F1 / F2 de los Sheets).
create or replace function privado.validar_fecha(p_fecha date, p_cruda text, inout p_fatales text[], inout p_avisos text[])
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_fecha is null then
    p_fatales := p_fatales || ('F1 · La fecha «' || coalesce(p_cruda, '') || '» no es una fecha válida.');
  elsif p_fecha > privado.hoy() then
    p_fatales := p_fatales || ('F2 · La fecha es futura (' || to_char(p_fecha, 'DD/MM/YYYY') || ').');
  elsif privado.hoy() - p_fecha > privado.parametro_num('DIAS_ATRAS_MAXIMO', 60) then
    p_avisos := p_avisos || ('Fecha de hace ' || (privado.hoy() - p_fecha) || ' días.');
  end if;
end
$$;

-- ---------------------------------------------------------------- anulaciones
create table public.anulaciones (
  id              uuid primary key default gen_random_uuid(),
  documento_tipo  text not null,
  documento_id    uuid not null,
  linea_id        uuid,                       -- null = documento completo
  motivo          text not null,
  usuario_id      uuid default auth.uid(),
  anulado_en      timestamptz not null default now()
);
create unique index anulaciones_unica on public.anulaciones
  (documento_tipo, documento_id, coalesce(linea_id, '00000000-0000-0000-0000-000000000000'));

-- ---------------------------------------------------------------- recepciones
create table public.recepciones (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null unique,
  area            public.area_app not null,
  ubicacion       text not null references public.ubicaciones (codigo),
  fecha           date not null,
  proveedor_id    uuid not null references public.proveedores (id),
  tipo_soporte    text not null check (tipo_soporte in ('FACTURA', 'REMISION', 'SIN_SOPORTE')),
  documento       text,
  documento_norm  text generated always as (nullif(privado.normalizar(documento), '')) stored,
  recibe_id       uuid not null references public.perfiles (id),
  observaciones   text,
  forzada         boolean not null default false,
  motivo_forzado  text,
  avisos          text[] not null default '{}',
  usuario_id      uuid default auth.uid(),
  registrado_en   timestamptz not null default now()
);
create index recepciones_documento_idx on public.recepciones (proveedor_id, documento_norm);

create table public.recepcion_lineas (
  id                  uuid primary key default gen_random_uuid(),
  recepcion_id        uuid not null references public.recepciones (id),
  linea               integer not null,
  producto_id         uuid not null references public.productos (id),
  cantidad_pedida     numeric,                                -- en unidad de compra
  cantidad_recibida   numeric not null check (cantidad_recibida >= 0),
  contenido_base      numeric not null check (contenido_base > 0),  -- foto del producto o pesado en la línea
  cantidad_base       numeric generated always as (cantidad_recibida * contenido_base) stored,
  valor_total         numeric check (valor_total >= 0),       -- valor de la línea en la factura
  costo_unitario_base numeric generated always as
                        (case when cantidad_recibida > 0 then valor_total / (cantidad_recibida * contenido_base) end) stored,
  condicion           text not null default 'OK' check (condicion in ('OK', 'DANADO', 'NO_LLEGO', 'INCOMPLETO')),
  sello               text check (sello in ('SI', 'NO', 'NA')),
  vencimiento         date,
  lote_proveedor      text,
  temperatura         numeric,
  observaciones       text,
  hallazgos           text[] not null default '{}',
  unique (recepcion_id, linea)
);

-- ---------------------------------------------------------------- producción
create table public.lotes_produccion (
  id               uuid primary key default gen_random_uuid(),
  codigo           text not null unique,
  area             public.area_app not null,
  ubicacion        text not null references public.ubicaciones (codigo),
  fecha            date not null,
  producto_id      uuid not null references public.productos (id),   -- el MPI que sale
  ficha_id         uuid references public.fichas (id),
  responsable_id   uuid not null references public.perfiles (id),
  tiempo_min       numeric check (tiempo_min >= 0),
  unidades         numeric check (unidades >= 0),
  entrada_base     numeric not null,
  neto_base        numeric not null check (neto_base > 0),
  rendimiento      numeric,
  rendimiento_ficha numeric,
  costo_total      numeric not null,
  costo_unitario   numeric,              -- costo_total / neto_base; null si PARCIAL
  estado_costo     text not null check (estado_costo in ('COMPLETO', 'PARCIAL')),
  observaciones    text,
  forzado          boolean not null default false,
  motivo_forzado   text,
  avisos           text[] not null default '{}',
  usuario_id       uuid default auth.uid(),
  registrado_en    timestamptz not null default now()
);

create table public.lote_consumos (
  id              uuid primary key default gen_random_uuid(),
  lote_id         uuid not null references public.lotes_produccion (id),
  linea           integer not null,
  producto_id     uuid not null references public.productos (id),
  cantidad        numeric not null check (cantidad > 0),
  unidad          text not null,
  cantidad_base   numeric not null check (cantidad_base > 0),
  costo_unitario  numeric,       -- promedio con que salió del kardex (null = sin costo)
  costo           numeric,
  movimiento_id   bigint references public.movimientos (id),   -- null para SIN_COSTO (agua)
  nota            text,
  unique (lote_id, linea)
);

-- ---------------------------------------------------------------- bajas
create table public.bajas (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,
  area           public.area_app not null,
  ubicacion      text not null references public.ubicaciones (codigo),
  fecha          date not null,
  causa          text not null check (causa in ('VENCIDO', 'DANADO', 'DERRAME', 'MAL_ESTADO', 'OTRO')),
  observaciones  text,
  forzada        boolean not null default false,
  motivo_forzado text,
  usuario_id     uuid default auth.uid(),
  registrado_en  timestamptz not null default now()
);

create table public.baja_lineas (
  id             uuid primary key default gen_random_uuid(),
  baja_id        uuid not null references public.bajas (id),
  linea          integer not null,
  producto_id    uuid not null references public.productos (id),
  cantidad       numeric not null check (cantidad > 0),
  unidad         text not null,
  cantidad_base  numeric not null check (cantidad_base > 0),
  movimiento_id  bigint not null references public.movimientos (id),
  unique (baja_id, linea)
);

-- ---------------------------------------------------------------- traslados
create table public.traslados (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,
  fecha          date not null,
  origen         text not null references public.ubicaciones (codigo),
  destino        text not null references public.ubicaciones (codigo),
  observaciones  text,
  forzado        boolean not null default false,
  motivo_forzado text,
  usuario_id     uuid default auth.uid(),
  registrado_en  timestamptz not null default now(),
  check (origen <> destino)
);

create table public.traslado_lineas (
  id              uuid primary key default gen_random_uuid(),
  traslado_id     uuid not null references public.traslados (id),
  linea           integer not null,
  producto_id     uuid not null references public.productos (id),
  cantidad_base   numeric not null check (cantidad_base > 0),
  mov_salida_id   bigint not null references public.movimientos (id),
  mov_entrada_id  bigint not null references public.movimientos (id),
  unique (traslado_id, linea)
);

-- ---------------------------------------------------------------- conteos físicos
create table public.conteos (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null unique,
  tipo            text not null default 'NORMAL' check (tipo in ('NORMAL', 'INICIAL')),
  ubicacion       text not null references public.ubicaciones (codigo),
  fecha           date not null,
  responsable_id  uuid not null references public.perfiles (id),
  observaciones   text,
  usuario_id      uuid default auth.uid(),
  registrado_en   timestamptz not null default now()
);

create table public.conteo_lineas (
  id               uuid primary key default gen_random_uuid(),
  conteo_id        uuid not null references public.conteos (id),
  linea            integer not null,
  producto_id      uuid not null references public.productos (id),
  peso_bruto_g     numeric check (peso_bruto_g > 0),   -- botella abierta pesada con su tara
  cantidad_contada numeric not null check (cantidad_contada >= 0),  -- unidad base
  saldo_teorico    numeric not null,                   -- lo que decía el kardex al contar
  diferencia       numeric generated always as (cantidad_contada - saldo_teorico) stored,
  movimiento_id    bigint references public.movimientos (id),   -- null si no hubo diferencia
  unique (conteo_id, linea)
);

-- ---------------------------------------------------------------- inmutabilidad
do $$
declare t text;
begin
  foreach t in array array['anulaciones', 'recepciones', 'recepcion_lineas', 'lotes_produccion', 'lote_consumos',
                           'bajas', 'baja_lineas', 'traslados', 'traslado_lineas', 'conteos', 'conteo_lineas']
  loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function privado.bloquear_cambios()',
                   t || '_inmutable', t);
  end loop;
end $$;

-- =====================================================================================
-- RPC · RECEPCIÓN
-- payload: {area, ubicacion, fecha, proveedor_id, tipo_soporte, documento, recibe_id,
--           observaciones, motivo_forzado,
--           lineas: [{producto_id, cantidad_pedida, cantidad_recibida, contenido_base?,
--                     valor_total, condicion, sello, vencimiento, lote_proveedor,
--                     temperatura, observaciones}]}
-- =====================================================================================
create or replace function public.registrar_recepcion(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_area      public.area_app;
  v_fecha     date := privado.fecha_o_null(p ->> 'fecha');
  v_ubic      text := p ->> 'ubicacion';
  v_prov      uuid := privado.uuid_o_null(p ->> 'proveedor_id');
  v_soporte   text := coalesce(nullif(p ->> 'tipo_soporte', ''), 'FACTURA');
  v_doc       text := nullif(trim(p ->> 'documento'), '');
  v_recibe    uuid := privado.uuid_o_null(p ->> 'recibe_id');
  v_motivo    text := nullif(trim(p ->> 'motivo_forzado'), '');
  f text[] := '{}'; b text[] := '{}'; a text[] := '{}';
  v_rechazo   jsonb;
  v_id        uuid := gen_random_uuid();
  v_codigo    text;
  v_prov_nom  text;
  r           record;
  v_lin       jsonb;
  v_n         integer;
  v_ref       text;
  v_prod      record;
  v_rec       numeric; v_ped numeric; v_valor numeric; v_cont numeric; v_base numeric;
  v_venc      date; v_cond text; v_sello text;
  v_cu        numeric;
  v_med       numeric; v_nmed integer; v_medcat numeric; v_ncat integer; v_x numeric; v_fac numeric;
  v_hall      text[];
  v_vistos    uuid[] := '{}';
  v_linea_id  uuid;
begin
  begin v_area := (p ->> 'area')::public.area_app;
  exception when others then raise exception 'Área no válida: %', p ->> 'area'; end;
  if not privado.puede_operar(v_area) then
    raise exception 'Sin permiso para registrar recepciones en %.', v_area using errcode = '42501';
  end if;

  -- F1 · encabezado
  select * into f, a from privado.validar_fecha(v_fecha, p ->> 'fecha', f, a);
  if v_prov is null or not exists (select 1 from public.proveedores pr where pr.id = v_prov and pr.activo) then
    f := f || 'F1 · Encabezado incompleto: falta el proveedor o no está activo en el catálogo.'::text;
  end if;
  if v_recibe is null or not exists (select 1 from public.perfiles pe where pe.id = v_recibe and pe.activo) then
    f := f || 'F1 · Encabezado incompleto: falta quién recibe.'::text;
  end if;
  if not exists (select 1 from public.ubicaciones u where u.codigo = v_ubic and u.area = v_area and u.activo) then
    f := f || ('F1 · La ubicación «' || coalesce(v_ubic, '') || '» no existe en ' || v_area || '.');
  end if;
  if v_soporte not in ('FACTURA', 'REMISION', 'SIN_SOPORTE') then
    f := f || ('F1 · Tipo de soporte no válido: ' || v_soporte);
  end if;

  -- F3 · al menos una línea
  if jsonb_typeof(p -> 'lineas') <> 'array' or jsonb_array_length(p -> 'lineas') = 0 then
    f := f || 'F3 · No hay ninguna línea de producto.'::text;
  end if;

  -- B1 · soporte documental · F4 · documento duplicado (solo recepciones no anuladas)
  if v_soporte = 'SIN_SOPORTE' or v_doc is null then
    b := b || 'B1 · Recepción sin N° de remisión o factura.'::text;
  elsif length(v_doc) < 4 then
    b := b || ('B1 · «' || v_doc || '» no es un N° de documento válido (mínimo 4 caracteres).');
  elsif v_prov is not null then
    perform pg_advisory_xact_lock(hashtextextended('recepcion:' || v_prov || ':' || privado.normalizar(v_doc), 0));
    select pr.nombre into v_prov_nom from public.proveedores pr where pr.id = v_prov;
    select re.codigo, re.fecha into r from public.recepciones re
     where re.proveedor_id = v_prov and re.documento_norm = privado.normalizar(v_doc)
       and not exists (select 1 from public.anulaciones an
                        where an.documento_tipo = 'RECEPCION' and an.documento_id = re.id and an.linea_id is null)
     limit 1;
    if found then
      f := f || ('F4 · El documento «' || v_doc || '» ya está registrado para ' || v_prov_nom || ' ('
                 || r.codigo || ', ' || to_char(r.fecha, 'DD/MM/YYYY') || '). Si es una corrección, anule la recepción.');
    end if;
  end if;

  -- por línea
  for v_lin, v_n in select e.value, e.ordinality from jsonb_array_elements(coalesce(p -> 'lineas', '[]')) with ordinality e
  loop
    select pr.id, pr.codigo, pr.activo, pr.contenido_base, pr.contenido_variable, pr.unidad_compra,
           g.nombre, g.area, g.activo as g_activo, g.tipo, g.unidad_base, c.exige_sello, c.es_perecedero, g.categoria
      into v_prod
      from public.productos pr join public.genericos g on g.id = pr.generico_id
      left join public.categorias c on c.codigo = g.categoria
     where pr.id = privado.uuid_o_null(v_lin ->> 'producto_id');
    v_ref := 'Línea ' || v_n || ' (' || coalesce(v_prod.nombre, 'producto desconocido') || ')';

    -- F5 · producto del catálogo, activo y del área
    if v_prod.id is null then
      f := f || ('F5 · ' || v_ref || ': el producto no existe en el catálogo. Créelo antes de recibirlo.'); continue;
    elsif not v_prod.activo or not v_prod.g_activo then
      f := f || ('F5 · ' || v_ref || ': el producto está dado de baja. Reactívelo si se volvió a comprar.'); continue;
    elsif v_prod.area <> v_area then
      f := f || ('F5 · ' || v_ref || ': el producto es de ' || v_prod.area || ', no de ' || v_area || '.'); continue;
    elsif v_prod.tipo not in ('MPe') then
      f := f || ('F5 · ' || v_ref || ': solo se reciben insumos comprados (MPe), no ' || v_prod.tipo || '.'); continue;
    end if;
    if v_prod.id = any (v_vistos) then a := a || (v_ref || ': producto repetido en esta misma recepción.'); end if;
    v_vistos := v_vistos || v_prod.id;

    v_rec   := privado.num_o_null(v_lin ->> 'cantidad_recibida');
    v_ped   := privado.num_o_null(v_lin ->> 'cantidad_pedida');
    v_valor := privado.num_o_null(v_lin ->> 'valor_total');
    v_cont  := coalesce(privado.num_o_null(v_lin ->> 'contenido_base'),
                        case when not v_prod.contenido_variable then v_prod.contenido_base end);
    v_cond  := coalesce(nullif(v_lin ->> 'condicion', ''), 'OK');
    v_sello := nullif(v_lin ->> 'sello', '');
    v_venc  := privado.fecha_o_null(v_lin ->> 'vencimiento');

    -- F6 · contenido por presentación (sin él no hay cantidad en unidad base)
    if v_cont is null or v_cont <= 0 then
      f := f || ('F6 · ' || v_ref || ': falta el contenido por presentación (peso o volumen real recibido por '
                 || v_prod.unidad_compra || ').');
    end if;
    if v_cond not in ('OK', 'DANADO', 'NO_LLEGO', 'INCOMPLETO') then
      f := f || ('F6 · ' || v_ref || ': condición no válida «' || v_cond || '».');
    end if;

    -- B3 · cantidad recibida
    if v_rec is null then b := b || ('B3 · ' || v_ref || ': cantidad recibida vacía o no numérica.');
    elsif v_rec < 0 then b := b || ('B3 · ' || v_ref || ': cantidad recibida negativa.');
    end if;

    -- B4 · coherencia cantidad / condición
    if v_rec = 0 and v_cond = 'OK' then
      b := b || ('B4 · ' || v_ref || ': recibido 0 pero marcado OK. Corrige la cantidad o la condición.');
    end if;
    if v_cond = 'NO_LLEGO' and v_rec > 0 then
      b := b || ('B4 · ' || v_ref || ': marcado «no llegó» pero con cantidad recibida ' || v_rec || '.');
    end if;
    if v_rec = 0 and v_valor > 0 and v_cond <> 'NO_LLEGO' then
      b := b || ('B4 · ' || v_ref || ': cantidad 0 con valor ' || v_valor || '.');
    end if;

    -- diferencia pedido / recibido (aviso; BLOQUEA_DIFERENCIA = SI la vuelve B5)
    if v_ped is not null and v_rec is not null and v_ped <> v_rec and coalesce(trim(v_lin ->> 'observaciones'), '') = '' then
      if privado.parametro('BLOQUEA_DIFERENCIA') = 'SI' then
        b := b || ('B5 · ' || v_ref || ': diferencia de ' || (v_rec - v_ped) || ' frente a lo pedido sin observación.');
      else
        a := a || (v_ref || ': diferencia de ' || (v_rec - v_ped) || ' frente a lo pedido sin observación.');
      end if;
    end if;

    -- B10 · cantidad implausible para la unidad de compra
    if v_rec > 0 and ((upper(v_prod.unidad_compra) in ('UND', 'BOT', 'CJA', 'SIX', 'PAQ', 'LATA') and v_rec > 500)
                      or (upper(v_prod.unidad_compra) in ('KG', 'L') and v_rec > 100)) then
      b := b || ('B10 · ' || v_ref || ': ' || v_rec || ' ' || v_prod.unidad_compra
                 || ' no es una cantidad plausible. ¿Estás digitando gramos o mililitros bajo otra unidad?');
    end if;

    -- B6 · valor · B7 · banda de precio por unidad base (capa 1 categoría, capa 2 producto)
    if v_rec > 0 and (v_valor is null or v_valor <= 0) then
      b := b || ('B6 · ' || v_ref || ': sin valor en la factura. Una línea sin precio no cuesta nada y ensucia el costeo.');
    elsif v_rec > 0 and v_cont > 0 and privado.parametro('BLOQUEA_BANDA') is distinct from 'NO' then
      v_cu := v_valor / (v_rec * v_cont);
      select percentile_cont(0.5) within group (order by rl.costo_unitario_base), count(*)
        into v_medcat, v_ncat
        from public.recepcion_lineas rl
        join public.productos pr2 on pr2.id = rl.producto_id
        join public.genericos g2 on g2.id = pr2.generico_id
       where g2.categoria is not distinct from v_prod.categoria and g2.unidad_base = v_prod.unidad_base
         and rl.costo_unitario_base > 0 and not ('H12' = any (rl.hallazgos)) and not ('H03' = any (rl.hallazgos))
         and not exists (select 1 from public.anulaciones an where an.documento_tipo = 'RECEPCION'
                          and an.documento_id = rl.recepcion_id and (an.linea_id is null or an.linea_id = rl.id));
      v_fac := privado.parametro_num('FACTOR_BANDA_PRECIO', 20)
               * case when v_ncat < 3 then privado.parametro_num('FACTOR_BANDA_HEREDADA', 3) else 1 end;
      select percentile_cont(0.5) within group (order by rl.costo_unitario_base), count(*)
        into v_med, v_nmed
        from public.recepcion_lineas rl
       where rl.producto_id = v_prod.id and rl.costo_unitario_base > 0
         and not ('H12' = any (rl.hallazgos)) and not ('H03' = any (rl.hallazgos))
         and not exists (select 1 from public.anulaciones an where an.documento_tipo = 'RECEPCION'
                          and an.documento_id = rl.recepcion_id and (an.linea_id is null or an.linea_id = rl.id));
      if v_medcat > 0 and (v_cu < v_medcat / v_fac or v_cu > v_medcat * v_fac) then
        b := b || ('B7 · ' || v_ref || ': $' || round(v_cu, 2) || ' por unidad base está fuera de la banda de '
                   || coalesce(v_prod.categoria, 'su categoría') || ' (' || round(v_medcat / v_fac, 2) || ' a '
                   || round(v_medcat * v_fac, 2) || '). Casi siempre es el precio del paquete puesto como unitario.');
      elsif v_med > 0 then
        v_x := v_cu / v_med;
        if v_x >= privado.parametro_num('DESVIO_ATIPICO_X', 3) or v_x <= 1 / privado.parametro_num('DESVIO_ATIPICO_X', 3) then
          b := b || ('B7 · ' || v_ref || ': precio ' || round(v_x, 1) || '× su mediana histórica ($' || round(v_med, 2) || ').');
        elsif abs(v_x - 1) * 100 > privado.parametro_num('DESVIO_BLOQUEO_PCT', 60) then
          b := b || ('B7 · ' || v_ref || ': precio se desvía ' || round(abs(v_x - 1) * 100) || ' % de su mediana ($' || round(v_med, 2) || ').');
        elsif abs(v_x - 1) * 100 > privado.parametro_num('DESVIO_AVISO_PCT', 15) then
          a := a || (v_ref || ': precio se desvía ' || round(abs(v_x - 1) * 100) || ' % de su mediana ($' || round(v_med, 2) || ').');
        end if;
      end if;
    end if;

    -- B8 · sello en licores y vinos
    if coalesce(v_prod.exige_sello, false) and v_rec > 0 and privado.parametro('BLOQUEA_SELLO') is distinct from 'NO' then
      if v_sello is null then b := b || ('B8 · ' || v_ref || ': licor o vino sin marcar el sello de seguridad.');
      elsif v_sello = 'NO' then b := b || ('B8 · ' || v_ref || ': sello ROTO. Deja constancia en observaciones antes de forzar.');
      end if;
    end if;

    -- B9 · vencimiento
    if v_venc is not null then
      if v_venc < privado.hoy() then
        b := b || ('B9 · ' || v_ref || ': producto VENCIDO desde hace ' || (privado.hoy() - v_venc) || ' días.');
      elsif v_venc - privado.hoy() <= privado.parametro_num('DIAS_VENCIMIENTO_AVISO', 15) then
        a := a || (v_ref || ': vence en ' || (v_venc - privado.hoy()) || ' días.');
      end if;
    elsif coalesce(v_prod.es_perecedero, false) and nullif(v_lin ->> 'vencimiento', '') is not null then
      a := a || (v_ref || ': el vencimiento «' || (v_lin ->> 'vencimiento') || '» no es una fecha válida.');
    end if;
  end loop;

  v_rechazo := privado.rechazo('recepciones', f, b, a, v_motivo);
  if v_rechazo is not null then return v_rechazo; end if;

  -- guardar
  v_codigo := privado.siguiente_codigo('REC-' || v_area || '-' || to_char(v_fecha, 'YYYYMMDD'));
  insert into public.recepciones (id, codigo, area, ubicacion, fecha, proveedor_id, tipo_soporte, documento,
                                  recibe_id, observaciones, forzada, motivo_forzado, avisos)
  values (v_id, v_codigo, v_area, v_ubic, v_fecha, v_prov, v_soporte, v_doc, v_recibe,
          nullif(trim(p ->> 'observaciones'), ''), cardinality(b) > 0,
          case when cardinality(b) > 0 then v_motivo end, a);

  for v_lin, v_n in select e.value, e.ordinality from jsonb_array_elements(p -> 'lineas') with ordinality e
  loop
    select pr.id, pr.contenido_base, pr.contenido_variable, c.exige_sello
      into v_prod
      from public.productos pr join public.genericos g on g.id = pr.generico_id
      left join public.categorias c on c.codigo = g.categoria
     where pr.id = (v_lin ->> 'producto_id')::uuid;
    v_rec   := privado.num_o_null(v_lin ->> 'cantidad_recibida');
    v_ped   := privado.num_o_null(v_lin ->> 'cantidad_pedida');
    v_valor := privado.num_o_null(v_lin ->> 'valor_total');
    v_cont  := coalesce(privado.num_o_null(v_lin ->> 'contenido_base'), v_prod.contenido_base);
    v_cond  := coalesce(nullif(v_lin ->> 'condicion', ''), 'OK');
    v_hall  := '{}';
    if v_rec > 0 and (v_valor is null or v_valor <= 0) then v_hall := v_hall || 'H03'::text; end if;
    if v_rec = 0 and v_cond = 'OK' then v_hall := v_hall || 'H06'::text; end if;
    if v_cond = 'NO_LLEGO' and v_rec > 0 then v_hall := v_hall || 'H07'::text; end if;
    if v_ped is not null and v_ped <> v_rec and coalesce(trim(v_lin ->> 'observaciones'), '') = '' then v_hall := v_hall || 'H08'::text; end if;
    if exists (select 1 from unnest(b) x where x like 'B10 · Línea ' || v_n || ' %') then v_hall := v_hall || 'H09'::text; end if;
    if coalesce(v_prod.exige_sello, false) and nullif(v_lin ->> 'sello', '') is null then v_hall := v_hall || 'H10'::text; end if;
    if exists (select 1 from unnest(b) x where x like 'B7 · Línea ' || v_n || ' %') then v_hall := v_hall || 'H12'::text; end if;

    insert into public.recepcion_lineas (recepcion_id, linea, producto_id, cantidad_pedida, cantidad_recibida,
                                         contenido_base, valor_total, condicion, sello, vencimiento,
                                         lote_proveedor, temperatura, observaciones, hallazgos)
    values (v_id, v_n, v_prod.id, v_ped, v_rec, v_cont, v_valor, v_cond, nullif(v_lin ->> 'sello', ''),
            privado.fecha_o_null(v_lin ->> 'vencimiento'), nullif(v_lin ->> 'lote_proveedor', ''),
            privado.num_o_null(v_lin ->> 'temperatura'), nullif(trim(v_lin ->> 'observaciones'), ''), v_hall)
    returning id, cantidad_base, costo_unitario_base into v_linea_id, v_base, v_cu;

    if v_base > 0 then
      perform privado.registrar_movimiento('ENTRADA_COMPRA', v_prod.id, v_ubic, v_base, v_fecha, v_cu,
                                           'RECEPCION', v_id, v_linea_id);
    end if;
  end loop;

  perform privado.bitacora('RECEPCIÓN GUARDADA', 'recepciones', v_codigo,
                           jsonb_build_object('lineas', jsonb_array_length(p -> 'lineas'), 'forzada', cardinality(b) > 0,
                                              'bloqueos', to_jsonb(b)),
                           case when cardinality(b) > 0 then v_motivo end);
  return privado.resultado(true, v_id, v_codigo, f, b, a);
end
$$;

-- =====================================================================================
-- RPC · LOTE DE PRODUCCIÓN
-- Costo del lote = Σ consumos al promedio vigente; costo unitario = costo / neto (CLAUDE.md).
-- payload: {area, ubicacion, fecha, producto_id (MPI), ficha_id?, responsable_id, tiempo_min,
--           unidades, neto, observaciones, motivo_forzado,
--           consumos: [{producto_id, cantidad, unidad?, nota}]}
-- =====================================================================================
create or replace function public.registrar_lote(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_area     public.area_app;
  v_fecha    date := privado.fecha_o_null(p ->> 'fecha');
  v_ubic     text := p ->> 'ubicacion';
  v_resp     uuid := privado.uuid_o_null(p ->> 'responsable_id');
  v_mpi      uuid := privado.uuid_o_null(p ->> 'producto_id');
  v_ficha    uuid := privado.uuid_o_null(p ->> 'ficha_id');
  v_neto     numeric := privado.num_o_null(p ->> 'neto');
  v_motivo   text := nullif(trim(p ->> 'motivo_forzado'), '');
  f text[] := '{}'; b text[] := '{}'; a text[] := '{}';
  v_rechazo  jsonb;
  v_id       uuid := gen_random_uuid();
  v_codigo   text;
  v_mpi_rec  record;
  v_c        jsonb;
  v_n        integer;
  v_ref      text;
  v_prod     record;
  v_cant     numeric; v_unidad text; v_base numeric;
  v_entrada  numeric := 0;
  v_saldo    numeric;
  v_lineas   jsonb := '[]';
  v_l        jsonb;
  v_mov      public.movimientos;
  v_total    numeric := 0;
  v_sin_costo integer := 0;
  v_rend     numeric; v_rend_ficha numeric; v_neto_ficha numeric; v_suma_ficha numeric;
  v_cu       numeric;
  v_estado   text;
begin
  begin v_area := (p ->> 'area')::public.area_app;
  exception when others then raise exception 'Área no válida: %', p ->> 'area'; end;
  if not privado.puede_operar(v_area) then
    raise exception 'Sin permiso para registrar producción en %.', v_area using errcode = '42501';
  end if;

  select * into f, a from privado.validar_fecha(v_fecha, p ->> 'fecha', f, a);
  if v_resp is null or not exists (select 1 from public.perfiles pe where pe.id = v_resp and pe.activo) then
    f := f || 'F2 · Falta el responsable.'::text;
  end if;
  if not exists (select 1 from public.ubicaciones u where u.codigo = v_ubic and u.area = v_area and u.activo) then
    f := f || ('F1 · La ubicación «' || coalesce(v_ubic, '') || '» no existe en ' || v_area || '.');
  end if;
  select pr.id, g.id as generico_id, g.nombre, g.tipo, g.unidad_base, pr.activo and g.activo as activo
    into v_mpi_rec
    from public.productos pr join public.genericos g on g.id = pr.generico_id where pr.id = v_mpi;
  if v_mpi_rec.id is null or v_mpi_rec.tipo <> 'MPI' or not v_mpi_rec.activo then
    f := f || 'F3 · El producto a producir no es un MPI activo del catálogo.'::text;
  end if;
  if v_ficha is not null and not exists (select 1 from public.fichas fi where fi.id = v_ficha and fi.generico_id = v_mpi_rec.generico_id) then
    f := f || 'F3 · La ficha no corresponde al MPI elegido.'::text;
  end if;
  if jsonb_typeof(p -> 'consumos') <> 'array' or jsonb_array_length(p -> 'consumos') = 0 then
    f := f || 'F4 · No hay ningún ingrediente con cantidad.'::text;
  end if;
  if v_neto is null or v_neto <= 0 then f := f || 'F7 · Falta el PESO NETO FINAL.'::text; end if;

  for v_c, v_n in select e.value, e.ordinality from jsonb_array_elements(coalesce(p -> 'consumos', '[]')) with ordinality e
  loop
    select pr.id, pr.activo and g.activo as activo, g.id as generico_id, g.nombre, g.tipo, g.unidad_base
      into v_prod
      from public.productos pr join public.genericos g on g.id = pr.generico_id
     where pr.id = privado.uuid_o_null(v_c ->> 'producto_id');
    v_ref := 'Línea ' || v_n || ' (' || coalesce(v_prod.nombre, 'insumo desconocido') || ')';
    if v_prod.id is null or not v_prod.activo then
      f := f || ('F5 · ' || v_ref || ': no está en el catálogo o está dado de baja.'); continue;
    end if;
    if v_prod.tipo in ('BEBIDA', 'PLATO') then
      f := f || ('F5 · ' || v_ref || ': una bebida o plato no es ingrediente de producción.'); continue;
    end if;
    if v_prod.id = v_mpi then f := f || ('F5 · ' || v_ref || ': un lote no se consume a sí mismo.'); continue; end if;
    v_cant := privado.num_o_null(v_c ->> 'cantidad');
    v_unidad := coalesce(nullif(lower(v_c ->> 'unidad'), ''), v_prod.unidad_base::text);
    if v_cant is null or v_cant <= 0 then f := f || ('F6 · ' || v_ref || ': cantidad no válida.'); continue; end if;
    v_base := privado.a_base(v_prod.generico_id, v_cant, v_unidad);
    if v_base is null then
      f := f || ('F8 · ' || v_ref || ': falta la conversión ' || v_unidad || '→' || v_prod.unidad_base
                 || '. Mídela y regístrala en conversiones.');
      continue;
    end if;
    if v_base > privado.parametro_num('MAX_CANTIDAD_LINEA', 50000) then
      b := b || ('B1 · ' || v_ref || ': ' || v_base || ' ' || v_prod.unidad_base || ' — ¿sobra un dígito?');
    end if;
    if v_prod.tipo <> 'SIN_COSTO' then
      select coalesce(sum(e.cantidad), 0) into v_saldo from public.existencias e
       where e.producto_id = v_prod.id and e.ubicacion = v_ubic;
      -- el mismo insumo puede venir en varias líneas
      v_saldo := v_saldo - coalesce((select sum((l ->> 'base')::numeric) from jsonb_array_elements(v_lineas) l
                                      where (l ->> 'producto_id')::uuid = v_prod.id), 0);
      if v_saldo < v_base then
        b := b || ('B3 · ' || v_ref || ': el kardex tiene ' || round(v_saldo, 2) || ' ' || v_prod.unidad_base
                   || ' en ' || v_ubic || ' y se usan ' || round(v_base, 2) || '. ¿Falta registrar una recepción o un traslado?');
      end if;
    end if;
    v_entrada := v_entrada + v_base;
    v_lineas := v_lineas || jsonb_build_object('n', v_n, 'producto_id', v_prod.id, 'tipo', v_prod.tipo,
                                               'cantidad', v_cant, 'unidad', v_unidad, 'base', v_base,
                                               'nota', v_c ->> 'nota');
  end loop;

  if v_neto > 0 and v_entrada > 0 and v_neto > v_entrada * 1.10 then
    b := b || ('B2 · El neto (' || v_neto || ') supera la entrada (' || round(v_entrada) || ') en más de 10 %.');
  end if;

  v_rechazo := privado.rechazo('lotes_produccion', f, b, a, v_motivo);
  if v_rechazo is not null then return v_rechazo; end if;

  -- salidas a producción al promedio vigente
  for v_l in select value from jsonb_array_elements(v_lineas)
  loop
    if v_l ->> 'tipo' = 'SIN_COSTO' then continue; end if;
    v_mov := privado.registrar_movimiento('SALIDA_A_PRODUCCION', (v_l ->> 'producto_id')::uuid, v_ubic,
                                          (v_l ->> 'base')::numeric, v_fecha, null, 'LOTE', v_id);
    if v_mov.costo_total is null then v_sin_costo := v_sin_costo + 1;
    else v_total := v_total - v_mov.costo_total; end if;
    v_lineas := (select jsonb_agg(case when (x ->> 'n')::int = (v_l ->> 'n')::int
                                       then x || jsonb_build_object('mov', v_mov.id, 'cu', v_mov.costo_unitario,
                                                                    'costo', -v_mov.costo_total)
                                       else x end order by (x ->> 'n')::int)
                   from jsonb_array_elements(v_lineas) x);
  end loop;

  v_estado := case when v_sin_costo > 0 then 'PARCIAL' else 'COMPLETO' end;
  v_cu := case when v_estado = 'COMPLETO' then round(v_total / v_neto, 6) end;
  if v_sin_costo > 0 then
    a := a || (v_sin_costo || ' insumo(s) sin costo en el kardex: el lote queda PARCIAL y entra al promedio vigente del MPI.');
  end if;

  -- rendimiento contra la ficha (solo avisa)
  v_rend := case when v_entrada > 0 then v_neto / v_entrada end;
  if v_ficha is not null then
    select fi.neto_esperado into v_neto_ficha from public.fichas fi where fi.id = v_ficha;
    select case when count(*) = count(c.cantidad_base) then sum(c.cantidad_base) end into v_suma_ficha
      from public.costo_ficha(v_ficha) c;
    v_rend_ficha := case when v_neto_ficha > 0 and v_suma_ficha > 0 then v_neto_ficha / v_suma_ficha end;
    if v_rend_ficha > 0 and abs(v_rend - v_rend_ficha) / v_rend_ficha * 100 > privado.parametro_num('DESVIO_REND_AVISO_PCT', 15) then
      a := a || ('Rendimiento ' || round(v_rend * 100, 1) || ' % vs ficha ' || round(v_rend_ficha * 100, 1) || ' %.');
    end if;
  end if;

  v_codigo := privado.siguiente_codigo('PRO-' || v_area || '-' || to_char(v_fecha, 'YYYY'));
  insert into public.lotes_produccion (id, codigo, area, ubicacion, fecha, producto_id, ficha_id, responsable_id,
                                       tiempo_min, unidades, entrada_base, neto_base, rendimiento, rendimiento_ficha,
                                       costo_total, costo_unitario, estado_costo, observaciones, forzado,
                                       motivo_forzado, avisos)
  values (v_id, v_codigo, v_area, v_ubic, v_fecha, v_mpi, v_ficha, v_resp,
          privado.num_o_null(p ->> 'tiempo_min'), privado.num_o_null(p ->> 'unidades'),
          v_entrada, v_neto, v_rend, v_rend_ficha, v_total, v_cu, v_estado,
          nullif(trim(p ->> 'observaciones'), ''), cardinality(b) > 0,
          case when cardinality(b) > 0 then v_motivo end, a);

  insert into public.lote_consumos (lote_id, linea, producto_id, cantidad, unidad, cantidad_base,
                                    costo_unitario, costo, movimiento_id, nota)
  select v_id, (x ->> 'n')::int, (x ->> 'producto_id')::uuid, (x ->> 'cantidad')::numeric, x ->> 'unidad',
         (x ->> 'base')::numeric,
         case when x ->> 'tipo' = 'SIN_COSTO' then 0 else (x ->> 'cu')::numeric end,
         case when x ->> 'tipo' = 'SIN_COSTO' then 0 else (x ->> 'costo')::numeric end,
         (x ->> 'mov')::bigint, nullif(x ->> 'nota', '')
    from jsonb_array_elements(v_lineas) x;

  perform privado.registrar_movimiento('ENTRADA_PRODUCCION', v_mpi, v_ubic, v_neto, v_fecha, v_cu, 'LOTE', v_id);

  perform privado.bitacora('LOTE GUARDADO', 'lotes_produccion', v_codigo,
                           jsonb_build_object('neto', v_neto, 'costo_total', v_total, 'costo_unitario', v_cu,
                                              'estado_costo', v_estado, 'bloqueos', to_jsonb(b)),
                           case when cardinality(b) > 0 then v_motivo end);
  return privado.resultado(true, v_id, v_codigo, f, b, a) || jsonb_build_object(
    'costo_total', v_total, 'costo_unitario', v_cu, 'estado_costo', v_estado, 'rendimiento', v_rend);
end
$$;

-- =====================================================================================
-- RPC · BAJA (vencido, dañado, derrame…)
-- payload: {area, ubicacion, fecha, causa, observaciones, motivo_forzado,
--           lineas: [{producto_id, cantidad, unidad?}]}
-- =====================================================================================
create or replace function public.registrar_baja(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_area   public.area_app;
  v_fecha  date := privado.fecha_o_null(p ->> 'fecha');
  v_ubic   text := p ->> 'ubicacion';
  v_causa  text := p ->> 'causa';
  v_motivo text := nullif(trim(p ->> 'motivo_forzado'), '');
  f text[] := '{}'; b text[] := '{}'; a text[] := '{}';
  v_rechazo jsonb;
  v_id     uuid := gen_random_uuid();
  v_codigo text;
  v_x      jsonb; v_n integer; v_prod record; v_cant numeric; v_unidad text; v_base numeric; v_saldo numeric;
  v_lineas jsonb := '[]';
  v_mov    public.movimientos;
begin
  begin v_area := (p ->> 'area')::public.area_app;
  exception when others then raise exception 'Área no válida: %', p ->> 'area'; end;
  if not privado.puede_operar(v_area) then
    raise exception 'Sin permiso para registrar bajas en %.', v_area using errcode = '42501';
  end if;
  select * into f, a from privado.validar_fecha(v_fecha, p ->> 'fecha', f, a);
  if not exists (select 1 from public.ubicaciones u where u.codigo = v_ubic and u.area = v_area and u.activo) then
    f := f || ('F1 · La ubicación «' || coalesce(v_ubic, '') || '» no existe en ' || v_area || '.');
  end if;
  if coalesce(v_causa, '') not in ('VENCIDO', 'DANADO', 'DERRAME', 'MAL_ESTADO', 'OTRO') then
    f := f || 'F1 · Falta la causa de la baja.'::text;
  elsif v_causa = 'OTRO' and coalesce(trim(p ->> 'observaciones'), '') = '' then
    f := f || 'F1 · Una baja por OTRO necesita observaciones.'::text;
  end if;
  if jsonb_typeof(p -> 'lineas') <> 'array' or jsonb_array_length(p -> 'lineas') = 0 then
    f := f || 'F3 · No hay ninguna línea.'::text;
  end if;
  for v_x, v_n in select e.value, e.ordinality from jsonb_array_elements(coalesce(p -> 'lineas', '[]')) with ordinality e
  loop
    select pr.id, g.id as generico_id, g.nombre, g.tipo, g.unidad_base into v_prod
      from public.productos pr join public.genericos g on g.id = pr.generico_id
     where pr.id = privado.uuid_o_null(v_x ->> 'producto_id');
    if v_prod.id is null or v_prod.tipo in ('SIN_COSTO', 'BEBIDA', 'PLATO') then
      f := f || ('F5 · Línea ' || v_n || ': producto inexistente o que no se inventaría.'); continue;
    end if;
    v_cant := privado.num_o_null(v_x ->> 'cantidad');
    v_unidad := coalesce(nullif(lower(v_x ->> 'unidad'), ''), v_prod.unidad_base::text);
    if v_cant is null or v_cant <= 0 then f := f || ('F6 · Línea ' || v_n || ' (' || v_prod.nombre || '): cantidad no válida.'); continue; end if;
    v_base := privado.a_base(v_prod.generico_id, v_cant, v_unidad);
    if v_base is null then f := f || ('F8 · Línea ' || v_n || ' (' || v_prod.nombre || '): falta la conversión ' || v_unidad || '→' || v_prod.unidad_base || '.'); continue; end if;
    select coalesce(sum(e.cantidad), 0) into v_saldo from public.existencias e where e.producto_id = v_prod.id and e.ubicacion = v_ubic;
    if v_saldo < v_base then
      b := b || ('B3 · Línea ' || v_n || ' (' || v_prod.nombre || '): el kardex tiene ' || round(v_saldo, 2) || ' ' || v_prod.unidad_base || ' y se dan de baja ' || round(v_base, 2) || '.');
    end if;
    v_lineas := v_lineas || jsonb_build_object('n', v_n, 'producto_id', v_prod.id, 'cantidad', v_cant, 'unidad', v_unidad, 'base', v_base);
  end loop;

  v_rechazo := privado.rechazo('bajas', f, b, a, v_motivo);
  if v_rechazo is not null then return v_rechazo; end if;

  v_codigo := privado.siguiente_codigo('BAJ-' || v_area || '-' || to_char(v_fecha, 'YYYYMMDD'));
  insert into public.bajas (id, codigo, area, ubicacion, fecha, causa, observaciones, forzada, motivo_forzado)
  values (v_id, v_codigo, v_area, v_ubic, v_fecha, v_causa, nullif(trim(p ->> 'observaciones'), ''),
          cardinality(b) > 0, case when cardinality(b) > 0 then v_motivo end);
  for v_x in select value from jsonb_array_elements(v_lineas)
  loop
    v_mov := privado.registrar_movimiento('SALIDA_BAJA', (v_x ->> 'producto_id')::uuid, v_ubic,
                                          (v_x ->> 'base')::numeric, v_fecha, null, 'BAJA', v_id);
    insert into public.baja_lineas (baja_id, linea, producto_id, cantidad, unidad, cantidad_base, movimiento_id)
    values (v_id, (v_x ->> 'n')::int, (v_x ->> 'producto_id')::uuid, (v_x ->> 'cantidad')::numeric,
            v_x ->> 'unidad', (v_x ->> 'base')::numeric, v_mov.id);
  end loop;
  perform privado.bitacora('BAJA GUARDADA', 'bajas', v_codigo, jsonb_build_object('causa', v_causa, 'bloqueos', to_jsonb(b)),
                           case when cardinality(b) > 0 then v_motivo end);
  return privado.resultado(true, v_id, v_codigo, f, b, a);
end
$$;

-- =====================================================================================
-- RPC · TRASLADO entre ubicaciones (bodega → barra, cocina → bar). No cambia el promedio.
-- payload: {fecha, origen, destino, observaciones, motivo_forzado, lineas: [{producto_id, cantidad, unidad?}]}
-- =====================================================================================
create or replace function public.registrar_traslado(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_fecha  date := privado.fecha_o_null(p ->> 'fecha');
  v_origen text := p ->> 'origen';
  v_dest   text := p ->> 'destino';
  v_a_ori  public.area_app; v_a_des public.area_app;
  v_motivo text := nullif(trim(p ->> 'motivo_forzado'), '');
  f text[] := '{}'; b text[] := '{}'; a text[] := '{}';
  v_rechazo jsonb;
  v_id uuid := gen_random_uuid(); v_codigo text;
  v_x jsonb; v_n integer; v_prod record; v_cant numeric; v_unidad text; v_base numeric; v_saldo numeric;
  v_lineas jsonb := '[]';
  v_sal public.movimientos; v_ent public.movimientos;
begin
  select u.area into v_a_ori from public.ubicaciones u where u.codigo = v_origen and u.activo;
  select u.area into v_a_des from public.ubicaciones u where u.codigo = v_dest and u.activo;
  if v_a_ori is null or v_a_des is null then raise exception 'Ubicación de origen o destino no válida.'; end if;
  if not (privado.puede_operar(v_a_ori) and privado.puede_operar(v_a_des)) then
    raise exception 'Sin permiso para trasladar entre % y %.', v_origen, v_dest using errcode = '42501';
  end if;
  select * into f, a from privado.validar_fecha(v_fecha, p ->> 'fecha', f, a);
  if v_origen = v_dest then f := f || 'F1 · Origen y destino son la misma ubicación.'::text; end if;
  if jsonb_typeof(p -> 'lineas') <> 'array' or jsonb_array_length(p -> 'lineas') = 0 then
    f := f || 'F3 · No hay ninguna línea.'::text;
  end if;
  for v_x, v_n in select e.value, e.ordinality from jsonb_array_elements(coalesce(p -> 'lineas', '[]')) with ordinality e
  loop
    select pr.id, g.id as generico_id, g.nombre, g.tipo, g.unidad_base into v_prod
      from public.productos pr join public.genericos g on g.id = pr.generico_id
     where pr.id = privado.uuid_o_null(v_x ->> 'producto_id');
    if v_prod.id is null or v_prod.tipo in ('SIN_COSTO', 'BEBIDA', 'PLATO') then
      f := f || ('F5 · Línea ' || v_n || ': producto inexistente o que no se inventaría.'); continue;
    end if;
    v_cant := privado.num_o_null(v_x ->> 'cantidad');
    v_unidad := coalesce(nullif(lower(v_x ->> 'unidad'), ''), v_prod.unidad_base::text);
    if v_cant is null or v_cant <= 0 then f := f || ('F6 · Línea ' || v_n || ': cantidad no válida.'); continue; end if;
    v_base := privado.a_base(v_prod.generico_id, v_cant, v_unidad);
    if v_base is null then f := f || ('F8 · Línea ' || v_n || ': falta la conversión ' || v_unidad || '→' || v_prod.unidad_base || '.'); continue; end if;
    select coalesce(sum(e.cantidad), 0) into v_saldo from public.existencias e where e.producto_id = v_prod.id and e.ubicacion = v_origen;
    if v_saldo < v_base then
      b := b || ('B3 · Línea ' || v_n || ' (' || v_prod.nombre || '): en ' || v_origen || ' hay ' || round(v_saldo, 2) || ' y se trasladan ' || round(v_base, 2) || '.');
    end if;
    v_lineas := v_lineas || jsonb_build_object('n', v_n, 'producto_id', v_prod.id, 'base', v_base);
  end loop;

  v_rechazo := privado.rechazo('traslados', f, b, a, v_motivo);
  if v_rechazo is not null then return v_rechazo; end if;

  v_codigo := privado.siguiente_codigo('TRA-' || to_char(v_fecha, 'YYYYMMDD'));
  insert into public.traslados (id, codigo, fecha, origen, destino, observaciones, forzado, motivo_forzado)
  values (v_id, v_codigo, v_fecha, v_origen, v_dest, nullif(trim(p ->> 'observaciones'), ''),
          cardinality(b) > 0, case when cardinality(b) > 0 then v_motivo end);
  for v_x in select value from jsonb_array_elements(v_lineas)
  loop
    v_sal := privado.registrar_movimiento('TRASLADO_SALIDA', (v_x ->> 'producto_id')::uuid, v_origen,
                                          (v_x ->> 'base')::numeric, v_fecha, null, 'TRASLADO', v_id);
    v_ent := privado.registrar_movimiento('TRASLADO_ENTRADA', (v_x ->> 'producto_id')::uuid, v_dest,
                                          (v_x ->> 'base')::numeric, v_fecha, null, 'TRASLADO', v_id);
    insert into public.traslado_lineas (traslado_id, linea, producto_id, cantidad_base, mov_salida_id, mov_entrada_id)
    values (v_id, (v_x ->> 'n')::int, (v_x ->> 'producto_id')::uuid, (v_x ->> 'base')::numeric, v_sal.id, v_ent.id);
  end loop;
  perform privado.bitacora('TRASLADO GUARDADO', 'traslados', v_codigo, jsonb_build_object('bloqueos', to_jsonb(b)),
                           case when cardinality(b) > 0 then v_motivo end);
  return privado.resultado(true, v_id, v_codigo, f, b, a);
end
$$;

-- =====================================================================================
-- RPC · CONTEO FÍSICO. La diferencia con el kardex se vuelve AJUSTE al promedio vigente.
-- Cantidad contada = cantidad (unidad base) + unidades_compra × contenido (botellas cerradas)
--                  + peso_bruto_g − tara (÷ densidad si el genérico va en ml: botella abierta).
-- CONTEO INICIAL (inicial = true): abre el kardex de productos que aún no tienen movimientos.
--   Cada línea contada entra como SALDO_INICIAL valorizada con costos_referencia.
--   Solo admin, jefe_bar (BAR) o chef (COCINA).
-- payload: {ubicacion, fecha, responsable_id, observaciones, inicial?,
--           lineas: [{producto_id, cantidad?, unidades_compra?, peso_bruto_g?}]}
-- =====================================================================================
create or replace function public.registrar_conteo(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_fecha  date := privado.fecha_o_null(p ->> 'fecha');
  v_ubic   text := p ->> 'ubicacion';
  v_area   public.area_app;
  v_resp   uuid := privado.uuid_o_null(p ->> 'responsable_id');
  f text[] := '{}'; b text[] := '{}'; a text[] := '{}';
  v_rechazo jsonb;
  v_id uuid := gen_random_uuid(); v_codigo text;
  v_x jsonb; v_n integer; v_prod record; v_cant numeric; v_peso numeric; v_tara record; v_saldo numeric;
  v_lineas jsonb := '[]';
  v_mov public.movimientos; v_dif numeric;
  v_ajustes integer := 0;
  v_inicial boolean := coalesce(p ->> 'inicial', 'false') = 'true';
  v_ref numeric; v_unid numeric; v_sin_ref integer := 0;
begin
  select u.area into v_area from public.ubicaciones u where u.codigo = v_ubic and u.activo;
  if v_area is null then raise exception 'Ubicación no válida: %', v_ubic; end if;
  if not privado.puede_operar(v_area) then
    raise exception 'Sin permiso para contar en %.', v_ubic using errcode = '42501';
  end if;
  if v_inicial and not (privado.tiene_rol('admin') or (v_area = 'BAR' and privado.tiene_rol('jefe_bar'))
                        or (v_area = 'COCINA' and privado.tiene_rol('chef'))) then
    raise exception 'El conteo inicial lo registra Administración o el jefe del área.' using errcode = '42501';
  end if;
  select * into f, a from privado.validar_fecha(v_fecha, p ->> 'fecha', f, a);
  if v_resp is null or not exists (select 1 from public.perfiles pe where pe.id = v_resp and pe.activo) then
    f := f || 'F1 · Falta el responsable del conteo.'::text;
  end if;
  if jsonb_typeof(p -> 'lineas') <> 'array' or jsonb_array_length(p -> 'lineas') = 0 then
    f := f || 'F3 · No hay ninguna línea contada.'::text;
  end if;
  for v_x, v_n in select e.value, e.ordinality from jsonb_array_elements(coalesce(p -> 'lineas', '[]')) with ordinality e
  loop
    select pr.id, g.nombre, g.tipo, g.unidad_base, pr.contenido_base, pr.contenido_variable into v_prod
      from public.productos pr join public.genericos g on g.id = pr.generico_id
     where pr.id = privado.uuid_o_null(v_x ->> 'producto_id');
    if v_prod.id is null or v_prod.tipo in ('SIN_COSTO', 'BEBIDA', 'PLATO') then
      f := f || ('F5 · Línea ' || v_n || ': producto inexistente o que no se inventaría.'); continue;
    end if;
    if exists (select 1 from jsonb_array_elements(v_lineas) l where (l ->> 'producto_id')::uuid = v_prod.id) then
      f := f || ('F5 · Línea ' || v_n || ' (' || v_prod.nombre || '): el producto ya está en este conteo. Súmalo en una sola línea.'); continue;
    end if;
    if v_inicial and exists (select 1 from public.movimientos m where m.producto_id = v_prod.id) then
      f := f || ('F9 · Línea ' || v_n || ' (' || v_prod.nombre || '): ya tiene kardex; su diferencia va en un conteo normal.'); continue;
    end if;
    v_peso := privado.num_o_null(v_x ->> 'peso_bruto_g');
    v_cant := privado.num_o_null(v_x ->> 'cantidad');
    v_unid := privado.num_o_null(v_x ->> 'unidades_compra');
    if v_unid is not null then
      if v_unid < 0 or v_prod.contenido_base is null then
        f := f || ('F6 · Línea ' || v_n || ' (' || v_prod.nombre || '): unidades no válidas o el producto no tiene contenido fijo; cuente en unidad base.'); continue;
      end if;
      v_cant := coalesce(v_cant, 0) + v_unid * v_prod.contenido_base;
    end if;
    if v_peso is not null then
      select t.tara_g, t.densidad_g_ml into v_tara from public.taras t where t.producto_id = v_prod.id;
      if v_tara.tara_g is null then
        f := f || ('F8 · Línea ' || v_n || ' (' || v_prod.nombre || '): no tiene tara registrada; no se puede convertir el peso.'); continue;
      end if;
      if v_prod.unidad_base = 'ml' and v_tara.densidad_g_ml is null then
        f := f || ('F8 · Línea ' || v_n || ' (' || v_prod.nombre || '): falta la densidad para pasar gramos a ml.'); continue;
      end if;
      if v_peso < v_tara.tara_g then
        f := f || ('F6 · Línea ' || v_n || ' (' || v_prod.nombre || '): pesa menos que la botella vacía (' || v_tara.tara_g || ' g).'); continue;
      end if;
      v_cant := coalesce(v_cant, 0) + case when v_prod.unidad_base = 'ml'
                                            then (v_peso - v_tara.tara_g) / v_tara.densidad_g_ml
                                            else v_peso - v_tara.tara_g end;
    end if;
    if v_cant is null or v_cant < 0 then
      f := f || ('F6 · Línea ' || v_n || ' (' || v_prod.nombre || '): cantidad contada no válida.'); continue;
    end if;
    select coalesce(sum(e.cantidad), 0) into v_saldo from public.existencias e where e.producto_id = v_prod.id and e.ubicacion = v_ubic;
    if v_saldo > 0 and abs(v_cant - v_saldo) / v_saldo > 0.2 then
      a := a || ('Línea ' || v_n || ' (' || v_prod.nombre || '): el conteo difiere más de 20 % del kardex ('
                 || round(v_saldo, 2) || ' → ' || round(v_cant, 2) || ').');
    end if;
    v_lineas := v_lineas || jsonb_build_object('n', v_n, 'producto_id', v_prod.id, 'peso', v_peso,
                                               'contada', round(v_cant, 4), 'saldo', v_saldo);
  end loop;

  v_rechazo := privado.rechazo('conteos', f, b, a, null);
  if v_rechazo is not null then return v_rechazo; end if;

  v_codigo := privado.siguiente_codigo(case when v_inicial then 'INI-' else 'CON-' end || v_ubic || '-' || to_char(v_fecha, 'YYYYMMDD'));
  insert into public.conteos (id, codigo, tipo, ubicacion, fecha, responsable_id, observaciones)
  values (v_id, v_codigo, case when v_inicial then 'INICIAL' else 'NORMAL' end, v_ubic, v_fecha, v_resp,
          nullif(trim(p ->> 'observaciones'), ''));
  for v_x in select value from jsonb_array_elements(v_lineas)
  loop
    v_dif := (v_x ->> 'contada')::numeric - (v_x ->> 'saldo')::numeric;
    v_mov := null;
    if v_inicial then
      if (v_x ->> 'contada')::numeric > 0 then
        select cr.costo_unitario_base into v_ref from public.costos_referencia cr where cr.producto_id = (v_x ->> 'producto_id')::uuid;
        if v_ref is null then v_sin_ref := v_sin_ref + 1; end if;
        v_mov := privado.registrar_movimiento('SALDO_INICIAL', (v_x ->> 'producto_id')::uuid, v_ubic,
                                              (v_x ->> 'contada')::numeric, v_fecha, v_ref, 'CONTEO', v_id);
        v_ajustes := v_ajustes + 1;
      end if;
    elsif v_dif <> 0 then
      v_mov := privado.registrar_movimiento(
        case when v_dif > 0 then 'AJUSTE_CONTEO_POSITIVO' else 'AJUSTE_CONTEO_NEGATIVO' end::public.tipo_movimiento,
        (v_x ->> 'producto_id')::uuid, v_ubic, abs(v_dif), v_fecha, null, 'CONTEO', v_id);
      v_ajustes := v_ajustes + 1;
    end if;
    insert into public.conteo_lineas (conteo_id, linea, producto_id, peso_bruto_g, cantidad_contada, saldo_teorico, movimiento_id)
    values (v_id, (v_x ->> 'n')::int, (v_x ->> 'producto_id')::uuid, (v_x ->> 'peso')::numeric,
            (v_x ->> 'contada')::numeric, (v_x ->> 'saldo')::numeric, v_mov.id);
  end loop;
  if v_sin_ref > 0 then
    a := a || (v_sin_ref || ' producto(s) entraron sin costo de referencia: su primera compra fijará el promedio.');
  end if;
  perform privado.bitacora(case when v_inicial then 'CONTEO INICIAL GUARDADO' else 'CONTEO GUARDADO' end,
                           'conteos', v_codigo, jsonb_build_object('movimientos', v_ajustes, 'sin_costo', v_sin_ref));
  return privado.resultado(true, v_id, v_codigo, f, b, a) || jsonb_build_object('ajustes', v_ajustes, 'sin_costo', v_sin_ref);
end
$$;

-- =====================================================================================
-- RPC · ANULAR un documento (o una línea de recepción): reversa sus movimientos vigentes.
-- Solo admin, jefe_bar (BAR) o chef (COCINA). El documento original queda intacto.
-- =====================================================================================
create or replace function public.anular_documento(p_tipo text, p_id uuid, p_motivo text, p_linea_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_area   public.area_app;
  v_codigo text;
  v_mov    record;
  v_n      integer := 0;
  v_avisos text[] := '{}';
  v_saldo  numeric;
begin
  p_tipo := upper(p_tipo);
  case p_tipo
    when 'RECEPCION' then select r.area, r.codigo into v_area, v_codigo from public.recepciones r where r.id = p_id;
    when 'LOTE'      then select l.area, l.codigo into v_area, v_codigo from public.lotes_produccion l where l.id = p_id;
    when 'BAJA'      then select x.area, x.codigo into v_area, v_codigo from public.bajas x where x.id = p_id;
    when 'TRASLADO'  then select u.area, t.codigo into v_area, v_codigo from public.traslados t join public.ubicaciones u on u.codigo = t.origen where t.id = p_id;
    when 'CONTEO'    then select u.area, c.codigo into v_area, v_codigo from public.conteos c join public.ubicaciones u on u.codigo = c.ubicacion where c.id = p_id;
    else raise exception 'Tipo de documento no válido: %', p_tipo;
  end case;
  if v_codigo is null then raise exception 'No existe el documento % %.', p_tipo, p_id; end if;
  if not (privado.tiene_rol('admin') or (v_area = 'BAR' and privado.tiene_rol('jefe_bar'))
          or (v_area = 'COCINA' and privado.tiene_rol('chef'))) then
    raise exception 'Solo Administración o el jefe del área pueden anular.' using errcode = '42501';
  end if;
  if length(coalesce(trim(p_motivo), '')) < privado.parametro_num('MIN_MOTIVO_OVERRIDE', 15) then
    return privado.resultado(false, p_id, v_codigo,
      array['F1 · El motivo de la anulación debe tener al menos ' || privado.parametro_num('MIN_MOTIVO_OVERRIDE', 15) || ' caracteres.'], '{}', '{}');
  end if;
  if p_linea_id is not null and p_tipo <> 'RECEPCION' then
    raise exception 'Solo las recepciones se anulan por línea.';
  end if;
  if exists (select 1 from public.anulaciones an where an.documento_tipo = p_tipo and an.documento_id = p_id and an.linea_id is null)
     or (p_linea_id is not null and exists (select 1 from public.anulaciones an where an.documento_tipo = p_tipo
                                             and an.documento_id = p_id and an.linea_id = p_linea_id)) then
    return privado.resultado(false, p_id, v_codigo, array['F2 · Ya estaba anulado.'], '{}', '{}');
  end if;

  insert into public.anulaciones (documento_tipo, documento_id, linea_id, motivo) values (p_tipo, p_id, p_linea_id, trim(p_motivo));

  for v_mov in
    select m.id, m.producto_id, m.ubicacion, m.cantidad from public.movimientos m
     where m.documento_tipo = p_tipo and m.documento_id = p_id and m.tipo <> 'REVERSA'
       and (p_linea_id is null or m.linea_id = p_linea_id)
       and not exists (select 1 from public.movimientos r where r.reversa_de = m.id)
     order by m.id desc
  loop
    perform privado.registrar_movimiento('REVERSA', null, null, null, privado.hoy(), null, null, null, null, v_mov.id, trim(p_motivo));
    v_n := v_n + 1;
    select e.cantidad into v_saldo from public.existencias e where e.producto_id = v_mov.producto_id and e.ubicacion = v_mov.ubicacion;
    if v_saldo < 0 then
      v_avisos := v_avisos || ('El saldo de un producto en ' || v_mov.ubicacion || ' quedó negativo (' || round(v_saldo, 2)
                               || '): ya se había consumido. Revise el siguiente conteo.');
    end if;
  end loop;

  perform privado.bitacora('ANULACIÓN', p_tipo, v_codigo, jsonb_build_object('linea_id', p_linea_id, 'reversas', v_n), trim(p_motivo));
  return privado.resultado(true, p_id, v_codigo, '{}', '{}', v_avisos) || jsonb_build_object('reversas', v_n);
end
$$;

-- ---------------------------------------------------------------- RLS de documentos
do $$
declare t text;
begin
  foreach t in array array['anulaciones', 'recepciones', 'recepcion_lineas', 'lotes_produccion', 'lote_consumos',
                           'bajas', 'baja_lineas', 'traslados', 'traslado_lineas', 'conteos', 'conteo_lineas']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (privado.ve_costos())', t || '_leer', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- permisos de funciones
-- Solo las RPC públicas y los ayudantes que usan las políticas quedan al alcance de authenticated.
revoke execute on all functions in schema privado from public;
revoke execute on function public.registrar_recepcion(jsonb), public.registrar_lote(jsonb), public.registrar_baja(jsonb),
                           public.registrar_traslado(jsonb), public.registrar_conteo(jsonb),
                           public.anular_documento(text, uuid, text, uuid), public.costo_ficha(uuid) from public, anon;
grant execute on function public.registrar_recepcion(jsonb), public.registrar_lote(jsonb), public.registrar_baja(jsonb),
                          public.registrar_traslado(jsonb), public.registrar_conteo(jsonb),
                          public.anular_documento(text, uuid, text, uuid), public.costo_ficha(uuid) to authenticated;
grant execute on function privado.rol_actual(), privado.tiene_rol(public.rol_app[]), privado.opera_en(public.area_app),
                          privado.ve_costos(), privado.usuario_activo(), privado.edita_area(public.area_app),
                          privado.edita_generico(uuid), privado.normalizar(text), privado.parametro(text),
                          privado.parametro_num(text, numeric) to authenticated;
