-- =====================================================================================
-- SGI Di Égida · 13 · Temperatura informativa y proveedor nuevo desde la factura
-- Decisiones de Anthony (27/10/2026):
-- · La temperatura de llegada ya no bloquea la recepción (se quita esa parte de B11). Se sigue
--   registrando: si llega por encima del máximo queda como aviso y la línea se marca H11.
--   El vencimiento de refrigerados y congelados sigue exigido (B11, EXIGIR_VENCIMIENTO_REFRIG).
-- · Si la foto de la factura trae un proveedor que no está en la lista, se crea solo
--   (public.proveedor_desde_factura) y queda en bitácora.
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
  v_ruta      text := nullif(trim(p ->> 'soporte_ruta'), '');
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
  v_rec       numeric; v_ped numeric; v_valor numeric; v_cont numeric; v_base numeric; v_temp numeric; v_tmax numeric;
  v_venc      date; v_cond text; v_sello text; v_obs text; v_origen text;
  v_cu        numeric;
  v_med       numeric; v_medcat numeric; v_ncat integer;
  v_ev        jsonb;
  v_hall      text[];
  v_vistos    uuid[] := '{}';
  v_linea_id  uuid;
  v_coherencia boolean := privado.parametro('BLOQUEA_COHERENCIA') is distinct from 'NO';
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
  if v_ruta is not null and v_ruta !~ ('^' || v_area || '/[0-9]{4}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$') then
    f := f || 'F1 · La foto de la factura no corresponde a esta área.'::text;
  end if;
  if v_ruta is null and v_soporte <> 'SIN_SOPORTE' then
    a := a || 'Recepción sin foto de la factura o remisión.'::text;
  end if;

  -- F3 · al menos una línea
  if jsonb_typeof(p -> 'lineas') is distinct from 'array' or jsonb_array_length(p -> 'lineas') = 0 then
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
           g.id as generico_id, g.nombre, g.area, g.activo as g_activo, g.tipo, g.unidad_base,
           c.exige_sello, c.es_perecedero, g.categoria, c.nombre as categoria_nombre,
           g.conservacion, privado.temp_max(g.conservacion, g.temp_max_llegada) as tmax
      into v_prod
      from public.productos pr join public.genericos g on g.id = pr.generico_id
      left join public.categorias c on c.codigo = g.categoria
     where pr.id = privado.uuid_o_null(v_lin ->> 'producto_id');
    v_ref := 'Línea ' || v_n || ' (' || coalesce(v_prod.nombre, nullif(v_lin ->> 'nombre_factura', ''), 'producto desconocido') || ')';

    -- F5 · producto del catálogo, activo y del área
    if v_prod.id is null then
      f := f || ('F5 · ' || v_ref || ': el producto no existe en el catálogo. Elígelo de la lista o créalo antes de recibirlo.'); continue;
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
    v_temp  := privado.num_o_null(v_lin ->> 'temperatura');
    v_obs   := coalesce(trim(v_lin ->> 'observaciones'), '');
    v_origen := coalesce(nullif(v_lin ->> 'origen', ''), 'MANUAL');

    -- F6 · contenido por presentación (sin él no hay cantidad en unidad base)
    if v_cont is null or v_cont <= 0 then
      f := f || ('F6 · ' || v_ref || ': falta el contenido por presentación (peso o volumen real recibido por '
                 || v_prod.unidad_compra || ').');
    end if;
    if v_cond not in ('OK', 'DANADO', 'NO_LLEGO', 'INCOMPLETO') then
      f := f || ('F6 · ' || v_ref || ': condición no válida «' || v_cond || '».');
    end if;
    if v_sello is not null and v_sello not in ('SI', 'NO', 'NA') then
      f := f || ('F6 · ' || v_ref || ': sello no válido «' || v_sello || '».');
    end if;
    if v_origen not in ('IA_CONFIRMADA', 'IA_CORREGIDA', 'MANUAL') then
      f := f || ('F6 · ' || v_ref || ': origen de la línea no válido «' || v_origen || '».');
    end if;

    -- B3 · cantidad recibida
    if v_rec is null then b := b || ('B3 · ' || v_ref || ': cantidad recibida vacía o no numérica.');
    elsif v_rec < 0 then b := b || ('B3 · ' || v_ref || ': cantidad recibida negativa.');
    end if;

    -- B4 · coherencia cantidad / condición (BLOQUEA_COHERENCIA)
    if v_coherencia then
      if v_rec = 0 and v_cond = 'OK' then
        b := b || ('B4 · ' || v_ref || ': recibido 0 pero marcado OK. Corrige la cantidad o la condición.');
      end if;
      if v_cond = 'NO_LLEGO' and v_rec > 0 then
        b := b || ('B4 · ' || v_ref || ': marcado «no llegó» pero con cantidad recibida ' || v_rec || '.');
      end if;
      if v_rec = 0 and v_valor > 0 and v_cond <> 'NO_LLEGO' then
        b := b || ('B4 · ' || v_ref || ': cantidad 0 con valor ' || v_valor || '. El valor del ítem quedaría en cero.');
      end if;
    end if;

    -- diferencia pedido / recibido (aviso; BLOQUEA_DIFERENCIA = SI la vuelve B5)
    if v_ped is not null and v_rec is not null and v_ped <> v_rec and v_obs = '' then
      if privado.parametro('BLOQUEA_DIFERENCIA') = 'SI' then
        b := b || ('B5 · ' || v_ref || ': diferencia de ' || case when v_rec > v_ped then '+' else '' end
                   || (v_rec - v_ped) || ' frente a lo pedido sin observación.');
      else
        a := a || (v_ref || ': diferencia de ' || case when v_rec > v_ped then '+' else '' end
                   || (v_rec - v_ped) || ' frente a lo pedido sin observación.');
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
      select percentile_cont(0.5) within group (order by pc.cu), count(*)
        into v_medcat, v_ncat
        from privado.precios_compra pc join public.genericos g2 on g2.id = pc.generico_id
       where g2.categoria is not distinct from v_prod.categoria and g2.unidad_base = v_prod.unidad_base;
      select percentile_cont(0.5) within group (order by pc.cu)
        into v_med
        from privado.precios_compra pc
       where pc.producto_id = v_prod.id or (pc.producto_id is null and pc.generico_id = v_prod.generico_id);
      v_ev := privado.evaluar_precio(v_cu, v_medcat, v_ncat, v_med,
                                     coalesce(v_prod.categoria_nombre, v_prod.categoria), v_prod.unidad_base::text);
      if v_ev ->> 'nivel' = 'bloquea' then b := b || ('B7 · ' || v_ref || ': ' || (v_ev ->> 'texto'));
      elsif v_ev ->> 'nivel' = 'aviso' then a := a || (v_ref || ': ' || (v_ev ->> 'texto'));
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
    elsif nullif(v_lin ->> 'vencimiento', '') is not null then
      a := a || (v_ref || ': el vencimiento «' || (v_lin ->> 'vencimiento') || '» no es una fecha válida.');
    end if;

    -- cadena de frío: la temperatura es informativa; el vencimiento sigue exigido (B11)
    if v_rec > 0 and v_prod.conservacion in ('Refrigerado', 'Congelado') then
      if v_temp > v_prod.tmax then
        a := a || (v_ref || ': llegó a ' || v_temp || ' °C y el máximo es ' || v_prod.tmax || ' °C.');
      end if;
      if v_venc is null and privado.parametro('EXIGIR_VENCIMIENTO_REFRIG') is distinct from 'NO' then
        b := b || ('B11 · ' || v_ref || ': es ' || lower(v_prod.conservacion) || ' y no tiene fecha de vencimiento.');
      end if;
    end if;

    -- calidad: lo que entra dañado o incompleto queda dicho
    if v_rec > 0 and v_cond = 'DANADO' then
      a := a || (v_ref || ': entra al inventario marcado DAÑADO. Registra la baja o la devolución de lo que no sirva.');
    end if;
    if v_cond = 'INCOMPLETO' and v_obs = '' then
      a := a || (v_ref || ': marcado incompleto sin observación de qué faltó.');
    end if;
  end loop;

  v_rechazo := privado.rechazo('recepciones', f, b, a, v_motivo);
  if v_rechazo is not null then return v_rechazo; end if;

  -- guardar
  v_codigo := privado.siguiente_codigo('REC-' || v_area || '-' || to_char(v_fecha, 'YYYYMMDD'));
  insert into public.recepciones (id, codigo, area, ubicacion, fecha, proveedor_id, tipo_soporte, documento,
                                  recibe_id, observaciones, forzada, motivo_forzado, avisos, soporte_ruta, propuesta_ia)
  values (v_id, v_codigo, v_area, v_ubic, v_fecha, v_prov, v_soporte, v_doc, v_recibe,
          nullif(trim(p ->> 'observaciones'), ''), cardinality(b) > 0,
          case when cardinality(b) > 0 then v_motivo end, a, v_ruta,
          case when jsonb_typeof(p -> 'propuesta_ia') = 'object' then p -> 'propuesta_ia' end);

  for v_lin, v_n in select e.value, e.ordinality from jsonb_array_elements(p -> 'lineas') with ordinality e
  loop
    select pr.id, pr.contenido_base, pr.generico_id, c.exige_sello, g.conservacion,
           privado.temp_max(g.conservacion, g.temp_max_llegada) as tmax
      into v_prod
      from public.productos pr join public.genericos g on g.id = pr.generico_id
      left join public.categorias c on c.codigo = g.categoria
     where pr.id = (v_lin ->> 'producto_id')::uuid;
    v_rec   := privado.num_o_null(v_lin ->> 'cantidad_recibida');
    v_ped   := privado.num_o_null(v_lin ->> 'cantidad_pedida');
    v_valor := privado.num_o_null(v_lin ->> 'valor_total');
    v_cont  := coalesce(privado.num_o_null(v_lin ->> 'contenido_base'), v_prod.contenido_base);
    v_cond  := coalesce(nullif(v_lin ->> 'condicion', ''), 'OK');
    v_temp  := privado.num_o_null(v_lin ->> 'temperatura');
    v_hall  := '{}';
    if v_rec > 0 and (v_valor is null or v_valor <= 0) then v_hall := v_hall || 'H03'::text; end if;
    if v_rec = 0 and v_cond = 'OK' then v_hall := v_hall || 'H06'::text; end if;
    if v_cond = 'NO_LLEGO' and v_rec > 0 then v_hall := v_hall || 'H07'::text; end if;
    if v_ped is not null and v_ped <> v_rec and coalesce(trim(v_lin ->> 'observaciones'), '') = '' then v_hall := v_hall || 'H08'::text; end if;
    if exists (select 1 from unnest(b) x where x like 'B10 · Línea ' || v_n || ' %') then v_hall := v_hall || 'H09'::text; end if;
    if coalesce(v_prod.exige_sello, false) and nullif(v_lin ->> 'sello', '') is null then v_hall := v_hall || 'H10'::text; end if;
    if v_temp > v_prod.tmax and v_prod.conservacion in ('Refrigerado', 'Congelado') then v_hall := v_hall || 'H11'::text; end if;
    if exists (select 1 from unnest(b) x where x like 'B7 · Línea ' || v_n || ' %') then v_hall := v_hall || 'H12'::text; end if;

    insert into public.recepcion_lineas (recepcion_id, linea, producto_id, cantidad_pedida, cantidad_recibida,
                                         contenido_base, valor_total, condicion, sello, vencimiento,
                                         lote_proveedor, temperatura, observaciones, hallazgos, nombre_factura, origen)
    values (v_id, v_n, v_prod.id, v_ped, v_rec, v_cont, v_valor, v_cond, nullif(v_lin ->> 'sello', ''),
            privado.fecha_o_null(v_lin ->> 'vencimiento'), nullif(v_lin ->> 'lote_proveedor', ''),
            v_temp, nullif(trim(v_lin ->> 'observaciones'), ''), v_hall,
            nullif(trim(v_lin ->> 'nombre_factura'), ''), coalesce(nullif(v_lin ->> 'origen', ''), 'MANUAL'))
    returning id, cantidad_base, costo_unitario_base into v_linea_id, v_base, v_cu;

    -- el kardex recalcula el promedio ponderado móvil con el costo de esta compra
    if v_base > 0 then
      perform privado.registrar_movimiento('ENTRADA_COMPRA', v_prod.id, v_ubic, v_base, v_fecha, v_cu,
                                           'RECEPCION', v_id, v_linea_id);
    end if;

    -- lo que el sistema ya sabe no se vuelve a digitar: el nombre de la factura queda como alias
    if nullif(trim(v_lin ->> 'nombre_factura'), '') is not null then
      insert into public.alias (fuente, alias, generico_id, producto_id)
      values ('RECEPCION', trim(v_lin ->> 'nombre_factura'), v_prod.generico_id, v_prod.id)
      on conflict do nothing;
    end if;
  end loop;

  perform privado.bitacora('RECEPCIÓN GUARDADA', 'recepciones', v_codigo,
                           jsonb_build_object('lineas', jsonb_array_length(p -> 'lineas'), 'forzada', cardinality(b) > 0,
                                              'bloqueos', to_jsonb(b), 'con_foto', v_ruta is not null,
                                              'lineas_ia', (select count(*) from jsonb_array_elements(p -> 'lineas') x
                                                             where x ->> 'origen' like 'IA_%')),
                           case when cardinality(b) > 0 then v_motivo end);
  return privado.resultado(true, v_id, v_codigo, f, b, a);
