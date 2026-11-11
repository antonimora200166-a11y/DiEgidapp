-- =====================================================================================
-- SGI Di Égida · Botellas del bar: conteo semanal, tara desde el conteo y consumo por cóctel
-- (07/11/2026). Decisiones de Anthony:
--   · Las botellas de licor y vino se cuentan en el inventario: las cerradas por unidad y la
--     abierta pesándola. Todo queda en ml y se valora al costo de compra (costo promedio).
--   · Las botellas se cuentan cada semana, para ver su consumo frente a los cócteles.
-- 1. Conteo semanal: en el bar, los licores y vinos tocan cada FRECUENCIA_CONTEO_BOTELLAS_DIAS
--    (7), o antes si su clase ABC pide menos días. Las categorías salen de
--    CATEGORIAS_CONTEO_SEMANAL ('LICOR,VINO').
-- 2. Densidad típica donde falta (marcada como estimada) y registrar_tara: el que cuenta registra
--    la tara pesando la botella vacía o una llena y sellada (tara = peso − contenido × densidad).
--    Una tara ya registrada solo la cambia quien edita el catálogo del área.
-- 3. El detalle del período trae, por insumo, cuánto del teórico salió de cada cóctel, shot o
--    botella (desglose).
-- =====================================================================================

-- ---------------------------------------------------------------- 1. frecuencia semanal
insert into public.parametros (clave, valor, descripcion) values
  ('FRECUENCIA_CONTEO_BOTELLAS_DIAS', '7', 'Cada cuántos días se cuentan las botellas del bar (cerradas y abiertas), sin importar la clase ABC.'),
  ('CATEGORIAS_CONTEO_SEMANAL', 'LICOR,VINO', 'Categorías del bar que se cuentan con la frecuencia de botellas (separadas por coma).')
on conflict do nothing;

create or replace function privado.dias_entre_conteos(p_clase public.clase_abc, p_categoria text, p_area public.area_app)
returns integer
language sql stable security definer set search_path = ''
as $$
  select case
    when p_area = 'BAR' and p_categoria = any (string_to_array(replace(coalesce(privado.parametro('CATEGORIAS_CONTEO_SEMANAL'), 'LICOR,VINO'), ' ', ''), ','))
      then least(privado.dias_entre_conteos(p_clase), privado.parametro_num('FRECUENCIA_CONTEO_BOTELLAS_DIAS', 7)::integer)
    else privado.dias_entre_conteos(p_clase) end
$$;
revoke execute on function privado.dias_entre_conteos(public.clase_abc, text, public.area_app) from public;

-- La hoja de conteo usa la frecuencia por categoría. Se cambia solo esa expresión (y se agrega
-- el código de categoría a la consulta); si el texto no aparece, la migración falla.
do $$
declare v_def text; v_nueva text;
begin
  v_def := pg_get_functiondef('public.hoja_conteo(text)'::regprocedure);
  v_nueva := replace(v_def, 'coalesce(c.nombre, ''Sin categoría'') as cat,', 'coalesce(c.nombre, ''Sin categoría'') as cat, g.categoria as cat_codigo,');
  v_nueva := replace(v_nueva, 'privado.dias_entre_conteos(b.clase_abc)', 'privado.dias_entre_conteos(b.clase_abc, b.cat_codigo, v_area)');
  if v_nueva = v_def or position('cat_codigo, v_area' in v_nueva) = 0 or position('as cat_codigo' in v_nueva) = 0 then
    raise exception 'No se encontró la frecuencia ABC en hoja_conteo.';
  end if;
  execute v_nueva;
end
$$;

-- ---------------------------------------------------------------- 2. densidad y tara
alter table public.taras add column if not exists densidad_estimada boolean not null default false;
comment on column public.taras.densidad_estimada is
  'true: la densidad es un valor típico del tipo de licor, no medida. Sirve para pesar, pero conviene confirmarla.';

-- Densidad típica (g/ml) según el tipo de bebida: destilados ~40 % = 0,95; licores dulces = 1,04;
-- cremas = 1,05; vinos y espumantes = 0,99; alcohol de 80° = 0,87.
create or replace function privado.densidad_tipica(p_nombre text, p_categoria text)
returns numeric
language sql immutable set search_path = ''
as $$
  select case
    when p_categoria = 'VINO' or p_nombre ~* '(^|\s)vino|champ|espum|prosecco|lambrusco' then 0.99
    when p_nombre ~* '80\s*°' then 0.87
    when p_nombre ~* 'crema|baileys|velvet|cream' then 1.05
    when p_nombre ~* 'licor de|amaretto|triple sec|curazao|limoncello|sambuca|j[äa]ger|cointreau|vermouth|aperol|campari' then 1.04
    else 0.95 end
