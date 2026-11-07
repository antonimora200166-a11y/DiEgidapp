-- =====================================================================================
-- SGI Di Égida · Los pesos solo los ve administración (decisión de Anthony, 06–07/11/2026)
-- «Todo lo relacionado con precios de todo el establecimiento lo veo solo yo.» El jefe de barra,
-- el chef, sus auxiliares, servicio y el auditor siguen viendo cantidades, recetas, rendimientos y
-- registros, pero ningún costo, valor ni precio. Excepción: en Recibir escriben el valor de la
-- factura (lo tienen en la mano); no ven el costo promedio ni la referencia de precio.
--
-- Cómo, sin reescribir cada función:
--   1. Las funciones públicas que devuelven pesos pasan a privado.<nombre>_completo y en su lugar
--      queda una función pública con la misma firma que llama a la completa y deja en null las
--      columnas de pesos (numéricas llamadas costo…, valor…, precio…, margen…) si quien pregunta no
--      es administración. Las respuestas jsonb pasan por privado.pesos_visibles().
--      Por dentro la base sigue calculando con los valores reales: las funciones que usaban
--      public.costo_ficha pasan a usar privado.costo_ficha_completo.
--   2. Tablas solo de pesos (costos, compras históricas, precios de carta, análisis de
--      proveedores): solo administración las lee.
--   3. Tablas con pesos y datos (kardex, lotes, recepciones): quien entra a la app lee sus filas
--      pero no las columnas de pesos (permiso por columna). Las vistas v_existencias y v_kardex
--      se rehacen con los pesos enmascarados.
--   4. Cargar precios desde fotos y fijar el costo de referencia: solo administración.
-- =====================================================================================

-- ---------------------------------------------------------------- qué es un campo de pesos
create or replace function privado.es_campo_pesos(p_nombre text)
returns boolean
language sql immutable
as $$
  select p_nombre ~* '(^|_)(costo|valor|precio|margen|monto)'
     and p_nombre !~* '^(lineas|n|con|sin|hay|tiene|estado|clase|fuente|motivo|origen)_'
$$;

create or replace function privado.sin_pesos(p jsonb)
returns jsonb
language plpgsql immutable
as $$
declare r jsonb; k text; v jsonb;
begin
  case jsonb_typeof(p)
    when 'object' then
      r := '{}'::jsonb;
      for k, v in select * from jsonb_each(p) loop
        if jsonb_typeof(v) = 'number' and privado.es_campo_pesos(k) then
          r := r || jsonb_build_object(k, null);
        else
          r := r || jsonb_build_object(k, privado.sin_pesos(v));
        end if;
      end loop;
      return r;
    when 'array' then
      return coalesce((select jsonb_agg(privado.sin_pesos(e) order by o) from jsonb_array_elements(p) with ordinality x(e, o)), '[]'::jsonb);
    else
      return p;
  end case;
end
$$;

create or replace function privado.pesos_visibles(p jsonb)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when privado.ve_precios() then p else privado.sin_pesos(p) end
$$;

-- ---------------------------------------------------------------- 1. funciones que devuelven pesos
do $$
declare
  v_nombre text; v_oid oid; v_args text; v_ident text; v_res text; v_vol text; v_llamada text;
  v_cols text; v_cuerpo text; v_def text; v_nueva text; v_f text;
  v_tabla text[] := array['costo_ficha', 'catalogo_filtrado', 'compras_por_proveedor', 'historial_documentos',
                          'lista_verificacion', 'lotes_lista', 'lotes_sin_costo', 'pedido_sugerido',
                          'produccion_fichas', 'productos_recepcion', 'saldos_area'];
  v_json text[]  := array['datos_produccion', 'detalle_documento', 'estado_arranque', 'ficha_para_editar',
                          'lote_etiqueta', 'traza_lote', 'registrar_lote', 'registrar_recepcion',
                          'dependencia_proveedores', 'propuesta_receta', 'validacion_mpi',
                          'validacion_recetario_resumen'];
