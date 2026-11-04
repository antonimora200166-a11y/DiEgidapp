-- =====================================================================================
-- SGI Di Égida · 38 · Desechables, aseo, menaje y herramientas (Anthony, 05/11/2026)
-- Hasta hoy todo lo que se compra era MPe y solo una categoría distinguía un vaso de un limón:
-- la app le pedía precio por gramo, lo metía en la hoja A/B y lo ofrecía para las fichas.
-- Se compran y se cuentan igual (siguen siendo tipo MPe: recepción, conteo, saldos y kardex no
-- cambian), pero se comportan distinto. genericos.clase lo dice:
--   MATERIA_PRIMA  alimentos y bebidas: fichas, costo de plato, hoja A/B.
--   DESECHABLE     vasos, pitillos, bolsas al vacío, film, rótulos: se gastan y SÍ pueden ir en
--                  una ficha (el empaque para llevar suma al costo).
--   ASEO           jabones, desengrasante, cofias, bolsas de basura: se gastan, NO van en fichas
--                  (gasto general del área).
--   MENAJE         vajilla, cristalería, cubiertos, azafates: no se gastan; se cuentan por
--                  unidad y salen por baja (dañado / roto o perdido).
--   HERRAMIENTA    herramientas y equipos (bar spoon, cuchillos, licuadora): como el menaje.
-- Las categorías quedan una por clase y área. La clasificación de lo que ya existe es una
-- PROPUESTA (palabras del nombre y categoría actual): la confirma el jefe del área o
-- administración en /catalogo/clases. Nada cambia hasta entonces.
-- =====================================================================================

create type public.clase_insumo as enum ('MATERIA_PRIMA', 'DESECHABLE', 'ASEO', 'MENAJE', 'HERRAMIENTA');

alter table public.genericos
  add column clase public.clase_insumo not null default 'MATERIA_PRIMA',
  add constraint genericos_clase_solo_mpe check (clase = 'MATERIA_PRIMA' or tipo = 'MPe');
comment on column public.genericos.clase is
  'Qué es lo que se compra: materia prima, desechable, aseo, menaje o herramienta/equipo. Ver migración 38.';

-- ---------------------------------------------------------------- una categoría por clase y área
update public.categorias set nombre = 'Menaje' where codigo = 'MENAJE' and nombre = 'Menaje, equipos y herramientas';
update public.categorias set nombre = 'Aseo y limpieza' where codigo = 'COC_ASEO' and nombre = 'Aseo y desechables';
insert into public.categorias (codigo, nombre, area, exige_sello, es_perecedero)
select x.codigo, x.nombre, x.area::public.area_app, false, false
  from (values ('HERRAMIENTA', 'Herramientas y equipos', 'BAR'), ('DESECHABLE', 'Desechables', 'BAR'),
               ('ASEO', 'Aseo y limpieza', 'BAR'), ('MENAJE', 'Menaje', 'BAR'),
               ('COC_DESECHABLE', 'Desechables', 'COCINA'), ('COC_MENAJE', 'Menaje', 'COCINA'),
               ('COC_HERRAMIENTA', 'Herramientas y equipos', 'COCINA')) as x (codigo, nombre, area)
 where not exists (select 1 from public.categorias c where c.codigo = x.codigo);

create or replace function privado.categoria_de_clase(p_area public.area_app, p_clase public.clase_insumo)
returns text language sql immutable set search_path = ''
as $$
  select case when p_clase = 'MATERIA_PRIMA' then null
              when p_area = 'BAR' then p_clase::text
              else 'COC_' || p_clase::text end
$$;

-- ---------------------------------------------------------------- en una ficha solo materia prima y desechables
create or replace function privado.ficha_linea_clase()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_nombre text; v_clase public.clase_insumo;
begin
  select g.nombre, g.clase into v_nombre, v_clase from public.genericos g where g.id = new.generico_id;
  if v_clase in ('ASEO', 'MENAJE', 'HERRAMIENTA') then
    raise exception '«%» es % y no va en una ficha técnica: solo materia prima, MPI y desechables.', v_nombre,
      case v_clase when 'ASEO' then 'de aseo' when 'MENAJE' then 'menaje' else 'una herramienta o equipo' end;
  end if;
  return new;
end
$$;
create trigger ficha_lineas_clase before insert or update of generico_id on public.ficha_lineas
  for each row execute function privado.ficha_linea_clase();

-- ---------------------------------------------------------------- cambiar la clase (pantalla del producto, alta)
create or replace function public.fijar_clase(p_genericos uuid[], p_clase public.clase_insumo)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  g record;
  v_ok int := 0; v_det jsonb := '[]';
  v_msg text;
