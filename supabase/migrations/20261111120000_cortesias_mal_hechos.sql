-- =====================================================================================
-- SGI Di Égida · Cortesías y mal hechos (11/11/2026)
-- Se registran como «2 Negroni»: la app descarga del kardex los ingredientes de la ficha vigente
-- (una baja con causa CORTESIA o MAL_HECHO y sus líneas) y guarda quién lo autorizó, quién es el
-- responsable y el costo de materia prima que ese responsable debe responder (Anthony, 06/11).
-- · El costo es el del kardex al promedio (si un ingrediente no tiene promedio, el estimado de la
--   ficha, y queda marcado como estimado).
-- · El cobro lo maneja administración: PENDIENTE → DESCONTADO (de nómina) o CONDONADO, con nota.
-- · Como son bajas, entran solas a las pérdidas del período por su causa (cierre y Consulta).
-- · Los pesos solo los ve administración; los demás ven unidades y personas.
-- =====================================================================================

alter table public.bajas drop constraint if exists bajas_causa_check;
alter table public.bajas add constraint bajas_causa_check
  check (causa in ('VENCIDO', 'DANADO', 'DERRAME', 'MAL_ESTADO', 'OTRO', 'CORTESIA', 'MAL_HECHO'));

create table if not exists public.bajas_carta (
  baja_id         uuid primary key references public.bajas (id),
  tipo            text not null check (tipo in ('CORTESIA', 'MAL_HECHO')),
  generico_id     uuid not null references public.genericos (id),   -- el producto de la carta
  ficha_id        uuid not null references public.fichas (id),
  ficha_version   integer not null,
  unidades        numeric not null check (unidades > 0),
  autorizado_por  uuid references public.perfiles (id),
  responsable_id  uuid references public.perfiles (id),
  a_cargo         boolean not null default false,                   -- el responsable responde por el costo
  costo_mp        numeric,                                          -- materia prima descargada
  costo_estimado  boolean not null default false,
  estado_cobro    text not null default 'NO_APLICA' check (estado_cobro in ('NO_APLICA', 'PENDIENTE', 'DESCONTADO', 'CONDONADO')),
  cobro_nota      text,
  cobro_por       uuid references public.perfiles (id),
  cobro_en        timestamptz,
  check (not a_cargo or responsable_id is not null),
  check (tipo <> 'CORTESIA' or autorizado_por is not null),
  check (tipo <> 'MAL_HECHO' or responsable_id is not null)
);
create index if not exists bajas_carta_responsable_idx on public.bajas_carta (responsable_id) where a_cargo;

-- solo cambia el cobro, y solo por la función; nada se borra
create or replace function privado.bajas_carta_solo_cobro()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Las cortesías y mal hechos no se borran: se anulan con su baja.'; end if;
  if (new.baja_id, new.tipo, new.generico_id, new.ficha_id, new.ficha_version, new.unidades, new.autorizado_por, new.responsable_id,
      new.a_cargo, new.costo_mp, new.costo_estimado)
     is distinct from
     (old.baja_id, old.tipo, old.generico_id, old.ficha_id, old.ficha_version, old.unidades, old.autorizado_por, old.responsable_id,
      old.a_cargo, old.costo_mp, old.costo_estimado) then
    raise exception 'Una cortesía o mal hecho guardado no se edita; solo se registra su cobro.';
  end if;
  return new;
end $$;
create trigger bajas_carta_inmutables before update or delete on public.bajas_carta
  for each row execute function privado.bajas_carta_solo_cobro();

alter table public.bajas_carta enable row level security;
create policy bajas_carta_leer on public.bajas_carta for select to authenticated using (privado.ve_precios());
revoke insert, update, delete on public.bajas_carta from authenticated, anon;

-- ---------------------------------------------------------------- personas para escoger
-- quien registra necesita escoger quién autorizó y quién es el responsable (también meseros)
create or replace function public.personas_bajas_carta()
returns table (id uuid, nombre text, rol public.rol_app, autoriza boolean)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.nombre, p.rol, p.rol in ('admin', 'jefe_bar', 'chef', 'sous_chef')
    from public.perfiles p
   where p.activo and p.rol <> 'auditor'
     and (privado.puede_operar('BAR') or privado.puede_operar('COCINA'))
   order by p.nombre
$$;