end
$$;

-- =====================================================================================
-- Proveedor leído de una factura: si ya existe (mismo NIT o mismo nombre) lo devuelve; si no,
-- lo crea. Puede llamarla quien recibe mercancía en el área. Devuelve {id, nombre, creado, activo}.
-- =====================================================================================
create or replace function public.proveedor_desde_factura(p_area public.area_app, p_nombre text, p_nit text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_nombre text := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_nit    text := nullif(regexp_replace(coalesce(p_nit, ''), '[^0-9-]', '', 'g'), '');
  v_dig    text := left(regexp_replace(coalesce(p_nit, ''), '\D', '', 'g'), 9);   -- sin dígito de verificación
  v_p      record;
begin
  if not privado.puede_operar(p_area) then
    raise exception 'Sin permiso para recibir en %.', p_area using errcode = '42501';
  end if;
  -- «DISTRIBUIDORA LR» → «Distribuidora Lr»: los nombres en mayúsculas sostenidas se suavizan
  if v_nombre = upper(v_nombre) then v_nombre := initcap(v_nombre); end if;
  if length(v_nombre) < 3 then raise exception 'El nombre del proveedor es muy corto: «%».', v_nombre; end if;

  select pr.id, pr.nombre, pr.activo into v_p from public.proveedores pr
   where pr.nombre_norm = privado.normalizar(v_nombre)
      or (length(v_dig) >= 6 and left(regexp_replace(coalesce(pr.nit, ''), '\D', '', 'g'), 9) = v_dig)
   order by (pr.nombre_norm = privado.normalizar(v_nombre)) desc
   limit 1;
  if found then
    return jsonb_build_object('id', v_p.id, 'nombre', v_p.nombre, 'creado', false, 'activo', v_p.activo);
  end if;

  insert into public.proveedores (nombre, nit) values (v_nombre, v_nit)
  on conflict (nombre_norm) do nothing
  returning id, nombre, activo into v_p;
  if v_p.id is null then   -- otro equipo lo creó al mismo tiempo
    select pr.id, pr.nombre, pr.activo into v_p from public.proveedores pr where pr.nombre_norm = privado.normalizar(v_nombre);
    return jsonb_build_object('id', v_p.id, 'nombre', v_p.nombre, 'creado', false, 'activo', v_p.activo);
  end if;
  perform privado.bitacora('PROVEEDOR CREADO DESDE FACTURA', 'proveedores', v_p.id::text,
                           jsonb_build_object('nombre', v_nombre, 'nit', v_nit, 'area', p_area));
  return jsonb_build_object('id', v_p.id, 'nombre', v_p.nombre, 'creado', true, 'activo', true);
end
$$;

revoke execute on function public.proveedor_desde_factura(public.area_app, text, text) from public, anon;
grant execute on function public.proveedor_desde_factura(public.area_app, text, text) to authenticated;