begin
  if coalesce(cardinality(p_genericos), 0) = 0 then raise exception 'No hay genéricos seleccionados.'; end if;
  for g in select * from public.genericos where id = any (p_genericos) order by nombre for update loop
    v_msg := null;
    if not privado.edita_area(g.area) then v_msg := 'Solo el jefe del área o administración cambian la clase.';
    elsif g.tipo <> 'MPe' and p_clase <> 'MATERIA_PRIMA' then v_msg := 'Solo lo que se compra (MPe) puede ser desechable, aseo, menaje o herramienta.';
    elsif p_clase in ('ASEO', 'MENAJE', 'HERRAMIENTA')
          and exists (select 1 from public.ficha_lineas l join public.fichas f on f.id = l.ficha_id
                       where l.generico_id = g.id and (f.vigente_hasta is null or f.vigente_hasta >= privado.hoy())) then
      v_msg := 'Está en una ficha técnica vigente: quítalo de la ficha antes.';
    end if;
    if v_msg is not null then
      v_det := v_det || jsonb_build_object('id', g.id, 'nombre', g.nombre, 'ok', false, 'mensaje', v_msg);
      continue;
    end if;
    update public.genericos
       set clase = p_clase,
           categoria = coalesce(privado.categoria_de_clase(g.area, p_clase),
                                case when g.clase <> 'MATERIA_PRIMA' then null else g.categoria end)
     where id = g.id;
    v_ok := v_ok + 1;
    v_det := v_det || jsonb_build_object('id', g.id, 'nombre', g.nombre, 'ok', true);
  end loop;
  perform privado.bitacora('CLASE DE INSUMO', 'genericos', null, jsonb_build_object('clase', p_clase, 'ok', v_ok));
  return jsonb_build_object('ok', v_ok, 'fallidos', cardinality(p_genericos) - v_ok, 'detalle', v_det);
end
$$;

-- ---------------------------------------------------------------- propuesta para lo que ya existe
create table public.propuestas_clase (
  id            uuid primary key default gen_random_uuid(),
  generico_id   uuid not null references public.genericos (id) unique,
  clase         public.clase_insumo not null,
  seguridad     text not null check (seguridad in ('ALTA', 'MEDIA', 'BAJA')),
  razon         text not null,
  estado        text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'ACEPTADA', 'CORREGIDA', 'RECHAZADA')),
  aplicada      public.clase_insumo,
  mensaje       text,
  decidido_por  uuid references public.perfiles (id),
  decidido_en   timestamptz,
  creado_en     timestamptz not null default now()
);
create trigger propuestas_clase_sin_borrado before delete on public.propuestas_clase
  for each row execute function privado.bloquear_cambios();
create trigger propuestas_clase_auditar after update on public.propuestas_clase
  for each row execute function privado.auditar();
alter table public.propuestas_clase enable row level security;
revoke all on public.propuestas_clase from anon;
revoke insert, update, delete, truncate on public.propuestas_clase from authenticated;
create policy propuestas_clase_leer on public.propuestas_clase for select to authenticated
  using (privado.tiene_rol('admin', 'auditor') or privado.edita_generico(generico_id));