begin
  foreach v_nombre in array v_tabla || v_json loop
    select p.oid, pg_get_function_arguments(p.oid), pg_get_function_identity_arguments(p.oid),
           pg_get_function_result(p.oid), case p.provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end,
           (select string_agg('$' || i, ', ' order by i) from generate_series(1, p.pronargs) i)
      into v_oid, v_args, v_ident, v_res, v_vol, v_llamada
      from pg_proc p where p.proname = v_nombre and p.pronamespace = 'public'::regnamespace;
    if v_oid is null then raise exception 'No existe public.%', v_nombre; end if;

    execute format('alter function public.%I(%s) rename to %I', v_nombre, v_ident, v_nombre || '_completo');
    execute format('alter function public.%I(%s) set schema privado', v_nombre || '_completo', v_ident);
    execute format('revoke execute on function privado.%I(%s) from public, anon, authenticated', v_nombre || '_completo', v_ident);

    if v_nombre = any (v_tabla) then
      select string_agg(case when t.typname = 'numeric' and privado.es_campo_pesos(a.nombre)
                             then format('case when privado.ve_precios() then t.%I end', a.nombre)
                             else format('t.%I', a.nombre) end, ', ' order by a.n)
        into v_cols
        from pg_proc p
        cross join lateral unnest(p.proallargtypes, p.proargmodes, p.proargnames) with ordinality a(tipo, modo, nombre, n)
        join pg_type t on t.oid = a.tipo
       where p.oid = v_oid and a.modo = 't';
      v_cuerpo := format('select %s from privado.%I(%s) t', v_cols, v_nombre || '_completo', coalesce(v_llamada, ''));
    else
      v_cuerpo := format('select privado.pesos_visibles(privado.%I(%s))', v_nombre || '_completo', coalesce(v_llamada, ''));
    end if;

    execute format('create function public.%I(%s) returns %s language sql %s security definer set search_path = '''' as %L',
                   v_nombre, v_args, v_res, v_vol, v_cuerpo);
    execute format('comment on function public.%I(%s) is %L', v_nombre, v_ident,
                   'Pesos solo para administración: llama a privado.' || v_nombre || '_completo y deja los pesos en null a los demás.');
    execute format('revoke execute on function public.%I(%s) from public, anon', v_nombre, v_ident);
    execute format('grant execute on function public.%I(%s) to authenticated', v_nombre, v_ident);
  end loop;

  -- quien calculaba con public.costo_ficha sigue calculando con los valores completos
  -- (registrar_lote guarda el costo del lote aunque lo registre el jefe de barra)
  for v_oid in select p.oid from pg_proc p
                where p.pronamespace in ('public'::regnamespace, 'privado'::regnamespace)
                  and p.prosrc like '%public.costo_ficha(%' and p.proname <> 'costo_ficha' loop
    v_def := pg_get_functiondef(v_oid);
    v_nueva := replace(v_def, 'public.costo_ficha(', 'privado.costo_ficha_completo(');
    execute v_nueva;
  end loop;
end
$$;

-- ---------------------------------------------------------------- 2. tablas solo de pesos
do $$
declare v_t text; v_p record;
begin
  foreach v_t in array array['costos_producto', 'costos_referencia', 'compras_historicas', 'precios_venta', 'analisis_proveedores'] loop
    for v_p in select polname from pg_policy where polrelid = ('public.' || v_t)::regclass and polcmd in ('r', '*') loop
      execute format('drop policy %I on public.%I', v_p.polname, v_t);
    end loop;
    execute format('create policy %I on public.%I for select to authenticated using (privado.ve_precios())', v_t || '_leer', v_t);
  end loop;
end
$$;
-- la escritura de referencia y precios ya era de administración (políticas de escritura intactas)
drop policy if exists costos_referencia_editar on public.costos_referencia;
create policy costos_referencia_editar on public.costos_referencia for all to authenticated
  using (privado.ve_precios()) with check (privado.ve_precios());

-- ---------------------------------------------------------------- 3. tablas con pesos y datos
-- Las filas se siguen leyendo; las columnas de pesos no (ni siquiera administración las lee
-- directo: lo hace por las funciones de la app).
do $$
declare v_t text; v_cols text;
begin
  foreach v_t in array array['movimientos', 'lotes_produccion', 'lote_consumos', 'recepcion_lineas',
                             'lotes_historicos', 'lote_historico_consumos', 'proveedor_productos', 'recetario_ingredientes'] loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
      from pg_attribute a join pg_type t on t.oid = a.atttypid
     where a.attrelid = ('public.' || v_t)::regclass and a.attnum > 0 and not a.attisdropped
       and not (t.typname = 'numeric' and privado.es_campo_pesos(a.attname));
    execute format('revoke select on public.%I from authenticated, anon', v_t);
    execute format('grant select (%s) on public.%I to authenticated', v_cols, v_t);
  end loop;
end
$$;

-- Vistas con los pesos enmascarados. Leen como su dueño (las columnas de pesos ya no se leen
-- directo), así que filtran el área ellas mismas, como hacían las políticas de las tablas.
drop view if exists public.v_existencias;
create view public.v_existencias as
select e.producto_id, p.codigo as producto_codigo, g.nombre as generico, p.marca, p.presentacion,
       g.unidad_base, g.area, e.ubicacion, e.cantidad,
       case when privado.ve_precios() then c.costo_promedio end as costo_promedio,
       case when privado.ve_precios() then e.cantidad * c.costo_promedio end as valor,
       coalesce(ca.nombre, 'Sin categoría') as categoria, p.clase_abc
  from public.existencias e
  join public.productos p on p.id = e.producto_id
  join public.genericos g on g.id = p.generico_id
  left join public.costos_producto c on c.producto_id = e.producto_id
  left join public.categorias ca on ca.codigo = g.categoria
 where privado.ve_area(g.area);

drop view if exists public.v_kardex;
create view public.v_kardex as
select m.id, m.fecha, m.registrado_en, m.tipo, p.codigo as producto_codigo, g.nombre as generico, p.marca,
       p.presentacion, g.unidad_base, m.ubicacion, m.cantidad,
       case when privado.ve_precios() then m.costo_unitario end as costo_unitario,
       case when privado.ve_precios() then m.costo_total end as costo_total,
       m.saldo_ubicacion, m.saldo_producto,
       case when privado.ve_precios() then m.costo_promedio end as costo_promedio,
       m.documento_tipo, m.documento_id, m.reversa_de, m.motivo, m.usuario_id
  from public.movimientos m
  join public.productos p on p.id = m.producto_id
  join public.genericos g on g.id = p.generico_id
 where privado.ve_area(g.area);

-- costo de fichas con precio: solo administración
drop view if exists public.v_costo_fichas;
create view public.v_costo_fichas as
select f.id as ficha_id, f.codigo, g.nombre as resultado, g.tipo, f.version, f.neto_esperado,
       t.total, t.lineas, t.lineas_con_costo, t.lineas = t.lineas_con_costo as completa,
       case when t.lineas = t.lineas_con_costo and f.neto_esperado > 0 then t.total / f.neto_esperado end as costo_por_unidad_neta,
       pv.precio_con_impuesto,
       case when t.lineas = t.lineas_con_costo and pv.precio_con_impuesto > 0
            then t.total / (pv.precio_con_impuesto / (1 + privado.parametro_num('IMPOCONSUMO_PCT', 8) / 100)) end as pct_costo,
       t.faltantes
  from public.fichas f
  join public.genericos g on g.id = f.generico_id
  cross join lateral (
    select coalesce(sum(c.costo), 0) as total, count(*) as lineas, count(*) filter (where c.falta is null) as lineas_con_costo,
           array_remove(array_agg(c.falta), null) as faltantes
      from privado.costo_ficha_completo(f.id) c) t
  left join lateral (
    select v.precio_con_impuesto from public.precios_venta v
     where v.generico_id = f.generico_id and v.vigente_desde <= privado.hoy()
     order by v.vigente_desde desc limit 1) pv on true
 where privado.ve_precios();

revoke all on public.v_existencias, public.v_kardex, public.v_costo_fichas from anon;
grant select on public.v_existencias, public.v_kardex, public.v_costo_fichas to authenticated;

-- ---------------------------------------------------------------- 4. cargar precios: solo administración
do $$
declare v_oid oid; v_def text; v_nueva text;
begin
  for v_oid in select p.oid from pg_proc p
                where p.pronamespace = 'public'::regnamespace and p.proname in ('guardar_precios_foto', 'fijar_costo') loop
    v_def := pg_get_functiondef(v_oid);
    v_nueva := regexp_replace(v_def, E'\\nbegin\\s*\\n',
      E'\nbegin\n  if not privado.ve_precios() then\n    raise exception ''Sin permiso: los precios los maneja administración.'' using errcode = ''42501'';\n  end if;\n', '');
    if v_nueva = v_def then raise exception 'No se pudo proteger la función %', v_oid::regprocedure; end if;
    execute v_nueva;
  end loop;
end
$$;
