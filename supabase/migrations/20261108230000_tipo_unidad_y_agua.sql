-- =====================================================================================
-- SGI Di Égida · Catálogo: cambiar tipo y unidad base · el agua como ingrediente sin costo
-- 1. public.editar_producto:
--    · el tipo se cambia entre MPe (se compra), MPI (se produce) y SIN_COSTO (agua, subproductos).
--      BEBIDA y PLATO siguen fijos: son de la carta.
--    · la unidad base ya no se bloquea porque el genérico esté en fichas: cada línea de ficha guarda
--      su propia unidad y se convierte al calcular. Avisa qué líneas quedan sin conversión.
--      Sigue bloqueada si hay movimientos en el kardex: ya están guardados en la unidad vieja.
-- 2. Lo SIN_COSTO no lleva precio: un disparador impide que reciba costo de referencia
--    (ni por foto ni heredado de otra presentación) y se limpia lo que ya tenía.
-- 3. Agua: sale de la llave, se paga en el servicio de agua (gasto), costo $0. Se usa en barra y
--    en cocina, así que existe en las dos áreas (cada área tiene su catálogo): BAR_SC_0001 ya
--    estaba; se crea COC_SC_0001. La botella Hatsu 300 ml había quedado dentro de «Agua» por un
--    alias de recepción: vuelve a su genérico «Agua Hatsu» (MPe, se compra).
-- =====================================================================================

-- ---------------------------------------------------------------- 1. editar_producto
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
  v_sin_conv text;
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
  if v_tipo is distinct from v_gen.tipo then
    if v_tipo not in ('MPe', 'MPI', 'SIN_COSTO') or v_gen.tipo not in ('MPe', 'MPI', 'SIN_COSTO') then
      f := f || 'Bebidas y platos de carta no cambian de tipo; los insumos van entre MPe, MPI y sin costo.'::text;
    elsif v_tipo = 'SIN_COSTO' then
      a := a || 'Queda sin costo: no lleva precio y suma $0 en las fichas.'::text;
    elsif v_gen.tipo = 'SIN_COSTO' then
      a := a || 'Ya no es sin costo: necesita precio para que las fichas lo costeen.'::text;
    end if;
    if v_gen.tipo = 'MPI' and exists (select 1 from public.fichas fi where fi.generico_id = v_gen.id) then
      a := a || 'Tenía ficha de producción: la ficha queda, pero ya no se produce como MPI.'::text;
    end if;
  end if;

  begin v_ub := coalesce(nullif(g ->> 'unidad_base', ''), v_gen.unidad_base::text)::public.unidad_base;
  exception when others then f := f || 'La unidad base debe ser g, ml o und.'::text; end;
  if v_ub is distinct from v_gen.unidad_base then
    if exists (select 1 from public.movimientos m join public.productos pp on pp.id = m.producto_id where pp.generico_id = v_gen.id) then
      f := f || 'La unidad base no se cambia: el genérico ya tiene movimientos en el kardex (están guardados en la unidad actual).'::text;
    else
      a := a || ('La unidad base pasó de ' || v_gen.unidad_base || ' a ' || v_ub || ': revisa el contenido de todas sus presentaciones.');
      if exists (select 1 from public.fichas fi where fi.generico_id = v_gen.id) then
        a := a || 'Revisa el neto esperado de su ficha: estaba en la unidad anterior.'::text;
      end if;
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

  -- sin costo: se le quita el costo de referencia a todas sus presentaciones
  if v_tipo = 'SIN_COSTO' and v_gen.tipo <> 'SIN_COSTO' then
    delete from public.costos_referencia cr using public.productos pp
     where pp.id = cr.producto_id and pp.generico_id = v_gen.id;
  end if;

  -- con la unidad nueva: líneas de ficha que ya no se pueden convertir
  if v_ub is distinct from v_gen.unidad_base then
    select string_agg(distinct coalesce(rg.nombre, '?') || ' (' || l.unidad || ')', ', ')
      into v_sin_conv
      from public.ficha_lineas l
      join public.fichas fi on fi.id = l.ficha_id and fi.vigente_hasta is null
      left join public.genericos rg on rg.id = fi.generico_id
     where l.generico_id = v_gen.id and l.cantidad is not null
       and privado.a_base(l.generico_id, l.cantidad, l.unidad) is null;
    if v_sin_conv is not null then
      a := a || ('Estas fichas lo piden en otra unidad y quedan sin conversión a ' || v_ub || ': ' || v_sin_conv || '.');
    elsif exists (select 1 from public.ficha_lineas l where l.generico_id = v_gen.id) then
      a := a || 'Las fichas que lo usan siguen convirtiendo bien.'::text;
    end if;
  end if;

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