-- Reglas por palabras del nombre (la primera que calza gana). Fuera de las categorías de
-- aseo, desechables, menaje y otros, solo cuentan las palabras inequívocas.
with reglas (orden, clase, patron, inequivoca) as (values
  (0, 'DESECHABLE', '(bala de|n2o|co2|gas butano|gas propano|carbon)', false),   -- consumibles de operación
  (1, 'DESECHABLE', '(desechable|pitillo|pajilla|servilleta|vinipel|papel (aluminio|craft|parafinado|encerado)|film|pelicula|rotulo|etiqueta|palillo|ziploc|bolsa(s)? (al )?vacio|bolsa vacio|bolsas? (de )?empaque|contenedor|icopor|guante)', true),
  (5, 'DESECHABLE', '(tapas? |tapas verdes|rollo)', false),
  (2, 'ASEO', '(jabon|detergente|desengrasante|cloro|hipoclorito|desinfectante|limpiador|limpia|esponja|escoba|trapero|recogedor|waypal|wypall|pano |panos |aromatizante|ambientador|papel higienico|toalla de papel|bolsa(s)? (de )?basura|bolsa(s)? (negra|blanca|verde|alta)|cofia|tapaboca|alcohol antiseptico|gel antibacterial|antibacterial|lavaloza|brillametal|sapolio|varsol|fajinador)', true),
  (3, 'HERRAMIENTA', '(cuchillo|tabla de picar|pinza|espatula|batidor|colador|strainer|jigger|bar ?spoon|coctelera|shaker|muddler|macerador|mortero|rallador|pelador|sacacorcho|descorchador|abrelatas|licuadora|deshidratadora|batidora|termometro|bascula|balanza|gramera|molde|olla|sarten|cucharon|tijera|soplete|sifon|exprimidor|picahielo|embudo|mandolina|rodillo|manga pastelera|cuchara medidora|medidor|termo|bajo de musica|parlante|nevera|congelador|horno|estufa|plancha|freidora|selladora|empacadora|cafetera|computador|destapador|escalera|extintor|gasificador|maquina de|microplane|majador|pala de|parisienne|sacabolas|torneador|ventilador|michelador|espolvoreador|glorificador|organizador de herramientas|pincel|mix in glass)', false),
  (4, 'MENAJE', '(vaso|copa|plato|bowl|taza|pocillo|jarra|azafate|bandeja|cubierto|tenedor|cuchara|servilletero|salero|pimentero|hielera|balde|botella vacia|dispensador|recipiente|gastronorm|frasco|cristaleria|vajilla|tabla de servicio|charola|portavasos|posavasos|base de hielera|bidon|canasta|cesta|decanter|florero|shot de|tapete|organizador de bar|topinera)', false)
),
candidatos as (
  select g.id, g.nombre, g.area, g.categoria, privado.normalizar(g.nombre) as n,
         g.categoria in ('ASEO', 'DESECHABLE', 'MENAJE', 'OTROS', 'COC_ASEO') as cat_no_alimento
    from public.genericos g
   where g.activo and g.tipo = 'MPe' and g.clase = 'MATERIA_PRIMA'
),
calza as (
  select distinct on (c.id) c.id, r.clase, c.categoria, c.cat_no_alimento, r.inequivoca,
         (regexp_match(c.n, r.patron))[1] as palabra
    from candidatos c join reglas r on c.n ~ r.patron and (r.inequivoca or c.cat_no_alimento)
   order by c.id, r.orden
)
insert into public.propuestas_clase (generico_id, clase, seguridad, razon)
select k.id, k.clase::public.clase_insumo,
       case when k.cat_no_alimento then 'ALTA' else 'MEDIA' end,
       'El nombre dice «' || trim(k.palabra) || '»' || case when k.cat_no_alimento then ' y está en ' || coalesce(k.categoria, 'sin categoría') else '' end || '.'
  from calza k
union all
-- lo de esas categorías que ninguna palabra explicó: se propone según la categoría, para revisar
select c.id,
       (case c.categoria when 'DESECHABLE' then 'DESECHABLE' when 'MENAJE' then 'MENAJE' when 'OTROS' then 'MENAJE' else 'ASEO' end)::public.clase_insumo,
       'BAJA', 'Solo por la categoría actual (' || c.categoria || '): revísalo.'
  from candidatos c
 where c.cat_no_alimento and c.categoria <> 'OTROS' and not exists (select 1 from calza k where k.id = c.id);

-- ---------------------------------------------------------------- pantalla de propuestas
create or replace function public.lista_propuestas_clase()
returns table (id uuid, generico_id uuid, codigo text, generico text, area public.area_app, categoria text,
               clase public.clase_insumo, seguridad text, razon text, estado text, aplicada public.clase_insumo,
               mensaje text, decidido_por text, decidido_en timestamptz, productos integer)
language sql stable security definer set search_path = ''
as $$
  select pc.id, g.id, g.codigo, g.nombre, g.area, (select c.nombre from public.categorias c where c.codigo = g.categoria),
         pc.clase, pc.seguridad, pc.razon, pc.estado, pc.aplicada, pc.mensaje, pe.nombre, pc.decidido_en,
         (select count(*)::int from public.productos p where p.generico_id = g.id and p.activo)
    from public.propuestas_clase pc
    join public.genericos g on g.id = pc.generico_id
    left join public.perfiles pe on pe.id = pc.decidido_por
   where g.activo and (privado.tiene_rol('admin', 'auditor') or privado.edita_area(g.area))
   order by case pc.estado when 'PENDIENTE' then 0 else 1 end, g.area, pc.clase, g.nombre
$$;