$$;

insert into public.taras (producto_id, densidad_g_ml, densidad_estimada)
select p.id, privado.densidad_tipica(g.nombre, g.categoria), true
  from public.productos p join public.genericos g on g.id = p.generico_id
 where g.area = 'BAR' and g.unidad_base = 'ml' and g.categoria in ('LICOR', 'VINO')
   and not exists (select 1 from public.taras t where t.producto_id = p.id)
on conflict (producto_id) do nothing;
update public.taras t set densidad_g_ml = privado.densidad_tipica(g.nombre, g.categoria), densidad_estimada = true
  from public.productos p join public.genericos g on g.id = p.generico_id
 where t.producto_id = p.id and t.densidad_g_ml is null
   and g.area = 'BAR' and g.unidad_base = 'ml' and g.categoria in ('LICOR', 'VINO');

-- p: {producto_id, modo: 'VACIA' | 'LLENA', peso_g, densidad?}
create or replace function public.registrar_tara(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prod record; v_t public.taras%rowtype;
  v_modo text := upper(coalesce(p ->> 'modo', ''));
  v_peso numeric := privado.num_o_null(p ->> 'peso_g');
  v_dens numeric := privado.num_o_null(p ->> 'densidad');
  v_d numeric; v_tara numeric; v_lleno numeric;
begin
  select pr.id, pr.codigo, pr.contenido_base, pr.contenido_variable, g.id as generico_id, g.nombre, g.area, g.unidad_base::text as ub, g.categoria
    into v_prod
    from public.productos pr join public.genericos g on g.id = pr.generico_id
   where pr.id = privado.uuid_o_null(p ->> 'producto_id') and pr.activo and g.activo;
  if v_prod.id is null then return jsonb_build_object('ok', false, 'error', 'Producto no encontrado.'); end if;
  if not privado.puede_operar(v_prod.area) then
    raise exception 'Sin permiso para registrar taras de %.', v_prod.area using errcode = '42501';
  end if;
  if v_prod.ub not in ('ml', 'g') then
    return jsonb_build_object('ok', false, 'error', v_prod.nombre || ' se cuenta en ' || v_prod.ub || ': no se pesa.');
  end if;
  if v_modo not in ('VACIA', 'LLENA') then return jsonb_build_object('ok', false, 'error', 'Escoge si pesaste la botella vacía o llena.'); end if;
  if v_peso is null or v_peso <= 0 or v_peso > 6000 then
    return jsonb_build_object('ok', false, 'error', 'Escribe el peso en gramos (entre 1 y 6.000).');
  end if;
  if v_dens is not null and (v_dens < 0.5 or v_dens > 2) then
    return jsonb_build_object('ok', false, 'error', 'La densidad va entre 0,5 y 2 g/ml.');
  end if;

  select * into v_t from public.taras where producto_id = v_prod.id;
  if v_t.tara_g is not null and not privado.edita_generico(v_prod.generico_id) then
    return jsonb_build_object('ok', false, 'error', v_prod.nombre || ' ya tiene tara (' || v_t.tara_g || ' g): solo el jefe del área la cambia.');
  end if;

  v_d := case when v_prod.ub = 'g' then 1 else coalesce(v_dens, v_t.densidad_g_ml, privado.densidad_tipica(v_prod.nombre, v_prod.categoria)) end;
  if v_modo = 'VACIA' then
    v_tara := v_peso;
  else
    if v_prod.contenido_base is null or v_prod.contenido_variable then
      return jsonb_build_object('ok', false, 'error', 'Esta presentación no tiene un contenido fijo: pesa la botella vacía.');
    end if;
    v_lleno := v_prod.contenido_base * v_d;
    v_tara := round(v_peso - v_lleno);
    if v_tara < 50 then
      return jsonb_build_object('ok', false, 'error',
        'Con ' || v_peso || ' g la botella pesaría menos que su contenido (' || round(v_lleno) || ' g de ' || v_prod.contenido_base || ' '
        || v_prod.ub || '). Revisa que esté llena y sellada, y que sea la presentación correcta.');
    end if;
  end if;

  insert into public.taras (producto_id, tara_g, densidad_g_ml, densidad_estimada, medido_por, medido_en)
  values (v_prod.id, v_tara, case when v_prod.ub = 'ml' then v_d end,
          case when v_prod.ub = 'ml' then v_dens is null and coalesce(v_t.densidad_estimada, v_t.densidad_g_ml is null) end,
          auth.uid(), privado.hoy())
  on conflict (producto_id) do update
    set tara_g = excluded.tara_g, densidad_g_ml = excluded.densidad_g_ml, densidad_estimada = excluded.densidad_estimada,
        medido_por = excluded.medido_por, medido_en = excluded.medido_en;

  perform privado.bitacora('TARA REGISTRADA', 'taras', v_prod.codigo,
    jsonb_build_object('modo', v_modo, 'peso_g', v_peso, 'tara_g', v_tara, 'densidad', v_d, 'antes_g', v_t.tara_g));
  return jsonb_build_object('ok', true, 'tara_g', v_tara, 'densidad', v_d,
    'mensaje', 'Tara de ' || v_prod.nombre || ': ' || v_tara || ' g' ||
               case when v_modo = 'LLENA' then ' (calculada con ' || v_prod.contenido_base || ' ' || v_prod.ub || ' × ' || v_d || ' g/ml)' else '' end || '.');
end
$$;
revoke execute on function public.registrar_tara(jsonb) from public, anon;
grant execute on function public.registrar_tara(jsonb) to authenticated;

-- ---------------------------------------------------------------- 3. desglose del teórico por cóctel
-- p_insumos: el detalle por insumo del período; p_fichas: [{generico_id, unidades, completa, lineas}].
-- A cada insumo le agrega desglose: [{generico_id, nombre, unidades, q}] de mayor a menor.
create or replace function privado.insumos_con_desglose(p_insumos jsonb, p_fichas jsonb)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with d as (
    select l ->> 'generico_id' as ins, (f ->> 'generico_id')::uuid as fid, (f ->> 'unidades')::numeric as u,
           sum((f ->> 'unidades')::numeric * (l ->> 'cantidad_base')::numeric) as q
      from jsonb_array_elements(coalesce(p_fichas, '[]')) f
      cross join lateral jsonb_array_elements(coalesce(f -> 'lineas', '[]')) l
     where coalesce((f ->> 'completa')::boolean, false) and l ->> 'cantidad_base' is not null
     group by 1, 2, 3),
  a as (
    select d.ins, jsonb_agg(jsonb_build_object('generico_id', d.fid, 'nombre', g.nombre, 'unidades', d.u, 'q', round(d.q, 2))
                            order by d.q desc, g.nombre) as des
      from d join public.genericos g on g.id = d.fid group by d.ins)
  select coalesce(jsonb_agg(x.i || jsonb_build_object('desglose', coalesce(a.des, '[]')) order by x.n), '[]')
    from jsonb_array_elements(coalesce(p_insumos, '[]')) with ordinality x(i, n)
    left join a on a.ins = x.i ->> 'generico_id'
$$;
revoke execute on function privado.insumos_con_desglose(jsonb, jsonb) from public;

create or replace function public.periodo_detalle(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.ve_precios() then
    raise exception 'Sin permiso: Consulta es de administración.' using errcode = '42501';
  end if;
  return (select p.resumen || jsonb_build_object('id', p.id, 'cerrado_en', p.cerrado_en, 'forzado', p.forzado, 'motivo_forzado', p.motivo_forzado,
            'insumos', privado.insumos_con_desglose(
              coalesce((select jsonb_agg(to_jsonb(i) - 'periodo_id' order by abs(i.dif_valor) desc, i.nombre) from public.periodo_insumos i where i.periodo_id = p.id), '[]'),
              coalesce((select jsonb_agg(jsonb_build_object('generico_id', pf.generico_id, 'unidades', pf.unidades, 'completa', pf.completa, 'lineas', pf.lineas))
                          from public.periodo_fichas pf where pf.periodo_id = p.id), '[]')))
            from public.periodos p where p.id = p_id);
end
$$;

create or replace function public.periodo_vivo(p_area public.area_app, p_desde date, p_hasta date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  if not privado.ve_precios() then
    raise exception 'Sin permiso: Consulta es de administración.' using errcode = '42501';
  end if;
  v := privado.periodo_calcular(p_area, p_desde, p_hasta);
  return (v -> 'resumen') || jsonb_build_object('insumos', privado.insumos_con_desglose(v -> 'insumos', v -> 'fichas'));
end
$$;
