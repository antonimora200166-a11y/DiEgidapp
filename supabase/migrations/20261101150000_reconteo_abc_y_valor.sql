-- =====================================================================================
-- SGI Di Égida · Contar: reconteo obligatorio, programación ABC y valor por categoría
-- · Reconteo: en un conteo normal, si lo contado se aparta del kardex más de
--   UMBRAL_RECONTEO_PCT, no se guarda hasta recontar ese producto (F10). Se guarda el primer
--   conteo y que se recontó. Sigue a ciegas: el rechazo no dice cuánto esperaba el kardex.
-- · Programación ABC: A cada FRECUENCIA_CONTEO_A_DIAS (7), B cada 15, C (y sin clase) cada
--   30, contados desde el último conteo del producto en esa zona. hoja_conteo dice qué toca
--   y public.conteos_programados resume por zona.
-- · v_existencias trae la categoría para valorizar por área y categoría.
-- =====================================================================================

insert into public.parametros (clave, valor, descripcion)
select v.clave, v.valor, v.descripcion from (values
  ('UMBRAL_RECONTEO_PCT',      '20', 'En un conteo normal, una diferencia mayor que este % con el kardex obliga a recontar.'),
  ('FRECUENCIA_CONTEO_A_DIAS', '7',  'Días entre conteos de los productos clase A.'),
  ('FRECUENCIA_CONTEO_B_DIAS', '15', 'Días entre conteos de los productos clase B.'),
  ('FRECUENCIA_CONTEO_C_DIAS', '30', 'Días entre conteos de los productos clase C y de los que no tienen clase.')
) as v (clave, valor, descripcion)
where not exists (select 1 from public.parametros p where p.clave = v.clave);

alter table public.conteo_lineas
  add column recontado     boolean not null default false,
  add column primer_conteo numeric;   -- lo que dio el primer conteo, cuando hubo que recontar

-- =====================================================================================
-- RPC · CONTEO v2: igual que v1 y además exige el reconteo sobre el umbral.
-- lineas: [{producto_id, cantidad?, unidades_compra?, peso_bruto_g?, recontado?, primer_conteo?}]
-- Si falta recontar, responde ok=false con recontar: [{producto_id, contada}].
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
  v_umbral numeric := privado.parametro_num('UMBRAL_RECONTEO_PCT', 20);
  v_recontar jsonb := '[]'; v_recontado boolean;
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
    -- reconteo: si la diferencia pasa del umbral, se cuenta otra vez antes de guardar. El aviso
    -- no dice cuánto esperaba el kardex, para que el segundo conteo también sea a ciegas.
    v_recontado := coalesce(v_x ->> 'recontado', 'false') = 'true';
    if not v_inicial and round(v_cant, 4) <> round(v_saldo, 4)
       and (v_saldo <= 0 or abs(v_cant - v_saldo) / v_saldo * 100 > v_umbral) then
      if not v_recontado then
        f := f || ('F10 · Línea ' || v_n || ' (' || v_prod.nombre || '): la diferencia con lo esperado pasa del '
                   || v_umbral || ' %. Recuéntalo y escríbelo de nuevo.');
        v_recontar := v_recontar || jsonb_build_object('producto_id', v_prod.id, 'contada', round(v_cant, 4));
        continue;
      end if;
      a := a || ('Línea ' || v_n || ' (' || v_prod.nombre || '): recontado; queda el ajuste de '
                 || round(v_saldo, 2) || ' a ' || round(v_cant, 2) || '.');
    end if;
    v_lineas := v_lineas || jsonb_build_object('n', v_n, 'producto_id', v_prod.id, 'peso', v_peso,
                                               'contada', round(v_cant, 4), 'saldo', v_saldo, 'recontado', v_recontado,
                                               'primer', privado.num_o_null(v_x ->> 'primer_conteo'));
  end loop;

  v_rechazo := privado.rechazo('conteos', f, b, a, null);
  if v_rechazo is not null then return v_rechazo || jsonb_build_object('recontar', v_recontar); end if;

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
    insert into public.conteo_lineas (conteo_id, linea, producto_id, peso_bruto_g, cantidad_contada, saldo_teorico, movimiento_id,
                                      recontado, primer_conteo)
    values (v_id, (v_x ->> 'n')::int, (v_x ->> 'producto_id')::uuid, (v_x ->> 'peso')::numeric,
            (v_x ->> 'contada')::numeric, (v_x ->> 'saldo')::numeric, v_mov.id,
            coalesce((v_x ->> 'recontado')::boolean, false), (v_x ->> 'primer')::numeric);
  end loop;
  if v_sin_ref > 0 then
    a := a || (v_sin_ref || ' producto(s) entraron sin costo de referencia: su primera compra fijará el promedio.');
  end if;
  perform privado.bitacora(case when v_inicial then 'CONTEO INICIAL GUARDADO' else 'CONTEO GUARDADO' end,
                           'conteos', v_codigo, jsonb_build_object('movimientos', v_ajustes, 'sin_costo', v_sin_ref));
  return privado.resultado(true, v_id, v_codigo, f, b, a) || jsonb_build_object('ajustes', v_ajustes, 'sin_costo', v_sin_ref);
end
$$;

-- ---------------------------------------------------------------- frecuencia ABC
create or replace function privado.dias_entre_conteos(p_clase public.clase_abc)
returns integer
language sql stable security definer set search_path = ''
as $$
  select privado.parametro_num(case p_clase when 'A' then 'FRECUENCIA_CONTEO_A_DIAS' when 'B' then 'FRECUENCIA_CONTEO_B_DIAS'
                                            else 'FRECUENCIA_CONTEO_C_DIAS' end,
                               case p_clase when 'A' then 7 when 'B' then 15 else 30 end)::integer
