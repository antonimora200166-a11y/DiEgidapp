-- =====================================================================================
-- SGI Di Égida · 23 · Propuestas de unidad del catálogo
-- La revisión del catálogo hecha con Claude (scripts/migracion/proponer_unidades.mjs) deja una
-- propuesta por producto: unidad base, unidad de compra, contenido, contenido variable y
-- categoría, con su razón y su seguridad. Nada cambia hasta que el jefe del área o
-- administración la acepta, la corrige o la rechaza en /catalogo/unidades.
-- Aceptar pasa por public.editar_producto con todas sus reglas (no cambia la unidad de lo que
-- ya tiene kardex o está en una ficha); si no se puede, la propuesta queda pendiente con el motivo.
-- =====================================================================================

create table public.propuestas_unidad (
  id            uuid primary key,
  producto_id   uuid not null references public.productos (id),
  cambios       jsonb not null,           -- {unidad_base?, unidad_compra?, contenido_base?, contenido_variable?, categoria?}
  actual        jsonb not null,           -- cómo estaba al proponer
  seguridad     text not null check (seguridad in ('ALTA', 'MEDIA', 'BAJA')),
  razon         text,
  fuente        text not null default 'CLAUDE',
  estado        text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'ACEPTADA', 'CORREGIDA', 'RECHAZADA')),
  aplicado      jsonb,                    -- lo que se aplicó de verdad (la propuesta o la corrección)
  mensaje       text,                     -- por qué no se pudo aplicar, o los avisos al aplicarla
  decidido_por  uuid references public.perfiles (id),
  decidido_en   timestamptz,
  creado_en     timestamptz not null default now()
);
create index propuestas_unidad_producto_idx on public.propuestas_unidad (producto_id);

create trigger propuestas_unidad_sin_borrado before delete on public.propuestas_unidad
  for each row execute function privado.bloquear_cambios();
alter table public.propuestas_unidad enable row level security;
revoke all on public.propuestas_unidad from anon;
revoke insert, update, delete, truncate on public.propuestas_unidad from authenticated;
create policy propuestas_unidad_leer on public.propuestas_unidad for select to authenticated
  using (privado.tiene_rol('admin', 'auditor')
         or privado.edita_generico((select p.generico_id from public.productos p where p.id = producto_id)));

-- ---------------------------------------------------------------- lista para la pantalla
create or replace function public.lista_propuestas_unidad()
returns table (id uuid, producto_id uuid, codigo text, generico text, marca text, presentacion text, area public.area_app,
               tipo public.tipo_generico, cambios jsonb, actual jsonb, categoria_propuesta text, seguridad text, razon text,
               estado text, mensaje text, decidido_por text, decidido_en timestamptz)
language sql stable security definer set search_path = ''
as $$
  select pu.id, p.id, p.codigo, g.nombre, p.marca, p.presentacion, g.area, g.tipo, pu.cambios, pu.actual,
         (select c.nombre from public.categorias c where c.codigo = pu.cambios ->> 'categoria'),
         pu.seguridad, pu.razon, pu.estado, pu.mensaje, pe.nombre, pu.decidido_en
    from public.propuestas_unidad pu
    join public.productos p on p.id = pu.producto_id
    join public.genericos g on g.id = p.generico_id
    left join public.perfiles pe on pe.id = pu.decidido_por
   where privado.tiene_rol('admin', 'auditor') or privado.edita_area(g.area)
   order by case pu.estado when 'PENDIENTE' then 0 else 1 end, g.area, g.nombre, p.marca, p.presentacion
$$;

-- ---------------------------------------------------------------- decidir
-- p_decision: ACEPTAR (aplica la propuesta, o p_correccion si viene) · RECHAZAR.
-- Devuelve {ok, fallidos, detalle: [{id, codigo, ok, mensaje}]}.
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
    g := jsonb_strip_nulls(jsonb_build_object('unidad_base', c -> 'unidad_base', 'categoria', c -> 'categoria'));
    x := jsonb_strip_nulls(jsonb_build_object('unidad_compra', c -> 'unidad_compra', 'contenido_base', c -> 'contenido_base',
                                              'contenido_variable', c -> 'contenido_variable'));
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

-- las propuestas se escriben solo con la función; la tabla no se toca directo
create trigger propuestas_unidad_auditar after update on public.propuestas_unidad
  for each row execute function privado.auditar();

revoke execute on function public.lista_propuestas_unidad(), public.decidir_propuestas_unidad(uuid[], text, jsonb) from public, anon;
grant execute on function public.lista_propuestas_unidad(), public.decidir_propuestas_unidad(uuid[], text, jsonb) to authenticated;
