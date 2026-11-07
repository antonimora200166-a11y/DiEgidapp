-- =====================================================================================
-- SGI Di Égida · Carta · Baúl de cócteles y platos que no se venden (Anthony, 07/11/2026)
-- Hay cócteles y platos que ya no se van a vender, pero su ficha se quiere guardar. Van al
-- «baúl»: el genérico y su ficha quedan intactos (nada se borra), pero dejan de salir en
-- Carta y margen, en Fichas técnicas y en los tableros de Validar fichas, para que no sumen
-- en promedios ni en avances. Se pueden sacar del baúl cuando vuelvan a la carta.
--   · genericos.en_baul / baul_desde / baul_motivo
--   · public.mover_al_baul(ids, motivo) y public.sacar_del_baul(ids): varios a la vez, con bitácora
--   · public.carta_baul(área): lo que está en el baúl
--   · carta_costos, lista_fichas, validacion_recetario_resumen y validacion_mpi dejan fuera el baúl
-- Solo cócteles/bebidas y platos. Decide quien edita el área (admin, jefe de barra, chef).
-- =====================================================================================

alter table public.genericos
  add column if not exists en_baul     boolean not null default false,
  add column if not exists baul_desde  timestamptz,
  add column if not exists baul_motivo text;

comment on column public.genericos.en_baul is
  'Cóctel o plato que no se vende: su ficha se guarda pero no sale en carta, fichas ni tableros.';

-- ---------------------------------------------------------------- las listas dejan fuera el baúl
-- Las cuatro funciones filtran con «g.activo and g.tipo …»: se les agrega «not g.en_baul» sin
-- reescribirlas. Si el texto no aparece (alguien cambió la función), la migración falla.
do $$
declare v_f text; v_def text; v_nueva text;
begin
  foreach v_f in array array[
    'public.carta_costos(public.area_app)', 'public.lista_fichas(public.area_app)',
    'public.validacion_recetario_resumen(text)', 'public.validacion_mpi(text)'] loop
    v_def := pg_get_functiondef(v_f::regprocedure);
    v_nueva := replace(v_def, 'g.activo and g.tipo', 'g.activo and not g.en_baul and g.tipo');
    if v_nueva = v_def then
      raise exception 'No se encontró el filtro de activos en %.', v_f;
    end if;
    execute v_nueva;
  end loop;
end
$$;

-- ---------------------------------------------------------------- mover y sacar
create or replace function public.mover_al_baul(p_genericos uuid[], p_motivo text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_g record; v_n int := 0; v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if coalesce(array_length(p_genericos, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Elige al menos un cóctel o plato.');
  end if;
  for v_g in select g.id, g.nombre, g.tipo, g.area, g.en_baul from public.genericos g
              where g.id = any (p_genericos) and g.activo order by g.nombre loop
    if v_g.tipo not in ('BEBIDA', 'PLATO') then
      return jsonb_build_object('ok', false, 'error', v_g.nombre || ' no es un cóctel ni un plato: solo la carta va al baúl.');
    end if;
    if not privado.edita_area(v_g.area) then
      raise exception 'Sin permiso para mover al baúl lo de %.', v_g.area using errcode = '42501';
    end if;
    if not v_g.en_baul then
      update public.genericos set en_baul = true, baul_desde = now(), baul_motivo = v_motivo where id = v_g.id;
      perform privado.bitacora('AL BAÚL', 'genericos', v_g.nombre, jsonb_build_object('generico_id', v_g.id), v_motivo);
      v_n := v_n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'movidos', v_n);
end
$$;

create or replace function public.sacar_del_baul(p_genericos uuid[])
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_g record; v_n int := 0;
begin
  for v_g in select g.id, g.nombre, g.area from public.genericos g
              where g.id = any (coalesce(p_genericos, '{}')) and g.en_baul order by g.nombre loop
    if not privado.edita_area(v_g.area) then
      raise exception 'Sin permiso para sacar del baúl lo de %.', v_g.area using errcode = '42501';
    end if;
    update public.genericos set en_baul = false, baul_desde = null, baul_motivo = null where id = v_g.id;
    perform privado.bitacora('SALE DEL BAÚL', 'genericos', v_g.nombre, jsonb_build_object('generico_id', v_g.id));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'sacados', v_n);
end
$$;

-- ---------------------------------------------------------------- lo que hay en el baúl
create or replace function public.carta_baul(p_area public.area_app)
returns table (generico_id uuid, nombre text, tipo public.tipo_generico, carta text, ficha_codigo text,
               precio numeric, desde timestamptz, motivo text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.ve_area(p_area) then
    raise exception 'Sin permiso para ver la carta de %.', p_area using errcode = '42501';
  end if;
  return query
  select g.id, g.nombre, g.tipo, nullif(trim(substring(g.nota from 'Carta: ([^·]+)')), ''),
         (select f.codigo from public.fichas f where f.id = privado.ficha_vigente(g.id)),
         (select v.precio_con_impuesto from public.precios_venta v
           where v.generico_id = g.id and v.vigente_desde <= privado.hoy() order by v.vigente_desde desc limit 1),
         g.baul_desde, g.baul_motivo
    from public.genericos g
   where g.area = p_area and g.activo and g.en_baul and g.tipo in ('BEBIDA', 'PLATO')
   order by g.nombre;
end
$$;

revoke execute on function public.mover_al_baul(uuid[], text), public.sacar_del_baul(uuid[]),
                           public.carta_baul(public.area_app) from public, anon;
grant execute on function public.mover_al_baul(uuid[], text), public.sacar_del_baul(uuid[]),
                          public.carta_baul(public.area_app) to authenticated;