$$;

-- =====================================================================================
-- Hoja de conteo v2: además de v1, la clase ABC, el último conteo en la zona y si toca hoy.
-- Toca = tiene kardex en esta zona y pasaron los días de su clase desde su último conteo en ella.
-- =====================================================================================
drop function public.hoja_conteo(text);
create function public.hoja_conteo(p_ubicacion text)
returns table (producto_id uuid, codigo text, generico text, marca text, presentacion text, categoria text,
               unidad_base public.unidad_base, unidad_compra text, contenido_base numeric, contenido_variable boolean,
               tiene_tara boolean, tiene_kardex boolean, asignado boolean, orden integer, estado public.estado_catalogo,
               clase_abc public.clase_abc, ultimo_conteo date, toca boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_area public.area_app;
  v_con_asignados boolean;
begin
  select u.area into v_area from public.ubicaciones u where u.codigo = p_ubicacion and u.activo;
  if v_area is null then raise exception 'Ubicación no válida: %', p_ubicacion; end if;
  if not privado.puede_operar(v_area) then
    raise exception 'Sin permiso para contar en %.', p_ubicacion using errcode = '42501';
  end if;
  v_con_asignados := exists (select 1 from public.ubicacion_productos up where up.ubicacion = p_ubicacion and up.activo);

  return query
  with base as (
    select p.id, p.codigo, g.nombre, p.marca, p.presentacion, coalesce(c.nombre, 'Sin categoría') as cat,
           g.unidad_base, p.unidad_compra, p.contenido_base, p.contenido_variable,
           exists (select 1 from public.taras t where t.producto_id = p.id and t.tara_g is not null) as tara,
           exists (select 1 from public.movimientos m where m.producto_id = p.id) as kardex,
           exists (select 1 from public.existencias e where e.producto_id = p.id and e.ubicacion = p_ubicacion) as en_zona,
           up.producto_id is not null as asig, up.orden, p.estado, p.clase_abc,
           (select max(co.fecha) from public.conteo_lineas cl join public.conteos co on co.id = cl.conteo_id
             where cl.producto_id = p.id and co.ubicacion = p_ubicacion) as ultimo
      from public.productos p
      join public.genericos g on g.id = p.generico_id
      left join public.categorias c on c.codigo = g.categoria
      left join public.ubicacion_productos up on up.producto_id = p.id and up.ubicacion = p_ubicacion and up.activo
     where p.activo and g.activo and g.area = v_area
       and g.tipo not in ('SIN_COSTO', 'BEBIDA', 'PLATO')
       and (up.producto_id is not null
            or exists (select 1 from public.existencias e where e.producto_id = p.id and e.ubicacion = p_ubicacion and e.cantidad <> 0)
            or not v_con_asignados)
  )
  select b.id, b.codigo, b.nombre, b.marca, b.presentacion, b.cat, b.unidad_base, b.unidad_compra, b.contenido_base,
         b.contenido_variable, b.tara, b.kardex, b.asig, b.orden, b.estado, b.clase_abc, b.ultimo,
         b.en_zona and (b.ultimo is null or privado.hoy() - b.ultimo >= privado.dias_entre_conteos(b.clase_abc))
    from base b
   order by (not b.asig), b.orden nulls last, (b.cat = 'Sin categoría'), b.cat, b.nombre, b.marca, b.presentacion;
end
$$;

revoke execute on function public.hoja_conteo(text) from public, anon;
grant execute on function public.hoja_conteo(text) to authenticated;

-- =====================================================================================
-- Qué toca contar hoy en cada zona donde la persona puede contar.
-- =====================================================================================
create or replace function public.conteos_programados()
returns table (ubicacion text, area public.area_app, productos integer, con_kardex integer,
               tocan integer, tocan_a integer, tocan_b integer, tocan_c integer, ultimo_conteo date)
language sql stable security definer set search_path = ''
as $$
  select u.codigo, u.area, count(h.producto_id)::int, count(*) filter (where h.tiene_kardex)::int,
         count(*) filter (where h.toca)::int,
         count(*) filter (where h.toca and h.clase_abc = 'A')::int,
         count(*) filter (where h.toca and h.clase_abc = 'B')::int,
         count(*) filter (where h.toca and (h.clase_abc = 'C' or h.clase_abc is null))::int,
         max(h.ultimo_conteo)
    from public.ubicaciones u
    cross join lateral public.hoja_conteo(u.codigo) h
   where u.activo and privado.puede_operar(u.area)
   group by u.codigo, u.area
$$;

revoke execute on function public.conteos_programados() from public, anon;
grant execute on function public.conteos_programados() to authenticated;

-- ---------------------------------------------------------------- existencias con categoría
create or replace view public.v_existencias with (security_invoker = true) as
select e.producto_id, p.codigo as producto_codigo, g.nombre as generico, p.marca, p.presentacion,
       g.unidad_base, g.area, e.ubicacion, e.cantidad, c.costo_promedio,
       e.cantidad * c.costo_promedio as valor,
       coalesce(ca.nombre, 'Sin categoría') as categoria, p.clase_abc
  from public.existencias e
  join public.productos p on p.id = e.producto_id
  join public.genericos g on g.id = p.generico_id
  left join public.costos_producto c on c.producto_id = e.producto_id
  left join public.categorias ca on ca.codigo = g.categoria;