-- p_decision: ACEPTAR (la clase propuesta, o p_clase si viene = corrección) · RECHAZAR (sigue siendo materia prima).
create or replace function public.decidir_propuestas_clase(p_ids uuid[], p_decision text, p_clase public.clase_insumo default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_dec text := upper(trim(coalesce(p_decision, '')));
  v_pc record; v_r jsonb; v_cl public.clase_insumo;
  v_ok int := 0; v_mal int := 0; v_det jsonb := '[]';
begin
  if v_dec not in ('ACEPTAR', 'RECHAZAR') then raise exception 'La decisión debe ser ACEPTAR o RECHAZAR.'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 then raise exception 'No hay propuestas seleccionadas.'; end if;
  for v_pc in
    select pc.*, g.area, g.nombre from public.propuestas_clase pc join public.genericos g on g.id = pc.generico_id
     where pc.id = any (p_ids) order by g.nombre for update of pc
  loop
    if not privado.edita_area(v_pc.area) then
      v_mal := v_mal + 1;
      v_det := v_det || jsonb_build_object('id', v_pc.id, 'nombre', v_pc.nombre, 'ok', false, 'mensaje', 'Solo el jefe del área o administración deciden.');
      continue;
    end if;
    if v_pc.estado <> 'PENDIENTE' then continue; end if;
    if v_dec = 'RECHAZAR' then
      update public.propuestas_clase set estado = 'RECHAZADA', decidido_por = auth.uid(), decidido_en = now() where id = v_pc.id;
      v_ok := v_ok + 1;
      continue;
    end if;
    v_cl := coalesce(p_clase, v_pc.clase);
    v_r := public.fijar_clase(array[v_pc.generico_id], v_cl);
    if (v_r ->> 'ok')::int = 1 then
      update public.propuestas_clase
         set estado = case when p_clase is null or p_clase = v_pc.clase then 'ACEPTADA' else 'CORREGIDA' end,
             aplicada = v_cl, mensaje = null, decidido_por = auth.uid(), decidido_en = now()
       where id = v_pc.id;
      v_ok := v_ok + 1;
    else
      update public.propuestas_clase set mensaje = v_r -> 'detalle' -> 0 ->> 'mensaje' where id = v_pc.id;
      v_mal := v_mal + 1;
      v_det := v_det || jsonb_build_object('id', v_pc.id, 'nombre', v_pc.nombre, 'ok', false, 'mensaje', v_r -> 'detalle' -> 0 ->> 'mensaje');
    end if;
  end loop;
  return jsonb_build_object('ok', v_ok, 'fallidos', v_mal, 'detalle', v_det);
end
$$;

-- ---------------------------------------------------------------- ficha: ingredientes sin aseo, menaje ni herramientas
create or replace function public.ficha_para_editar(p_generico uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_gen public.genericos%rowtype;
  v_fid uuid;
begin
  select * into v_gen from public.genericos where id = p_generico;
  if v_gen.id is null or v_gen.tipo not in ('MPI', 'BEBIDA', 'PLATO') then
    raise exception 'Solo los MPI, cócteles y platos tienen ficha técnica.';
  end if;
  if not privado.ve_costos() or not (privado.opera_en(v_gen.area) or privado.tiene_rol('admin', 'auditor')) then
    raise exception 'Sin permiso para ver las fichas de %.', v_gen.area using errcode = '42501';
  end if;
  v_fid := privado.ficha_vigente(v_gen.id);

  return jsonb_build_object(
    'resultado', jsonb_build_object('id', v_gen.id, 'codigo', v_gen.codigo, 'nombre', v_gen.nombre, 'tipo', v_gen.tipo,
                                    'unidad_base', v_gen.unidad_base, 'area', v_gen.area),
    'puede_editar', privado.edita_area(v_gen.area),
    'ficha', (select jsonb_build_object('id', f.id, 'codigo', f.codigo, 'version', f.version, 'neto_esperado', f.neto_esperado,
                                        'nota', f.nota, 'vigente_desde', f.vigente_desde,
                                        'lotes', (select count(*) from public.lotes_produccion lp where lp.ficha_id = f.id))
                from public.fichas f where f.id = v_fid),
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object('generico_id', g.id, 'generico', g.nombre, 'tipo', g.tipo, 'unidad_base', g.unidad_base,
                                          'cantidad', l.cantidad, 'unidad', l.unidad, 'nota', l.nota,
                                          'factor', privado.a_base(g.id, 1, l.unidad),
                                          'costo', c.costo, 'falta', c.falta) order by l.linea)
        from public.ficha_lineas l join public.genericos g on g.id = l.generico_id
        left join public.costo_ficha(v_fid) c on c.linea = l.linea
       where l.ficha_id = v_fid), '[]'),
    -- lo que puede ir en la receta: materia prima, desechables, MPI y lo sin costo del área
    'ingredientes', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'nombre', g.nombre, 'tipo', g.tipo, 'unidad_base', g.unidad_base,
                                          'unidades', (select coalesce(jsonb_agg(c.unidad order by c.unidad), '[]')
                                                         from public.conversiones c where c.generico_id = g.id))
                       order by g.nombre)
        from public.genericos g
       where g.area = v_gen.area and g.activo and g.tipo in ('MPe', 'MPI', 'SIN_COSTO')
         and g.clase in ('MATERIA_PRIMA', 'DESECHABLE') and g.id <> v_gen.id), '[]'));
end
$$;

revoke execute on function public.fijar_clase(uuid[], public.clase_insumo), public.lista_propuestas_clase(),
                           public.decidir_propuestas_clase(uuid[], text, public.clase_insumo) from public, anon;
grant execute on function public.fijar_clase(uuid[], public.clase_insumo), public.lista_propuestas_clase(),
                          public.decidir_propuestas_clase(uuid[], text, public.clase_insumo) to authenticated;
