-- =====================================================================================
-- SGI Di Égida · 09 · Corregir un producto antes de validarlo · contraseña temporal
-- public.editar_producto: el jefe del área (o el admin) corrige genérico y presentación de un
--   producto y, si quiere, lo valida en el mismo paso. Lo que ya tiene historia no se rompe:
--   la unidad base de un genérico solo cambia si ningún producto suyo tiene movimientos y
--   ninguna ficha lo usa.
-- perfiles.debe_cambiar_clave: el usuario creado o restablecido por administración entra con
--   una contraseña temporal y la app le pide una propia. public.clave_cambiada la apaga.
-- =====================================================================================

alter table public.perfiles add column debe_cambiar_clave boolean not null default false;
comment on column public.perfiles.debe_cambiar_clave is
  'La contraseña la puso administración: al entrar, la app pide una nueva antes de seguir.';

create or replace function public.clave_cambiada()
returns void
language sql security definer set search_path = ''
as $$
  update public.perfiles set debe_cambiar_clave = false where id = auth.uid() and debe_cambiar_clave;
  select privado.bitacora('CONTRASEÑA CAMBIADA', 'perfiles', auth.uid()::text, null);
$$;

-- p: {id, validar?,
--     generico: {nombre?, tipo?, categoria?, unidad_base?, conservacion?, temp_max_llegada?},
--     producto: {marca?, presentacion?, unidad_compra?, contenido_base?, contenido_variable?}}
-- Solo cambia lo que viene en el jsonb. Devuelve privado.resultado.
create or replace function public.editar_producto(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prod   public.productos%rowtype;
  v_gen    public.genericos%rowtype;
  g        jsonb := coalesce(p -> 'generico', '{}');
  x        jsonb := coalesce(p -> 'producto', '{}');
  f text[] := '{}'; a text[] := '{}';
  v_nombre text; v_tipo public.tipo_generico; v_ub public.unidad_base; v_cat text; v_cons text; v_tmax numeric;
  v_marca text; v_pres text; v_ucompra text; v_cont numeric; v_var boolean;
  v_validar boolean := coalesce((p ->> 'validar')::boolean, false);
begin
  select * into v_prod from public.productos where id = nullif(p ->> 'id', '')::uuid for update;
  if v_prod.id is null then raise exception 'No existe el producto.'; end if;
  select * into v_gen from public.genericos where id = v_prod.generico_id for update;
  if not privado.edita_area(v_gen.area) then
    raise exception 'Solo el jefe de % o el admin corrigen productos.', v_gen.area using errcode = '42501';
  end if;

  -- ---------------------------------------------------------------- genérico
  v_nombre := coalesce(nullif(trim(g ->> 'nombre'), ''), v_gen.nombre);
  if length(v_nombre) < 3 then f := f || 'El nombre genérico necesita al menos 3 letras.'::text; end if;
  if privado.normalizar(v_nombre) <> v_gen.nombre_norm
     and exists (select 1 from public.genericos o where o.area = v_gen.area and o.nombre_norm = privado.normalizar(v_nombre) and o.id <> v_gen.id) then
    f := f || ('Ya existe otro genérico «' || v_nombre || '» en ' || v_gen.area || ': si es el mismo, únelos en Revisar duplicados.');
  end if;

  begin v_tipo := coalesce(nullif(g ->> 'tipo', ''), v_gen.tipo::text)::public.tipo_generico;
  exception when others then f := f || ('Tipo no válido: ' || (g ->> 'tipo')); end;
  if v_tipo is distinct from v_gen.tipo and (v_tipo not in ('MPe', 'MPI') or v_gen.tipo not in ('MPe', 'MPI')) then
    f := f || 'Solo se cambia entre MPe (se compra) y MPI (se produce).'::text;
  end if;

  begin v_ub := coalesce(nullif(g ->> 'unidad_base', ''), v_gen.unidad_base::text)::public.unidad_base;
  exception when others then f := f || 'La unidad base debe ser g, ml o und.'::text; end;
  if v_ub is distinct from v_gen.unidad_base then
    if exists (select 1 from public.movimientos m join public.productos pp on pp.id = m.producto_id where pp.generico_id = v_gen.id) then
      f := f || 'La unidad base no se cambia: el genérico ya tiene movimientos en el kardex.'::text;
    elsif exists (select 1 from public.ficha_lineas l where l.generico_id = v_gen.id)
       or exists (select 1 from public.fichas fi where fi.generico_id = v_gen.id) then
      f := f || 'La unidad base no se cambia: el genérico está en una ficha técnica.'::text;
    else
      a := a || ('La unidad base pasó de ' || v_gen.unidad_base || ' a ' || v_ub || ': revisa el contenido de todas sus presentaciones.');
    end if;
  end if;

  v_cat := case when g ? 'categoria' then nullif(g ->> 'categoria', '') else v_gen.categoria end;
  if v_cat is not null and v_cat is distinct from v_gen.categoria
     and not exists (select 1 from public.categorias c where c.codigo = v_cat and c.area = v_gen.area and c.activo) then
    f := f || ('La categoría ' || v_cat || ' no existe en ' || v_gen.area || '.');
  end if;
  v_cons := case when g ? 'conservacion' then nullif(g ->> 'conservacion', '') else v_gen.conservacion end;
  if v_cons is not null and v_cons not in ('Ambiente', 'Refrigerado', 'Congelado') then
    f := f || 'La conservación debe ser Ambiente, Refrigerado o Congelado.'::text;
  end if;
  begin v_tmax := case when g ? 'temp_max_llegada' then nullif(g ->> 'temp_max_llegada', '')::numeric else v_gen.temp_max_llegada end;
  exception when others then f := f || 'La temperatura máxima debe ser un número.'::text; end;
  if v_tmax is not null and (v_tmax < -30 or v_tmax > 30) then f := f || 'La temperatura máxima va entre -30 y 30 °C.'::text; end if;
  if v_cons in ('Refrigerado', 'Congelado') and v_tmax is null then
    a := a || 'Sin temperatura máxima, la recepción no puede revisar la cadena de frío de este insumo.'::text;
  end if;

  -- ---------------------------------------------------------------- presentación
  v_marca := case when x ? 'marca' then coalesce(trim(x ->> 'marca'), '') else v_prod.marca end;
  v_pres := case when x ? 'presentacion' then coalesce(trim(x ->> 'presentacion'), '') else v_prod.presentacion end;
  v_ucompra := case when x ? 'unidad_compra' then upper(nullif(trim(x ->> 'unidad_compra'), '')) else v_prod.unidad_compra end;
  v_var := case when x ? 'contenido_variable' then coalesce((x ->> 'contenido_variable')::boolean, false) else v_prod.contenido_variable end;
  begin v_cont := case when x ? 'contenido_base' then nullif(x ->> 'contenido_base', '')::numeric else v_prod.contenido_base end;
  exception when others then f := f || 'El contenido debe ser un número.'::text; end;
  if v_var then v_cont := null; end if;
  if v_pres = '' then f := f || 'Falta la presentación («Botella 750 ml», «Bolsa 1.000 g», «Granel»).'::text; end if;
  if v_ucompra is null or v_ucompra !~ '^[A-Z]{1,6}$' then f := f || 'Falta la unidad de compra (BOT, PAQ, KG, UND…).'::text; end if;
  if not v_var and (v_cont is null or v_cont <= 0) then
    f := f || 'Falta cuánto trae una unidad de compra (o márcalo como contenido variable).'::text;
  end if;
  if exists (select 1 from public.productos o where o.generico_id = v_gen.id and o.id <> v_prod.id
               and privado.normalizar(o.marca) = privado.normalizar(v_marca)
               and privado.normalizar(o.presentacion) = privado.normalizar(v_pres)) then
    f := f || 'Ese genérico ya tiene otro producto con la misma marca y presentación.'::text;
  end if;
  if v_cont is distinct from v_prod.contenido_base and exists (select 1 from public.movimientos m where m.producto_id = v_prod.id) then
    a := a || 'El contenido nuevo aplica de aquí en adelante; los movimientos ya registrados no cambian.'::text;
  end if;

  if cardinality(f) > 0 then return privado.resultado(false, null, null, f, '{}', a); end if;

  update public.genericos set nombre = v_nombre, tipo = v_tipo, unidad_base = v_ub, categoria = v_cat,
                              conservacion = v_cons, temp_max_llegada = v_tmax
   where id = v_gen.id
     and (nombre, tipo, unidad_base, categoria, conservacion, temp_max_llegada)
         is distinct from (v_nombre, v_tipo, v_ub, v_cat, v_cons, v_tmax);
  update public.productos set marca = v_marca, presentacion = v_pres, unidad_compra = v_ucompra,
                              contenido_base = v_cont, contenido_variable = v_var
   where id = v_prod.id
     and (marca, presentacion, unidad_compra, contenido_base, contenido_variable)
         is distinct from (v_marca, v_pres, v_ucompra, v_cont, v_var);

  if v_validar and v_prod.estado = 'PROVISIONAL' then
    update public.productos set estado = 'VALIDADO', validado_por = auth.uid(), validado_en = now() where id = v_prod.id;
    update public.genericos set estado = 'VALIDADO', validado_por = auth.uid(), validado_en = now()
     where id = v_gen.id and estado = 'PROVISIONAL';
    perform privado.bitacora('PRODUCTO VALIDADO', 'productos', v_prod.codigo, null);
    a := a || 'Quedó validado.'::text;
  end if;
  return privado.resultado(true, v_prod.id, v_prod.codigo, '{}', '{}', a);
end
$$;

revoke execute on function public.editar_producto(jsonb), public.clave_cambiada() from public, anon;
grant execute on function public.editar_producto(jsonb), public.clave_cambiada() to authenticated;
