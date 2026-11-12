-- =====================================================================================
-- SGI Di Égida · Puerta única de registros (fase 1 de mitigación, 11/11/2026)
-- Todo registro que mueve el kardex desde la app pasa por public.enviar(clave, función, p):
--   1. Envío único: la clave la genera el formulario al abrirse. Si llega dos veces (doble toque,
--      red lenta), la segunda devuelve el resultado de la primera y no registra nada.
--   2. Cantidades fuera de lo normal: si una cantidad pasa CORDURA_FACTOR veces lo habitual del
--      producto (su mayor movimiento del mismo tipo, o su mayor compra histórica), no se guarda
--      hasta que alguien la confirme. Nada queda escrito mientras tanto.
--   3. Contenido sin verificar: si la cantidad se calculó con el contenido de la presentación
--      (botellas, bolsas) y ese contenido nadie lo ha verificado, se pide confirmarlo. Si lo
--      confirma administración o el jefe del área, queda verificado.
--   4. PIN: con EXIGIR_PIN = SI, la cortesía pide el PIN de quien autoriza y la anulación el de
--      quien anula. Así una sesión abierta en el iPad no autoriza a nombre de otro.
-- Además: cada cambio de un parámetro queda en la bitácora y, si cambia un valor, abre una alerta.
-- Las funciones registrar_* y anular_documento dejan de poder llamarse directo desde la app.
-- =====================================================================================

insert into public.parametros (clave, valor, descripcion)
select v.clave, v.valor, v.descripcion from (values
  ('CORDURA_FACTOR', '3', 'Pide confirmar una cantidad que pase estas veces lo habitual del producto.'),
  ('CORDURA_MIN_HISTORIA', '3', 'Movimientos del mismo tipo que necesita un producto para saber qué es lo habitual.'),
  ('EXIGIR_PIN', 'NO', 'SI: la cortesía pide el PIN de quien autoriza y la anulación el de quien anula.'),
  ('PIN_INTENTOS', '5', 'Intentos fallidos de PIN antes de bloquearlo.'),
  ('PIN_BLOQUEO_MIN', '15', 'Minutos que queda bloqueado un PIN tras los intentos fallidos.')
) as v (clave, valor, descripcion)
where not exists (select 1 from public.parametros p where p.clave = v.clave);

-- ---------------------------------------------------------------- contenido verificado
alter table public.productos
  add column if not exists contenido_verificado_en  timestamptz,
  add column if not exists contenido_verificado_por uuid references public.perfiles (id);

-- si cambia el contenido, la verificación ya no vale
create or replace function privado.contenido_cambiado() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.contenido_base is distinct from old.contenido_base
     and new.contenido_verificado_en is not distinct from old.contenido_verificado_en then
    new.contenido_verificado_en := null;
    new.contenido_verificado_por := null;
  end if;
  return new;
end
$$;
drop trigger if exists productos_contenido_cambiado on public.productos;
create trigger productos_contenido_cambiado before update of contenido_base on public.productos
  for each row execute function privado.contenido_cambiado();

-- quién puede dar por verificado un contenido: administración o el jefe del área
create or replace function privado.verifica_area(p_area public.area_app) returns boolean
language sql stable security definer set search_path = '' as $$
  select privado.tiene_rol('admin') or (p_area = 'BAR' and privado.tiene_rol('jefe_bar'))
      or (p_area = 'COCINA' and privado.tiene_rol('chef'))
$$;