-- ---------------------------------------------------------------- registrar
-- p: {area, ubicacion, fecha, tipo, generico_id, unidades, autorizado_por, responsable_id, a_cargo,
--     observaciones, motivo_forzado}
create or replace function public.registrar_baja_carta(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_area   public.area_app;
  v_fecha  date := privado.fecha_o_null(p ->> 'fecha');
  v_ubic   text := p ->> 'ubicacion';
  v_tipo   text := upper(coalesce(p ->> 'tipo', ''));
  v_und    numeric := privado.num_o_null(p ->> 'unidades');
  v_aut    uuid := privado.uuid_o_null(p ->> 'autorizado_por');
  v_resp   uuid := privado.uuid_o_null(p ->> 'responsable_id');
  v_cargo  boolean;
  v_motivo text := nullif(trim(p ->> 'motivo_forzado'), '');
  f text[] := '{}'; b text[] := '{}'; a text[] := '{}';
  v_rechazo jsonb;
  v_g record; v_ficha record; v_l record; v_prod uuid; v_saldo numeric; v_base numeric;
  v_lineas jsonb := '[]'; v_x jsonb; v_n integer := 0;
  v_id uuid := gen_random_uuid(); v_codigo text; v_mov public.movimientos;
  v_costo numeric := 0; v_estimado boolean := false;
begin
  begin v_area := (p ->> 'area')::public.area_app;
  exception when others then raise exception 'Área no válida: %', p ->> 'area'; end;
  if not privado.puede_operar(v_area) then
    raise exception 'Sin permiso para registrar cortesías o mal hechos en %.', v_area using errcode = '42501';
  end if;
  select * into f, a from privado.validar_fecha(v_fecha, p ->> 'fecha', f, a);
  if not exists (select 1 from public.ubicaciones u where u.codigo = v_ubic and u.area = v_area and u.activo) then
    f := f || ('F1 · La ubicación «' || coalesce(v_ubic, '') || '» no existe en ' || v_area || '.');
  end if;
  if v_tipo not in ('CORTESIA', 'MAL_HECHO') then f := f || 'F1 · Escoge si es cortesía o mal hecho.'::text; end if;
  if v_und is null or v_und <= 0 or v_und > 100 then f := f || 'F6 · Las unidades no son válidas.'::text; end if;

  -- personas
  if v_aut is not null and not exists (select 1 from public.perfiles x where x.id = v_aut and x.activo and x.rol in ('admin', 'jefe_bar', 'chef', 'sous_chef')) then
    f := f || 'F1 · Quien autoriza tiene que ser administración o jefe de área.'::text;
  end if;
  if v_resp is not null and not exists (select 1 from public.perfiles x where x.id = v_resp and x.activo) then
    f := f || 'F1 · El responsable no existe.'::text;
  end if;
  if v_tipo = 'CORTESIA' and v_aut is null then f := f || 'F1 · Una cortesía necesita quién la autorizó.'::text; end if;
  if v_tipo = 'MAL_HECHO' and v_resp is null then f := f || 'F1 · Un mal hecho necesita el responsable.'::text; end if;
  -- el mal hecho va a cargo del responsable salvo que se diga lo contrario; la cortesía, a cargo de la casa
  v_cargo := coalesce((p ->> 'a_cargo')::boolean, v_tipo = 'MAL_HECHO');
  if v_cargo and v_resp is null then f := f || 'F1 · Para dejar el costo a cargo de alguien escoge el responsable.'::text; end if;

  -- producto de la carta y su ficha
  select g.id, g.nombre, g.tipo, g.area into v_g from public.genericos g where g.id = privado.uuid_o_null(p ->> 'generico_id') and g.activo;
  if v_g.id is null or v_g.tipo not in ('BEBIDA', 'PLATO') then
    f := f || 'F5 · Escoge un producto de la carta.'::text;
  elsif v_g.area <> v_area then
    f := f || ('F5 · ' || v_g.nombre || ' es de ' || v_g.area || ', no de ' || v_area || '.');
  else
    select fi.id, fi.version into v_ficha from public.fichas fi where fi.id = privado.ficha_vigente(v_g.id);
    if v_ficha.id is null then f := f || ('F5 · ' || v_g.nombre || ' no tiene ficha vigente: no se sabe qué descargar.'); end if;
  end if;

  -- ingredientes: cantidad de la ficha × unidades, en la marca que pide la ficha o la que hay en la zona
  if v_ficha.id is not null and v_und > 0 then
    for v_l in
      select l.linea, l.generico_id, gi.nombre, gi.tipo, gi.unidad_base, l.cantidad, l.unidad, l.producto_id,
             privado.a_base(gi.id, l.cantidad, l.unidad) as base,
             coalesce(privado.costo_marca(l.producto_id, gi.id), privado.costo_estimado_generico(gi.id)) as costo_unit
        from public.ficha_lineas l join public.genericos gi on gi.id = l.generico_id
       where l.ficha_id = v_ficha.id order by l.linea
    loop
      if v_l.tipo = 'SIN_COSTO' then continue; end if;
      if v_l.tipo in ('BEBIDA', 'PLATO') then
        f := f || ('F5 · La ficha lleva otro producto de carta (' || v_l.nombre || '): regístralo por separado.'); continue;
      end if;
      if v_l.cantidad is null then a := a || ('A · ' || v_l.nombre || ': la ficha no trae cantidad, no se descarga.'); continue; end if;
      if v_l.base is null then
        if lower(v_l.unidad) in ('dash', 'gts', 'gota') then continue; end if;
        f := f || ('F8 · ' || v_l.nombre || ': falta la conversión ' || v_l.unidad || '→' || v_l.unidad_base || '.'); continue;
      end if;
      v_base := v_l.base * v_und;
      v_prod := null;
      select pr.id into v_prod from public.productos pr where pr.id = v_l.producto_id and pr.generico_id = v_l.generico_id and pr.activo;
      if v_prod is null then
        select pr.id into v_prod from public.productos pr
          left join public.existencias e on e.producto_id = pr.id and e.ubicacion = v_ubic
         where pr.generico_id = v_l.generico_id and pr.activo
         order by coalesce(e.cantidad, 0) desc, pr.codigo limit 1;
      end if;
      if v_prod is null then f := f || ('F5 · ' || v_l.nombre || ' no tiene ningún producto en el catálogo.'); continue; end if;
      select coalesce(sum(e.cantidad), 0) into v_saldo from public.existencias e where e.producto_id = v_prod and e.ubicacion = v_ubic;
      if v_saldo < v_base then
        b := b || ('B3 · ' || v_l.nombre || ': el kardex tiene ' || round(v_saldo, 2) || ' ' || v_l.unidad_base || ' en la zona y se descargan ' || round(v_base, 2) || '.');
      end if;
      v_n := v_n + 1;
      v_lineas := v_lineas || jsonb_build_object('n', v_n, 'producto_id', v_prod, 'base', v_base, 'unidad', v_l.unidad_base,
                                                 'costo_ficha', v_base * v_l.costo_unit);
    end loop;
    if v_n = 0 and cardinality(f) = 0 then f := f || 'F3 · La ficha no tiene ingredientes que descargar.'::text; end if;
  end if;

  v_rechazo := privado.rechazo('bajas', f, b, a, v_motivo);
  if v_rechazo is not null then return v_rechazo; end if;

  v_codigo := privado.siguiente_codigo('BAJ-' || v_area || '-' || to_char(v_fecha, 'YYYYMMDD'));
  insert into public.bajas (id, codigo, area, ubicacion, fecha, causa, observaciones, forzada, motivo_forzado)
  values (v_id, v_codigo, v_area, v_ubic, v_fecha, v_tipo,
          trim(both ' ·' from v_und::text || ' × ' || v_g.nombre || ' · ' || coalesce(nullif(trim(p ->> 'observaciones'), ''), '')),
          cardinality(b) > 0, case when cardinality(b) > 0 then v_motivo end);
  for v_x in select value from jsonb_array_elements(v_lineas)
  loop
    v_mov := privado.registrar_movimiento('SALIDA_BAJA', (v_x ->> 'producto_id')::uuid, v_ubic,
                                          (v_x ->> 'base')::numeric, v_fecha, null, 'BAJA', v_id);
    insert into public.baja_lineas (baja_id, linea, producto_id, cantidad, unidad, cantidad_base, movimiento_id)
    values (v_id, (v_x ->> 'n')::int, (v_x ->> 'producto_id')::uuid, (v_x ->> 'base')::numeric,
            v_x ->> 'unidad', (v_x ->> 'base')::numeric, v_mov.id);
    if v_mov.costo_unitario is not null then
      v_costo := v_costo - v_mov.costo_total;
    else
      v_costo := v_costo + coalesce((v_x ->> 'costo_ficha')::numeric, 0);
      v_estimado := true;
    end if;
  end loop;
  insert into public.bajas_carta (baja_id, tipo, generico_id, ficha_id, ficha_version, unidades, autorizado_por, responsable_id,
                                  a_cargo, costo_mp, costo_estimado, estado_cobro)
  values (v_id, v_tipo, v_g.id, v_ficha.id, v_ficha.version, v_und, v_aut, v_resp, v_cargo, round(v_costo, 2), v_estimado,
          case when v_cargo then 'PENDIENTE' else 'NO_APLICA' end);
  perform privado.bitacora(case v_tipo when 'CORTESIA' then 'CORTESÍA' else 'MAL HECHO' end || ' GUARDADO', 'bajas', v_codigo,
                           jsonb_build_object('producto', v_g.nombre, 'unidades', v_und, 'a_cargo', v_cargo, 'bloqueos', to_jsonb(b)),
                           case when cardinality(b) > 0 then v_motivo end);
  return privado.resultado(true, v_id, v_codigo, f, b, a)
         || jsonb_build_object('costo_mp', case when privado.ve_precios() then round(v_costo) end, 'lineas', v_n);
end
$$;

-- ---------------------------------------------------------------- listar
-- todos los que operan el área ven qué se registró; los pesos solo administración
create or replace function public.bajas_carta_lista(p_area public.area_app default null, p_desde date default null, p_hasta date default null)
returns table (baja_id uuid, codigo text, area public.area_app, fecha date, tipo text, producto text, generico_id uuid, unidades numeric,
               autorizado_por text, responsable_id uuid, responsable text, a_cargo boolean, costo_mp numeric, costo_estimado boolean,
               estado_cobro text, cobro_nota text, cobro_por text, cobro_en timestamptz, observaciones text, registrado_por text,
               forzada boolean, anulada boolean)
language sql stable security definer set search_path = ''
as $$
  select b.id, b.codigo, b.area, b.fecha, bc.tipo, g.nombre, bc.generico_id, bc.unidades, pa.nombre, bc.responsable_id, pr.nombre, bc.a_cargo,
         case when privado.ve_precios() then bc.costo_mp end, bc.costo_estimado, bc.estado_cobro, bc.cobro_nota, pc.nombre, bc.cobro_en,
         b.observaciones, pu.nombre, b.forzada,
         exists (select 1 from public.baja_lineas l join public.movimientos m on m.reversa_de = l.movimiento_id where l.baja_id = b.id)
    from public.bajas_carta bc join public.bajas b on b.id = bc.baja_id join public.genericos g on g.id = bc.generico_id
    left join public.perfiles pa on pa.id = bc.autorizado_por left join public.perfiles pr on pr.id = bc.responsable_id
    left join public.perfiles pc on pc.id = bc.cobro_por left join public.perfiles pu on pu.id = b.usuario_id
   where (p_area is null or b.area = p_area) and (p_desde is null or b.fecha >= p_desde) and (p_hasta is null or b.fecha <= p_hasta)
     and (privado.ve_precios() or privado.puede_operar(b.area))
   order by b.fecha desc, b.registrado_en desc
$$;

-- p: {baja_id, estado: DESCONTADO | CONDONADO | PENDIENTE, nota}
create or replace function public.cobro_baja_carta(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v record; v_estado text := upper(coalesce(p ->> 'estado', '')); v_nota text := nullif(trim(p ->> 'nota'), '');
begin
  if not privado.ve_precios() then
    raise exception 'Sin permiso: los cobros los maneja administración.' using errcode = '42501';
  end if;
  select bc.*, b.codigo into v from public.bajas_carta bc join public.bajas b on b.id = bc.baja_id
   where bc.baja_id = privado.uuid_o_null(p ->> 'baja_id') for update of bc;
  if v.baja_id is null then return jsonb_build_object('ok', false, 'error', 'No encontré el registro.'); end if;
  if not v.a_cargo then return jsonb_build_object('ok', false, 'error', 'Este registro no quedó a cargo de nadie.'); end if;
  if v_estado not in ('DESCONTADO', 'CONDONADO', 'PENDIENTE') then return jsonb_build_object('ok', false, 'error', 'Estado no válido.'); end if;
  if v_estado = v.estado_cobro then return jsonb_build_object('ok', false, 'error', 'Ya está en ese estado.'); end if;
  if v_estado = 'CONDONADO' and v_nota is null then return jsonb_build_object('ok', false, 'error', 'Escribe por qué se condona.'); end if;
  if v_estado = 'PENDIENTE' and v_nota is null then return jsonb_build_object('ok', false, 'error', 'Escribe por qué vuelve a pendiente.'); end if;
  update public.bajas_carta set estado_cobro = v_estado, cobro_nota = v_nota, cobro_por = auth.uid(), cobro_en = now()
   where baja_id = v.baja_id;
  perform privado.bitacora('COBRO ' || v_estado, 'bajas_carta', v.codigo, jsonb_build_object('costo_mp', v.costo_mp, 'nota', v_nota));
  return jsonb_build_object('ok', true);
end
$$;

revoke execute on function public.personas_bajas_carta(), public.registrar_baja_carta(jsonb),
                           public.bajas_carta_lista(public.area_app, date, date), public.cobro_baja_carta(jsonb) from public, anon;
grant execute on function public.personas_bajas_carta(), public.registrar_baja_carta(jsonb),
                          public.bajas_carta_lista(public.area_app, date, date), public.cobro_baja_carta(jsonb) to authenticated;
