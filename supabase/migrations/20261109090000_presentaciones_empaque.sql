-- =====================================================================================
-- SGI Di Égida · Fichas · Presentaciones de empaque (Anthony, 07/11/2026)
-- La ficha decía «Empaque: bolsa de vacío» y nada más. Pero de una tanda se empaca de varias
-- formas, y eso tiene que estar decidido desde la ficha para que quien produce sepa cómo guardar:
--   · Puré de papa: del neto se empacan porciones de 200 g y de 150 g (las que convengan).
--   · Pasta de lasagna: la masa se divide en 22 porciones y cada porción trae 3 tapas.
-- Cada presentación dice: cuánto lleva (en la unidad base: 200 g), qué lleva («3 tapas»),
-- cuántas salen por tanda si es fijo (22) y el empaque si es distinto del general.
-- Reglas:
--   · Son parte de la versión: cambiarlas crea versión nueva (cuentan en la huella) y no se
--     modifican después.
--   · Producir las muestra antes de guardar el lote, con las porciones por tanda ajustadas a
--     las tandas que se hacen.
-- Las funciones se ajustan sobre su definición vigente (sin reescribirlas); si un texto esperado
-- no aparece, la migración se detiene.
-- =====================================================================================

create table public.ficha_presentaciones (
  ficha_id   uuid not null references public.fichas (id),
  orden      integer not null check (orden > 0),
  contenido  numeric check (contenido > 0),                        -- en la unidad base del resultado: 200 (g)
  detalle    text check (length(detalle) between 1 and 120),        -- «3 tapas», «porción individual»
  por_tanda  integer check (por_tanda > 0),                         -- cuántas salen de una tanda, si es fijo
  empaque    text check (length(empaque) between 1 and 120),        -- si es distinto del empaque general
  primary key (ficha_id, orden),
  check (contenido is not null or detalle is not null)
);
comment on table public.ficha_presentaciones is
  'Cómo se porciona y empaca lo producido con una versión de ficha (200 g y 150 g; 22 porciones de 3 tapas). Producir las muestra al guardar el lote.';

alter table public.ficha_presentaciones enable row level security;
create policy ficha_presentaciones_leer on public.ficha_presentaciones for select to authenticated using (true);
revoke all on public.ficha_presentaciones from anon;
revoke insert, update, delete, truncate on public.ficha_presentaciones from authenticated;
create trigger ficha_presentaciones_inmutables before update or delete on public.ficha_presentaciones
  for each row execute function privado.bloquear_cambios();
create trigger ficha_presentaciones_auditar after insert on public.ficha_presentaciones
  for each row execute function privado.auditar();

-- ---------------------------------------------------------------- ajustes sobre la definición vigente
create or replace function pg_temp.parchar(p_fn regprocedure, p_cambios text[])
returns void
language plpgsql
as $$
declare v_def text; v_i int;
begin
  v_def := pg_get_functiondef(p_fn);
  for v_i in 1 .. array_length(p_cambios, 1) / 2 loop
    if position(p_cambios[2 * v_i - 1] in v_def) = 0 then
      raise exception 'No se encontró en %: %', p_fn, p_cambios[2 * v_i - 1];
    end if;
    v_def := replace(v_def, p_cambios[2 * v_i - 1], p_cambios[2 * v_i]);
  end loop;
  execute v_def;
end
$$;