create or replace function privado.marcar_verificado(p_producto uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_p record;
begin
  select pr.codigo, pr.contenido_base, pr.presentacion into v_p from public.productos pr where pr.id = p_producto;
  update public.productos set contenido_verificado_en = now(), contenido_verificado_por = auth.uid()
   where id = p_producto and contenido_verificado_en is null;
  if found then
    perform privado.bitacora('CONTENIDO VERIFICADO', 'productos', v_p.codigo,
                             jsonb_build_object('contenido_base', v_p.contenido_base, 'presentacion', v_p.presentacion));
  end if;
end
$$;

-- Desde la ficha del producto: «sí, cada unidad trae esto»
create or replace function public.verificar_contenido(p_producto uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_area public.area_app; v_cont numeric;
begin
  select g.area, pr.contenido_base into v_area, v_cont
    from public.productos pr join public.genericos g on g.id = pr.generico_id where pr.id = p_producto;
  if v_area is null then return jsonb_build_object('ok', false, 'error', 'No existe el producto.'); end if;
  if not privado.verifica_area(v_area) then
    return jsonb_build_object('ok', false, 'error', 'Verifica el contenido administración o el jefe del área.');
  end if;
  if v_cont is null then return jsonb_build_object('ok', false, 'error', 'El producto no tiene contenido fijo.'); end if;
  perform privado.marcar_verificado(p_producto);
  return jsonb_build_object('ok', true);
end
$$;

-- Productos de una zona cuyo contenido se usa para contar y nadie ha verificado
create or replace function public.contenidos_sin_verificar(p_ubicacion text)
returns table (producto_id uuid)
language sql stable security definer set search_path = '' as $$
  select pr.id from public.productos pr join public.genericos g on g.id = pr.generico_id
    join public.ubicaciones u on u.codigo = p_ubicacion and u.area = g.area
   where pr.contenido_base is not null and not pr.contenido_variable and pr.contenido_verificado_en is null
     and privado.opera_en(g.area)
$$;

-- ---------------------------------------------------------------- PIN
create table if not exists public.perfiles_pin (
  perfil_id        uuid primary key references public.perfiles (id),
  sal              text not null,
  pin_hash         text not null,
  fijado_en        timestamptz not null default now(),
  intentos         integer not null default 0,
  bloqueado_hasta  timestamptz
);
alter table public.perfiles_pin enable row level security;     -- nadie lo lee: solo las funciones
revoke all on public.perfiles_pin from anon, authenticated;

create or replace function privado.hash_pin(p_sal text, p_pin text) returns text
language plpgsql immutable set search_path = '' as $$
declare h bytea := convert_to(p_sal || ':' || p_pin, 'UTF8'); i integer;
begin
  for i in 1..2000 loop h := sha256(h || convert_to(p_sal, 'UTF8')); end loop;
  return encode(h, 'hex');
end
$$;

-- null = PIN correcto; si no, el motivo
create or replace function privado.revisar_pin(p_perfil uuid, p_pin text) returns text
language plpgsql security definer set search_path = '' as $$
declare v public.perfiles_pin; v_nombre text;
begin
  select nombre into v_nombre from public.perfiles where id = p_perfil;
  select * into v from public.perfiles_pin where perfil_id = p_perfil for update;
  if v.perfil_id is null then
    return coalesce(v_nombre, 'Esa persona') || ' no tiene PIN. Lo fija en Mi cuenta.';
  end if;
  if v.bloqueado_hasta > now() then
    return 'El PIN de ' || v_nombre || ' está bloqueado hasta las ' || to_char(v.bloqueado_hasta at time zone 'America/Bogota', 'HH24:MI') || ' por intentos fallidos.';
  end if;
  if coalesce(p_pin, '') = '' or privado.hash_pin(v.sal, p_pin) <> v.pin_hash then
    update public.perfiles_pin
       set intentos = v.intentos + 1,
           bloqueado_hasta = case when v.intentos + 1 >= privado.parametro_num('PIN_INTENTOS', 5)
                                  then now() + make_interval(mins => privado.parametro_num('PIN_BLOQUEO_MIN', 15)::int) end
     where perfil_id = p_perfil;
    perform privado.bitacora('PIN FALLIDO', 'perfiles', p_perfil::text, jsonb_build_object('intento', v.intentos + 1));
    return 'El PIN de ' || v_nombre || ' no es correcto.';
  end if;
  update public.perfiles_pin set intentos = 0, bloqueado_hasta = null where perfil_id = p_perfil;
  return null;
end
$$;

-- Cada quien fija su PIN; para cambiarlo pide el anterior
create or replace function public.fijar_pin(p_pin text, p_anterior text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_yo uuid := auth.uid(); v_err text; v_sal text;
begin
  if v_yo is null then return jsonb_build_object('ok', false, 'error', 'Sin sesión.'); end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then
    return jsonb_build_object('ok', false, 'error', 'El PIN son de 4 a 6 números.');
  end if;
  if p_pin ~ '^(.)\1+$' or '0123456789' like '%' || p_pin || '%' or '9876543210' like '%' || p_pin || '%' then
    return jsonb_build_object('ok', false, 'error', 'Ese PIN es muy fácil de adivinar (números iguales o seguidos).');
  end if;
  if exists (select 1 from public.perfiles_pin where perfil_id = v_yo) then
    v_err := privado.revisar_pin(v_yo, p_anterior);
    if v_err is not null then return jsonb_build_object('ok', false, 'error', 'El PIN anterior no es correcto.'); end if;
  end if;
  v_sal := encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex');
  insert into public.perfiles_pin (perfil_id, sal, pin_hash) values (v_yo, v_sal, privado.hash_pin(v_sal, p_pin))
  on conflict (perfil_id) do update set sal = excluded.sal, pin_hash = excluded.pin_hash, fijado_en = now(),
                                        intentos = 0, bloqueado_hasta = null;
  perform privado.bitacora('PIN FIJADO', 'perfiles', v_yo::text);
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.tiene_pin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles_pin where perfil_id = auth.uid())
$$;

create or replace function public.exige_pin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(privado.parametro('EXIGIR_PIN') = 'SI', false)
$$;

-- Administración borra el PIN de alguien que lo olvidó (lo vuelve a fijar en Mi cuenta)
create or replace function public.borrar_pin(p_perfil uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not privado.tiene_rol('admin') then return jsonb_build_object('ok', false, 'error', 'Solo administración.'); end if;
  delete from public.perfiles_pin where perfil_id = p_perfil;
  perform privado.bitacora('PIN BORRADO', 'perfiles', p_perfil::text);
  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------- envíos
create table if not exists public.envios (
  clave       uuid primary key,
  funcion     text not null,
  usuario_id  uuid default auth.uid(),
  resultado   jsonb,
  creado_en   timestamptz not null default now()
);
alter table public.envios enable row level security;
revoke all on public.envios from anon, authenticated;

create or replace function privado.miles(p numeric) returns text
language sql immutable as $$
  -- 21000 → «21.000» · 4.5 → «4,50»
  select replace(replace(replace(to_char(round(p, case when abs(p) < 10 then 2 else 0 end), 'FM999,999,999,990.99'), ',', '#'), '.', ','), '#', '.')
$$;
create or replace function privado.cifra(p numeric) returns text
language sql immutable as $$
  select regexp_replace(regexp_replace(privado.miles(p), ',0+$', ''), ',$', '')
$$;

-- Revisiones de lo que registró este envío (movimientos del usuario en esta transacción)
create or replace function privado.revisiones_envio(p_funcion text, p jsonb, p_desde bigint, p_confirmados uuid[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_factor numeric := privado.parametro_num('CORDURA_FACTOR', 3);
  v_min    integer := privado.parametro_num('CORDURA_MIN_HISTORIA', 3)::int;
  v_rev    jsonb := '[]';
  r        record;
  v_hab    numeric; v_n integer; v_hist numeric; v_nh integer;
  v_cont_usado uuid[] := '{}';
begin
  -- 1 · cantidades fuera de lo normal, por producto y tipo
  for r in
    select m.producto_id, x.grupo, sum(abs(m.cantidad)) as q, g.nombre, pr.presentacion, g.unidad_base::text as ub
      from public.movimientos m
      join public.productos pr on pr.id = m.producto_id join public.genericos g on g.id = pr.generico_id
      cross join lateral (select case when m.tipo in ('SALDO_INICIAL', 'ENTRADA_COMPRA') then 'ENTRA'
                                      when m.tipo = 'SALIDA_BAJA' then 'BAJA'
                                      when m.tipo = 'TRASLADO_SALIDA' then 'TRASLADO'
                                      when m.tipo = 'SALIDA_A_PRODUCCION' then 'PRODUCCION'
                                      when m.tipo = 'ENTRADA_PRODUCCION' then 'LOTE' end as grupo) x
     where m.id > p_desde and m.registrado_en = now() and m.usuario_id is not distinct from auth.uid()
       and x.grupo is not null
     group by m.producto_id, x.grupo, g.nombre, pr.presentacion, g.unidad_base
  loop
    continue when r.producto_id = any (p_confirmados);
    select max(abs(m.cantidad)), count(*) into v_hab, v_n
      from public.movimientos m
     where m.producto_id = r.producto_id and m.id <= p_desde and m.tipo <> 'REVERSA'
       and not exists (select 1 from public.movimientos z where z.reversa_de = m.id)
       and case r.grupo when 'ENTRA' then m.tipo in ('SALDO_INICIAL', 'ENTRADA_COMPRA')
                        when 'BAJA' then m.tipo = 'SALIDA_BAJA'
                        when 'TRASLADO' then m.tipo = 'TRASLADO_SALIDA'
                        when 'PRODUCCION' then m.tipo = 'SALIDA_A_PRODUCCION'
                        else m.tipo = 'ENTRADA_PRODUCCION' end;
    if r.grupo = 'ENTRA' then
      select max(c.cantidad_base), count(*) into v_hist, v_nh
        from public.compras_historicas c where c.producto_id = r.producto_id and c.computable;
      v_hab := greatest(coalesce(v_hab, 0), coalesce(v_hist, 0));
      v_n := v_n + coalesce(v_nh, 0);
    end if;
    if v_n >= v_min and v_hab > 0 and r.q > v_factor * v_hab then
      v_rev := v_rev || jsonb_build_object('producto_id', r.producto_id, 'motivo', 'CANTIDAD',
        'mensaje', r.nombre || coalesce(' · ' || nullif(r.presentacion, ''), '') || ': ' || privado.cifra(r.q) || ' ' || r.ub
                   || ' es más de ' || privado.cifra(v_factor) || ' veces lo habitual (hasta ' || privado.cifra(v_hab) || ' ' || r.ub
                   || '). Revisa la cantidad y la unidad; si está bien, confírmalo.');
    end if;
  end loop;

  -- 2 · contenido de la presentación sin verificar
  if p_funcion = 'registrar_recepcion' then
    select coalesce(array_agg(distinct m.producto_id), '{}') into v_cont_usado
      from public.movimientos m join public.productos pr on pr.id = m.producto_id
     where m.id > p_desde and m.registrado_en = now() and m.usuario_id is not distinct from auth.uid()
       and m.tipo = 'ENTRADA_COMPRA' and not pr.contenido_variable;
  elsif p_funcion = 'registrar_conteo' then
    select coalesce(array_agg(distinct privado.uuid_o_null(l ->> 'producto_id')), '{}') into v_cont_usado
      from jsonb_array_elements(coalesce(p -> 'lineas', '[]')) l
     where privado.num_o_null(l ->> 'unidades_compra') > 0;
  end if;
  for r in
    select pr.id, g.nombre, pr.presentacion, pr.contenido_base, g.unidad_base::text as ub
      from public.productos pr join public.genericos g on g.id = pr.generico_id
     where pr.id = any (v_cont_usado) and pr.contenido_base is not null and pr.contenido_verificado_en is null
  loop
    continue when r.id = any (p_confirmados)
              or exists (select 1 from jsonb_array_elements(v_rev) e where (e ->> 'producto_id')::uuid = r.id);
    v_rev := v_rev || jsonb_build_object('producto_id', r.id, 'motivo', 'CONTENIDO',
      'mensaje', r.nombre || ': se calculó con «' || coalesce(nullif(r.presentacion, ''), 'su presentación') || '» = '
                 || privado.cifra(r.contenido_base) || ' ' || r.ub || ' por unidad, y ese contenido no está verificado. '
                 || 'Confirma que cada unidad trae ' || privado.cifra(r.contenido_base) || ' ' || r.ub || '.');
  end loop;
  return v_rev;
end
$$;

create or replace function public.enviar(p_clave uuid, p_funcion text, p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_res      jsonb;
  v_prev     jsonb;
  v_desde    bigint;
  v_rev      jsonb := '[]';
  v_conf     uuid[];
  v_err      text;
  v_area     public.area_app;
  v_filas    integer := 0;
  r          record;
begin
  if p_funcion not in ('registrar_recepcion', 'registrar_conteo', 'registrar_baja', 'registrar_traslado',
                       'registrar_lote', 'registrar_baja_carta', 'anular_documento') then
    raise exception 'Función no válida: %', p_funcion;
  end if;
  p := coalesce(p, '{}');

  -- 1 · envío único (un segundo envío con la misma clave espera al primero y devuelve su resultado)
  if p_clave is not null then
    insert into public.envios (clave, funcion) values (p_clave, p_funcion) on conflict (clave) do nothing;
    get diagnostics v_filas = row_count;
    if v_filas = 0 then
      select resultado into v_prev from public.envios where clave = p_clave;
      if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
      return privado.resultado(false, null, null, array['Este envío ya se está procesando. Espera un momento.'], '{}', '{}');
    end if;
  end if;

  -- 2 · PIN
  if privado.parametro('EXIGIR_PIN') = 'SI' then
    if p_funcion = 'registrar_baja_carta' and privado.uuid_o_null(p ->> 'autorizado_por') is not null then
      v_err := privado.revisar_pin(privado.uuid_o_null(p ->> 'autorizado_por'), p ->> 'pin_autoriza');
    elsif p_funcion = 'anular_documento' then
      v_err := privado.revisar_pin(auth.uid(), p ->> 'pin');
    end if;
    if v_err is not null then
      if p_clave is not null then delete from public.envios where clave = p_clave; end if;
      return privado.resultado(false, null, null, array['F1 · ' || v_err], '{}', '{}') || jsonb_build_object('pin', true);
    end if;
  end if;
  p := p - 'pin' - 'pin_autoriza';

  select coalesce(array_agg(privado.uuid_o_null(x)) filter (where privado.uuid_o_null(x) is not null), '{}') into v_conf
    from jsonb_array_elements_text(coalesce(p -> 'confirmados', '[]')) x;
  select coalesce(max(id), 0) into v_desde from public.movimientos;

  -- 3 · registrar y revisar; si algo pide confirmación, se deshace todo lo de este bloque
  begin
    v_res := case p_funcion
      when 'registrar_recepcion'  then public.registrar_recepcion(p)
      when 'registrar_conteo'     then public.registrar_conteo(p)
      when 'registrar_baja'       then public.registrar_baja(p)
      when 'registrar_traslado'   then public.registrar_traslado(p)
      when 'registrar_lote'       then public.registrar_lote(p)
      when 'registrar_baja_carta' then public.registrar_baja_carta(p)
      when 'anular_documento'     then public.anular_documento(p ->> 'tipo', privado.uuid_o_null(p ->> 'id'), p ->> 'motivo',
                                                               privado.uuid_o_null(p ->> 'linea_id'))
    end;
    if coalesce((v_res ->> 'ok')::boolean, false) and p_funcion <> 'anular_documento' then
      v_rev := privado.revisiones_envio(p_funcion, p, v_desde, v_conf);
      if jsonb_array_length(v_rev) > 0 then
        raise exception using errcode = 'SGREV', message = 'revisar';
      end if;
    end if;
  exception when sqlstate 'SGREV' then
    if p_clave is not null then delete from public.envios where clave = p_clave; end if;
    return privado.resultado(false, null, null,
             array(select e ->> 'mensaje' from jsonb_array_elements(v_rev) e), '{}', '{}')
           || jsonb_build_object('revisar', v_rev);
  end;

  if coalesce((v_res ->> 'ok')::boolean, false) then
    -- lo confirmado queda en la bitácora; el contenido confirmado por quien puede, queda verificado
    for r in select pr.id, pr.codigo, g.area from public.productos pr join public.genericos g on g.id = pr.generico_id
              where pr.id = any (v_conf) loop
      perform privado.bitacora('CONFIRMÓ CANTIDAD O CONTENIDO', p_funcion, coalesce(v_res ->> 'codigo', ''),
                               jsonb_build_object('producto', r.codigo));
      if p_funcion in ('registrar_recepcion', 'registrar_conteo') and privado.verifica_area(r.area) then
        perform privado.marcar_verificado(r.id);
      end if;
    end loop;
    if p_clave is not null then update public.envios set resultado = v_res where clave = p_clave; end if;
  elsif p_clave is not null then
    delete from public.envios where clave = p_clave;   -- se corrige y se vuelve a enviar con la misma clave
  end if;
  return v_res;
end
$$;

revoke execute on function public.enviar(uuid, text, jsonb), public.fijar_pin(text, text), public.tiene_pin(),
  public.borrar_pin(uuid), public.verificar_contenido(uuid), public.contenidos_sin_verificar(text), public.exige_pin() from public, anon;
grant execute on function public.enviar(uuid, text, jsonb), public.fijar_pin(text, text), public.tiene_pin(),
  public.borrar_pin(uuid), public.verificar_contenido(uuid), public.contenidos_sin_verificar(text), public.exige_pin() to authenticated;
-- desde la app solo por la puerta
revoke execute on function public.registrar_recepcion(jsonb), public.registrar_conteo(jsonb), public.registrar_baja(jsonb),
  public.registrar_traslado(jsonb), public.registrar_lote(jsonb), public.registrar_baja_carta(jsonb),
  public.anular_documento(text, uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- parámetros vigilados
alter table public.alertas drop constraint if exists alertas_regla_check;
alter table public.alertas add constraint alertas_regla_check check (regla in ('VARIACION_ROJA', 'FALTANTE_INSUMO', 'SOBRE_META',
  'SUBIDA_PRECIO', 'RENDIMIENTO', 'PERDIDAS_ALTAS', 'VENTAS_SIN_FICHA', 'CONTROL_CAMBIADO'));

create or replace function privado.parametro_vigilado() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_antes text; v_quien text;
begin
  select p.valor into v_antes from public.parametros p
   where p.clave = coalesce(new.clave, old.clave) and (tg_op = 'DELETE' or p.vigente_desde < new.vigente_desde)
     and (tg_op <> 'DELETE' or p.vigente_desde <> old.vigente_desde)
   order by p.vigente_desde desc limit 1;
  select nombre into v_quien from public.perfiles where id = auth.uid();
  v_quien := coalesce(v_quien, 'acceso directo a la base');
  perform privado.bitacora('PARÁMETRO ' || case tg_op when 'INSERT' then 'CAMBIADO' when 'UPDATE' then 'EDITADO' else 'BORRADO' end,
                           'parametros', coalesce(new.clave, old.clave),
                           jsonb_build_object('antes', coalesce(case when tg_op = 'INSERT' then v_antes else old.valor end, ''),
                                              'ahora', case when tg_op = 'DELETE' then null else new.valor end, 'por', v_quien));
  if (tg_op = 'INSERT' and v_antes is not null and v_antes is distinct from new.valor)
     or (tg_op = 'UPDATE' and old.valor is distinct from new.valor) or tg_op = 'DELETE' then
    perform privado.alerta_detectada('CONTROL_CAMBIADO',
      'PARAM-' || coalesce(new.clave, old.clave) || '-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'), null,
      'Se cambió el control ' || coalesce(new.clave, old.clave),
      coalesce(case when tg_op = 'INSERT' then v_antes else old.valor end, '—') || ' → '
        || coalesce(case when tg_op = 'DELETE' then null else new.valor end, '(borrado)') || ' · por ' || v_quien,
      null, null, privado.hoy(), privado.hoy());
  end if;
  return coalesce(new, old);
end
$$;
drop trigger if exists parametros_vigilados on public.parametros;
create trigger parametros_vigilados after insert or update or delete on public.parametros
  for each row execute function privado.parametro_vigilado();
