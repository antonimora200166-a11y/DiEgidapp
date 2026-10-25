-- =====================================================================================
-- SGI Di Égida · 08 · Decidir un par del catálogo desde la app
-- public.decidir_par: el jefe del área (o el admin) dice si los dos lados son el mismo insumo.
--   SEPARAR  → solo queda la decisión.
--   FUSIONAR → el lado que se conserva absorbe al otro. Nada se borra:
--     · genéricos distintos: los productos del absorbido pasan al que queda (mismo código de
--       kardex, así que saldos y movimientos no cambian); si ya existe uno igual, el repetido
--       se desactiva. Alias, líneas de ficha y conversiones pasan también; el genérico absorbido
--       queda inactivo con nota.
--     · mismo genérico (producto repetido): el producto absorbido se desactiva y sus alias
--       apuntan al que queda.
-- Se rechaza lo que no se puede unir sin perder información: unidad base distinta, ficha o precio
-- de carta en el absorbido, o saldo en un producto que habría que desactivar.
-- =====================================================================================

create or replace function public.decidir_par(p_id text, p_decision text, p_conserva text default 'A', p_nota text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_par       public.revision_catalogo%rowtype;
  v_dec       text := upper(trim(coalesce(p_decision, '')));
  v_lado      text := upper(trim(coalesce(p_conserva, 'A')));
  v_queda     public.genericos%rowtype;
  v_va        public.genericos%rowtype;
  v_nom_queda text; v_nom_va text;
  v_pq uuid; v_pv uuid;           -- productos (caso mismo genérico)
  f text[] := '{}'; a text[] := '{}';
  v_movidos int := 0; v_desactivados int := 0; v_alias int := 0;
  v_nota      text := nullif(trim(coalesce(p_nota, '')), '');
  v_marca     text := 'catálogo unificado · par revisado ' || to_char(now() at time zone 'America/Bogota', 'YYYY-MM-DD');
begin
  select * into v_par from public.revision_catalogo r where r.id = p_id for update;
  if v_par.id is null then raise exception 'No existe el par %.', p_id; end if;
  if not privado.edita_area(v_par.area) then
    raise exception 'Solo el jefe de % o el admin deciden pares del catálogo.', v_par.area using errcode = '42501';
  end if;
  if v_par.decision is not null then
    return privado.resultado(false, null, null, array['Este par ya se decidió (' || v_par.decision || ').'], '{}', '{}');
  end if;
  if v_dec not in ('FUSIONAR', 'SEPARAR') then
    return privado.resultado(false, null, null, array['La decisión debe ser FUSIONAR o SEPARAR.'], '{}', '{}');
  end if;
  if v_lado not in ('A', 'B') then
    return privado.resultado(false, null, null, array['El lado que se conserva debe ser A o B.'], '{}', '{}');
  end if;

  if v_dec = 'FUSIONAR' then
    if v_lado = 'A' then
      select * into v_queda from public.genericos g where g.id = v_par.a_generico_id;
      select * into v_va    from public.genericos g where g.id = v_par.b_generico_id;
      v_nom_queda := v_par.a_nombre; v_nom_va := v_par.b_nombre;
    else
      select * into v_queda from public.genericos g where g.id = v_par.b_generico_id;
      select * into v_va    from public.genericos g where g.id = v_par.a_generico_id;
      v_nom_queda := v_par.b_nombre; v_nom_va := v_par.a_nombre;
    end if;
    if v_queda.id is null or v_va.id is null then
      return privado.resultado(false, null, null, array['Uno de los dos lados no quedó ubicado en el catálogo: hay que unirlos a mano.'], '{}', '{}');
    end if;

    if v_queda.id = v_va.id then
      -- producto repetido dentro del mismo genérico: se ubica cada lado por su alias
      select al.producto_id into v_pq from public.alias al
       where al.generico_id = v_queda.id and al.alias_norm = privado.normalizar(v_nom_queda) and al.producto_id is not null limit 1;
      select al.producto_id into v_pv from public.alias al
       where al.generico_id = v_queda.id and al.alias_norm = privado.normalizar(v_nom_va) and al.producto_id is not null limit 1;
      if v_pq is null or v_pv is null or v_pq = v_pv then
        a := a || 'Los dos nombres ya son el mismo genérico; no hay un producto repetido que desactivar.'::text;
      elsif exists (select 1 from public.existencias e where e.producto_id = v_pv and e.cantidad <> 0) then
        f := f || ('El producto «' || v_nom_va || '» tiene saldo en el kardex: trasládalo o cuéntalo en cero antes de unirlo.');
      else
        update public.alias al set producto_id = v_pq where al.producto_id = v_pv;
        get diagnostics v_alias = row_count;
        update public.productos p set activo = false,
               nota = concat_ws(' · ', p.nota, 'Repetido de ' || (select x.codigo from public.productos x where x.id = v_pq) || ' (' || v_marca || ').')
         where p.id = v_pv;
        v_desactivados := 1;
      end if;
    else
      if v_queda.unidad_base <> v_va.unidad_base then
        f := f || ('No se pueden unir: «' || v_queda.nombre || '» va en ' || v_queda.unidad_base || ' y «' || v_va.nombre
                   || '» en ' || v_va.unidad_base || '. Corrige la unidad base de uno o márcalos como distintos.');
      end if;
      if exists (select 1 from public.fichas fi where fi.generico_id = v_va.id) then
        f := f || ('«' || v_va.nombre || '» tiene ficha técnica propia: conserva ese lado o une las fichas a mano.');
      end if;
      if exists (select 1 from public.precios_venta pv where pv.generico_id = v_va.id) then
        f := f || ('«' || v_va.nombre || '» tiene precio de carta: conserva ese lado.');
      end if;
      -- productos que chocan con uno igual del que queda: se desactivan, y no pueden tener saldo
      if exists (select 1 from public.productos p join public.existencias e on e.producto_id = p.id and e.cantidad <> 0
                  where p.generico_id = v_va.id
                    and exists (select 1 from public.productos x where x.generico_id = v_queda.id
                                  and privado.normalizar(x.marca) = privado.normalizar(p.marca)
                                  and privado.normalizar(x.presentacion) = privado.normalizar(p.presentacion))) then
        f := f || 'Un producto repetido tiene saldo en el kardex: trasládalo o cuéntalo en cero antes de unir.'::text;
      end if;

      if cardinality(f) = 0 then
        update public.productos p set activo = false,
               nota = concat_ws(' · ', p.nota, 'Repetido al unir ' || v_va.codigo || ' en ' || v_queda.codigo || ' (' || v_marca || ').')
         where p.generico_id = v_va.id
           and exists (select 1 from public.productos x where x.generico_id = v_queda.id
                         and privado.normalizar(x.marca) = privado.normalizar(p.marca)
                         and privado.normalizar(x.presentacion) = privado.normalizar(p.presentacion));
        get diagnostics v_desactivados = row_count;
        -- los repetidos se quedan en el genérico absorbido (inactivos); el resto se mueve
        update public.productos p set generico_id = v_queda.id,
               nota = concat_ws(' · ', p.nota, 'Viene de ' || v_va.codigo || ' (' || v_marca || ').')
         where p.generico_id = v_va.id and p.activo;
        get diagnostics v_movidos = row_count;
        update public.alias al set generico_id = v_queda.id
         where al.generico_id = v_va.id
           and not exists (select 1 from public.alias x where x.generico_id = v_queda.id and x.area = al.area
                             and x.fuente = al.fuente and x.alias_norm = al.alias_norm);
        get diagnostics v_alias = row_count;
        update public.ficha_lineas l set generico_id = v_queda.id where l.generico_id = v_va.id;
        update public.conversiones c set generico_id = v_queda.id
         where c.generico_id = v_va.id
           and not exists (select 1 from public.conversiones x where x.generico_id = v_queda.id and x.unidad = c.unidad);
        update public.genericos g set activo = false,
               nota = concat_ws(' · ', g.nota, 'Unido en ' || v_queda.codigo || ' (' || v_marca || ').')
         where g.id = v_va.id;
        -- los demás pares que mencionaban al absorbido ahora miran al que queda
        update public.revision_catalogo r set a_generico_id = v_queda.id where r.a_generico_id = v_va.id and r.id <> v_par.id;
        update public.revision_catalogo r set b_generico_id = v_queda.id where r.b_generico_id = v_va.id and r.id <> v_par.id;
      end if;
    end if;
  end if;

  if cardinality(f) > 0 then
    perform privado.bitacora('PAR NO UNIDO', 'revision_catalogo', p_id, to_jsonb(f));
    return privado.resultado(false, null, null, f, '{}', a);
  end if;

  update public.revision_catalogo r
     set decision = v_dec, decidido_por = auth.uid(), decidido_en = now(),
         nota = concat_ws(' · ', v_nota, case when v_dec = 'FUSIONAR' then 'Conserva el lado ' || v_lado end)
   where r.id = p_id;
  perform privado.bitacora('PAR ' || v_dec, 'revision_catalogo', p_id,
    jsonb_build_object('conserva', case when v_dec = 'FUSIONAR' then v_queda.codigo end,
                       'absorbido', case when v_dec = 'FUSIONAR' then v_va.codigo end,
                       'productos_movidos', v_movidos, 'productos_desactivados', v_desactivados, 'alias', v_alias), v_nota);
  if v_movidos > 0 then a := a || (v_movidos || ' producto(s) pasaron a ' || v_queda.nombre || '.'); end if;
  if v_desactivados > 0 then a := a || (v_desactivados || ' producto(s) repetido(s) quedaron inactivos.'); end if;
  return privado.resultado(true, v_queda.id, v_queda.codigo, '{}', '{}', a);
end
$$;

revoke execute on function public.decidir_par(text, text, text, text) from public, anon;
grant execute on function public.decidir_par(text, text, text, text) to authenticated;