-- cambiar las presentaciones es un cambio de la ficha
select pg_temp.parchar('privado.huella_ficha(uuid)', array[
  'from public.ficha_almacenamientos a where a.ficha_id = p_ficha))',
  'from public.ficha_almacenamientos a where a.ficha_id = p_ficha), '
  || '''e'', (select coalesce(jsonb_agg(jsonb_build_array(x.contenido, x.detalle, x.por_tanda, x.empaque) order by x.orden), ''[]'') '
  || 'from public.ficha_presentaciones x where x.ficha_id = p_ficha))']);

-- guardar: valida y guarda las presentaciones
-- p.presentaciones: [{contenido?, detalle?, por_tanda?, empaque?}]
select pg_temp.parchar('public.guardar_ficha(jsonb)', array[
  E'  v_version int;\n',
  E'  v_version int;\n'
  || E'  v_pc numeric; v_pt numeric; v_pd text; v_ptotal numeric := 0; v_pvistos text[] := ''{}'';\n',

  E'  -- ingredientes\n',
  E'  -- presentaciones de empaque\n'
  || E'  if jsonb_array_length(coalesce(p -> ''presentaciones'', ''[]'')) > 12 then\n'
  || E'    f := f || ''Son demasiadas presentaciones: deja las que de verdad se usan (máximo 12).''::text;\n'
  || E'  end if;\n'
  || E'  for v_l, v_n in select e.value, e.ordinality from jsonb_array_elements(coalesce(p -> ''presentaciones'', ''[]'')) with ordinality e loop\n'
  || E'    v_pc := privado.num_o_null(v_l ->> ''contenido'');\n'
  || E'    v_pt := privado.num_o_null(v_l ->> ''por_tanda'');\n'
  || E'    v_pd := privado.texto_o_null(v_l ->> ''detalle'', 120);\n'
  || E'    if nullif(trim(v_l ->> ''contenido''), '''') is not null and (v_pc is null or v_pc <= 0) then\n'
  || E'      f := f || (''Presentación '' || v_n || '': lo que lleva cada empaque debe ser un número mayor que cero (en '' || v_gen.unidad_base || '').'');\n'
  || E'    elsif nullif(trim(v_l ->> ''por_tanda''), '''') is not null and (v_pt is null or v_pt <= 0 or v_pt <> round(v_pt)) then\n'
  || E'      f := f || (''Presentación '' || v_n || '': las que salen por tanda van en número entero.'');\n'
  || E'    elsif v_pc is null and v_pd is null then\n'
  || E'      f := f || (''Presentación '' || v_n || '': escribe cuánto lleva cada empaque (200 '' || v_gen.unidad_base || '') o qué lleva («3 tapas»).'');\n'
  || E'    elsif coalesce(v_pc::text, '''') || ''|'' || lower(coalesce(v_pd, '''')) = any (v_pvistos) then\n'
  || E'      f := f || (''Presentación '' || v_n || '': está repetida.'');\n'
  || E'    end if;\n'
  || E'    v_pvistos := v_pvistos || (coalesce(v_pc::text, '''') || ''|'' || lower(coalesce(v_pd, '''')));\n'
  || E'    if v_pc > 0 and v_pt > 0 then v_ptotal := v_ptotal + v_pc * v_pt; end if;\n'
  || E'  end loop;\n'
  || E'  if v_neto > 0 and v_ptotal > v_neto * 1.02 then\n'
  || E'    a := a || (''Las presentaciones por tanda suman '' || round(v_ptotal) || '' '' || v_gen.unidad_base\n'
  || E'               || '' y la tanda da '' || round(v_neto) || '' '' || v_gen.unidad_base || '': revisa el contenido o las porciones.'');\n'
  || E'  end if;\n\n'
  || E'  -- ingredientes\n',

  E'      from jsonb_array_elements(coalesce(p -> ''almacenamientos'', ''[]'')) e;\n',
  E'      from jsonb_array_elements(coalesce(p -> ''almacenamientos'', ''[]'')) e;\n'
  || E'    insert into public.ficha_presentaciones (ficha_id, orden, contenido, detalle, por_tanda, empaque)\n'
  || E'    select v_id, e.ordinality, privado.num_o_null(e.value ->> ''contenido''), privado.texto_o_null(e.value ->> ''detalle'', 120),\n'
  || E'           privado.num_o_null(e.value ->> ''por_tanda'')::int, privado.texto_o_null(e.value ->> ''empaque'', 120)\n'
  || E'      from jsonb_array_elements(coalesce(p -> ''presentaciones'', ''[]'')) with ordinality e;\n']);

-- leer la ficha: sus presentaciones
select pg_temp.parchar('privado.ficha_para_editar_completo(uuid, uuid)', array[
  E'''versiones'', coalesce((select jsonb_agg(',
  E'''presentaciones'', coalesce((select jsonb_agg(jsonb_build_object(''contenido'', x.contenido, ''detalle'', x.detalle, '
  || E'''por_tanda'', x.por_tanda, ''empaque'', x.empaque) order by x.orden) '
  || E'from public.ficha_presentaciones x where x.ficha_id = v_fid), ''[]''),\n    '
  || E'''versiones'', coalesce((select jsonb_agg(']);

-- Producir: cómo se empaca lo que sale
select pg_temp.parchar('privado.datos_produccion_completo(public.area_app)', array[
  '''empaque'', f.empaque,',
  '''empaque'', f.empaque, ''presentaciones'', coalesce((select jsonb_agg(jsonb_build_object(''contenido'', x.contenido, '
  || '''detalle'', x.detalle, ''por_tanda'', x.por_tanda, ''empaque'', x.empaque) order by x.orden) '
  || 'from public.ficha_presentaciones x where x.ficha_id = f.id), ''[]''),']);
