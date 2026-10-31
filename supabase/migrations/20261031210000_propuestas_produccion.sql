-- =====================================================================================
-- SGI Di Égida · 24 · Propuestas desde el registro de producción de cocina
-- Las propuestas de /catalogo/unidades ahora también pueden traer presentación («Porción 200 g»),
-- conservación (Ambiente, Refrigerado, Congelado) y vida útil en días, que salen del registro de
-- producción REG-COC-007 (scripts/migracion/proponer_produccion.mjs, fuente REGISTRO-PRODUCCION).
-- Una propuesta de unidad pendiente que queda superada por la del registro pasa a REEMPLAZADA:
-- no la decidió nadie, simplemente hay una mejor.
-- =====================================================================================

alter table public.propuestas_unidad drop constraint propuestas_unidad_estado_check;
alter table public.propuestas_unidad add constraint propuestas_unidad_estado_check
  check (estado in ('PENDIENTE', 'ACEPTADA', 'CORREGIDA', 'RECHAZADA', 'REEMPLAZADA'));

drop function public.lista_propuestas_unidad();
create or replace function public.lista_propuestas_unidad()
returns table (id uuid, producto_id uuid, codigo text, generico text, marca text, presentacion text, area public.area_app,
               tipo public.tipo_generico, cambios jsonb, actual jsonb, categoria_propuesta text, seguridad text, razon text,
               estado text, mensaje text, decidido_por text, decidido_en timestamptz, fuente text)
language sql stable security definer set search_path = ''
as $$
  select pu.id, p.id, p.codigo, g.nombre, p.marca, p.presentacion, g.area, g.tipo, pu.cambios, pu.actual,
         (select c.nombre from public.categorias c where c.codigo = pu.cambios ->> 'categoria'),
         pu.seguridad, pu.razon, pu.estado, pu.mensaje, pe.nombre, pu.decidido_en, pu.fuente
    from public.propuestas_unidad pu
    join public.productos p on p.id = pu.producto_id
    join public.genericos g on g.id = p.generico_id
    left join public.perfiles pe on pe.id = pu.decidido_por
   where privado.tiene_rol('admin', 'auditor') or privado.edita_area(g.area)
   order by case pu.estado when 'PENDIENTE' then 0 else 1 end, g.area, g.nombre, p.marca, p.presentacion
$$;