revoke execute on function public.editar_producto(jsonb) from public, anon;
grant execute on function public.editar_producto(jsonb) to authenticated;

-- ---------------------------------------------------------------- 2. lo sin costo no lleva precio
create or replace function privado.sin_costo_sin_precio()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.productos p join public.genericos g on g.id = p.generico_id
              where p.id = new.producto_id and g.tipo = 'SIN_COSTO') then
    return null;  -- se ignora en silencio: no rompe la foto de precios ni la herencia entre presentaciones
  end if;
  return new;
end
$$;

drop trigger if exists costos_referencia_sin_costo on public.costos_referencia;
create trigger costos_referencia_sin_costo before insert or update on public.costos_referencia
  for each row execute function privado.sin_costo_sin_precio();

-- ---------------------------------------------------------------- 3. agua
-- 3a. la botella Hatsu vuelve a «Agua Hatsu» (se compra)
update public.genericos set activo = true, unido_en = null
 where codigo = 'BAR_MPe_0202' and tipo = 'MPe';
update public.productos set generico_id = (select id from public.genericos where codigo = 'BAR_MPe_0202')
 where codigo = 'BAR_MPe_0202-BOTELLA300ML'
   and exists (select 1 from public.genericos where codigo = 'BAR_MPe_0202');
update public.alias set generico_id = (select id from public.genericos where codigo = 'BAR_MPe_0202')
 where alias_norm = 'agua hatsu x300' and area = 'BAR'
   and exists (select 1 from public.genericos where codigo = 'BAR_MPe_0202');
-- (sus compras históricas son inmutables: siguen apuntando al producto, que es lo que cuenta)

-- 3b. el agua de la llave de bar queda sin precio
delete from public.costos_referencia cr using public.productos p, public.genericos g
 where p.id = cr.producto_id and g.id = p.generico_id and g.tipo = 'SIN_COSTO';
update public.genericos set nota = 'Costo $0 · agua de la llave: se paga en el servicio de agua (gasto). También existe en cocina (COC_SC_0001).'
 where codigo = 'BAR_SC_0001';
update public.productos set presentacion = 'De la llave'
 where codigo = 'BAR_SC_0001-ML' and presentacion = 'Subproducto sin costo';

-- 3c. el agua de cocina
-- (solo donde ya está el catálogo real: una base vacía o de pruebas no recibe datos)
insert into public.genericos (codigo, nombre, tipo, clase, area, unidad_base, activo, estado, validado_en, nota)
select 'COC_SC_0001', 'Agua', 'SIN_COSTO', 'MATERIA_PRIMA', 'COCINA', 'ml', true, 'VALIDADO', now(),
       'Costo $0 · agua de la llave: se paga en el servicio de agua (gasto). También existe en bar (BAR_SC_0001).'
 where exists (select 1 from public.genericos where codigo = 'BAR_SC_0001')
on conflict (codigo) do nothing;
insert into public.productos (codigo, generico_id, marca, presentacion, unidad_compra, contenido_base, contenido_variable, estado, validado_en)
select 'COC_SC_0001-ML', g.id, '', 'De la llave', 'ML', 1, false, 'VALIDADO', now()
  from public.genericos g where g.codigo = 'COC_SC_0001'
on conflict (codigo) do nothing;
insert into public.alias (fuente, alias, generico_id, area)
select v.fuente, v.alias, g.id, 'COCINA'
  from public.genericos g, (values ('FICHA', 'agua'), ('RECETA', 'agua')) v(fuente, alias)
 where g.codigo = 'COC_SC_0001'
on conflict (area, fuente, alias_norm) do nothing;

-- el recetario de cocina pedía «Agua» (OTR007, marcada como nueva): queda enlazada
update public.recetario_ingredientes
   set estado = 'CONFIRMADO', generico_id = (select id from public.genericos where codigo = 'COC_SC_0001'), decidido_en = now()
 where fuente = 'RECETARIO COCINA' and codigo = 'OTR007' and generico_id is null;

select privado.bitacora('AGUA SIN COSTO', 'genericos', 'COC_SC_0001',
  jsonb_build_object('bar', 'BAR_SC_0001', 'hatsu_devuelta_a', 'BAR_MPe_0202'));