create or replace function public.decidir_propuestas_unidad(p_ids uuid[], p_decision text, p_correccion jsonb default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_dec  text := upper(trim(coalesce(p_decision, '')));
  v_pu   record;
  c      jsonb;
  g      jsonb; x jsonb;
  v_uc   text;
  v_r    jsonb;
  v_ok   int := 0; v_mal int := 0;
  v_det  jsonb := '[]';
  v_msg  text;
begin
  if v_dec not in ('ACEPTAR', 'RECHAZAR') then raise exception 'La decisión debe ser ACEPTAR o RECHAZAR.'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 then raise exception 'No hay propuestas seleccionadas.'; end if;
  if cardinality(p_ids) > 500 then raise exception 'Máximo 500 propuestas por vez.'; end if;
  if p_correccion is not null and cardinality(p_ids) <> 1 then raise exception 'Una corrección se aplica a una propuesta a la vez.'; end if;

  for v_pu in
    select pu.*, p.codigo, p.unidad_compra as uc_actual, g.area
      from public.propuestas_unidad pu join public.productos p on p.id = pu.producto_id join public.genericos g on g.id = p.generico_id
     where pu.id = any (p_ids) order by g.nombre for update of pu
  loop
    if not privado.edita_area(v_pu.area) then
      v_mal := v_mal + 1;
      v_det := v_det || jsonb_build_object('id', v_pu.id, 'codigo', v_pu.codigo, 'ok', false, 'mensaje', 'Solo el jefe del área o administración deciden.');
      continue;
    end if;
    if v_pu.estado <> 'PENDIENTE' then
      v_det := v_det || jsonb_build_object('id', v_pu.id, 'codigo', v_pu.codigo, 'ok', true, 'mensaje', 'Ya estaba decidida.');
      continue;
    end if;

    if v_dec = 'RECHAZAR' then
      update public.propuestas_unidad set estado = 'RECHAZADA', decidido_por = auth.uid(), decidido_en = now(), mensaje = null
       where id = v_pu.id;
      v_ok := v_ok + 1;
      v_det := v_det || jsonb_build_object('id', v_pu.id, 'codigo', v_pu.codigo, 'ok', true);
      continue;
    end if;

    c := coalesce(p_correccion, v_pu.cambios);
    g := jsonb_strip_nulls(jsonb_build_object('unidad_base', c -> 'unidad_base', 'categoria', c -> 'categoria',
                                              'conservacion', c -> 'conservacion'));
    x := jsonb_strip_nulls(jsonb_build_object('unidad_compra', c -> 'unidad_compra', 'contenido_base', c -> 'contenido_base',
                                              'contenido_variable', c -> 'contenido_variable', 'presentacion', c -> 'presentacion'));
    -- unidades de compra largas de la migración (PAQUETE, BANDEJA…) no pasan la regla de 6 letras
    v_msg := null;
    if not (x ? 'unidad_compra') and coalesce(v_pu.uc_actual, '') !~ '^[A-Z]{1,6}$' then
      v_uc := case upper(v_pu.uc_actual) when 'PAQUETE' then 'PAQ' when 'BANDEJA' then 'BAND' when 'BOTELLA' then 'BOT'
                                         when 'PORCION' then 'PORC' when 'UNIDADES' then 'UND'
                                         else left(regexp_replace(upper(coalesce(v_pu.uc_actual, 'UND')), '[^A-Z]', '', 'g'), 6) end;
      x := x || jsonb_build_object('unidad_compra', coalesce(nullif(v_uc, ''), 'UND'));
      v_msg := 'Unidad de compra ' || v_pu.uc_actual || ' → ' || coalesce(nullif(v_uc, ''), 'UND') || '.';
    end if;
    -- pasar a contenido fijo sin decir cuánto no se puede: se deja variable
    if (x ->> 'contenido_variable') = 'false' and not (x ? 'contenido_base') then x := x - 'contenido_variable'; end if;

    begin
      v_r := public.editar_producto(jsonb_build_object('id', v_pu.producto_id, 'generico', g, 'producto', x));
    exception when others then
      v_r := privado.resultado(false, null, null, array[sqlerrm], '{}', '{}');
    end;

    if (v_r ->> 'ok')::boolean then
      -- la vida útil es del genérico y editar_producto no la lleva
      if privado.num_o_null(c ->> 'vida_util_dias') > 0 then
        update public.genericos set vida_util_dias = round((c ->> 'vida_util_dias')::numeric)
         where id = (select p.generico_id from public.productos p where p.id = v_pu.producto_id)
           and vida_util_dias is distinct from round((c ->> 'vida_util_dias')::numeric);
        g := g || jsonb_build_object('vida_util_dias', round((c ->> 'vida_util_dias')::numeric));
      end if;
      update public.propuestas_unidad
         set estado = case when p_correccion is null then 'ACEPTADA' else 'CORREGIDA' end,
             aplicado = jsonb_build_object('generico', g, 'producto', x), decidido_por = auth.uid(), decidido_en = now(),
             mensaje = nullif(concat_ws(' ', v_msg, (select string_agg(m, ' ') from jsonb_array_elements_text(v_r -> 'avisos') m)), '')
       where id = v_pu.id;
      v_ok := v_ok + 1;
      v_det := v_det || jsonb_build_object('id', v_pu.id, 'codigo', v_pu.codigo, 'ok', true);
    else
      v_msg := (select string_agg(m, ' ') from jsonb_array_elements_text(v_r -> 'fatales') m);
      update public.propuestas_unidad set mensaje = v_msg where id = v_pu.id;
      v_mal := v_mal + 1;
      v_det := v_det || jsonb_build_object('id', v_pu.id, 'codigo', v_pu.codigo, 'ok', false, 'mensaje', v_msg);
    end if;
  end loop;

  perform privado.bitacora('PROPUESTAS DE UNIDAD ' || v_dec, 'propuestas_unidad', null,
                           jsonb_build_object('ok', v_ok, 'fallidos', v_mal, 'corregida', p_correccion is not null));
  return jsonb_build_object('ok', v_ok, 'fallidos', v_mal, 'detalle', v_det);
end
$$;

revoke execute on function public.lista_propuestas_unidad() from public, anon;
grant execute on function public.lista_propuestas_unidad() to authenticated;
