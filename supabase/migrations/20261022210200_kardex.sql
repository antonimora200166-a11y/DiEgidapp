-- =====================================================================================
-- SGI Di Égida · 03 · Kardex
-- Todo cambio de existencias es un movimiento. Nunca se edita un saldo (CLAUDE.md).
-- Costo de insumos: promedio ponderado móvil, recalculado en cada ENTRADA.
-- El kardex se ordena por orden de registro (id): el promedio de un movimiento es el
-- vigente en el momento en que se registró, aunque su fecha operativa sea anterior.
-- =====================================================================================

create type public.tipo_movimiento as enum (
  -- entran (cantidad > 0)
  'SALDO_INICIAL',           -- valorizada al costo de referencia (null = sin costo conocido)
  'ENTRADA_COMPRA',          -- valorizada: valor de la factura / cantidad en unidad base
  'ENTRADA_PRODUCCION',      -- valorizada: costo del lote / neto (null si el lote quedó PARCIAL)
  'AJUSTE_CONTEO_POSITIVO',  -- al promedio vigente
  'TRASLADO_ENTRADA',        -- al promedio vigente
  -- salen (cantidad < 0)
  'SALIDA_A_PRODUCCION',     -- al promedio vigente
  'SALIDA_VENTA',            -- al promedio vigente (consumo teórico por venta, futuro POS)
  'SALIDA_BAJA',             -- al promedio vigente
  'AJUSTE_CONTEO_NEGATIVO',  -- al promedio vigente
  'TRASLADO_SALIDA',         -- al promedio vigente
  'DEVOLUCION_PROVEEDOR',    -- valorizada: sale al costo de la compra y lo retira del promedio
  -- contramovimiento
  'REVERSA'                  -- cantidad y costo opuestos al movimiento original
);

-- ---------------------------------------------------------------- fórmula (función pura)
-- p_q_prev, p_a_prev : saldo total del producto y su costo promedio antes del movimiento
-- p_q_mov            : cantidad con signo del movimiento, en unidad base
-- p_cu               : costo unitario del movimiento (null = sin costo conocido)
-- p_retira_costo     : la salida saca SU costo del promedio (devolución o reversa de una entrada)
--
-- Reglas:
--   Entrada con costo:  A' = (Q·A + q·c) / (Q + q).  Si no hay promedio o el saldo era ≤ 0, A' = c.
--   Entrada sin costo:  A' = A (entra valorizada al promedio vigente).
--   Salida normal:      A' = A (sale al promedio: no lo cambia).
--   Salida que retira:  A' = (Q·A − |q|·c) / (Q − |q|), solo si queda saldo > 0 y el resultado ≥ 0;
--                       si no, A' = A.
create or replace function privado.nuevo_promedio(p_q_prev numeric, p_a_prev numeric,
                                                  p_q_mov numeric, p_cu numeric,
                                                  p_retira_costo boolean default false)
returns numeric
language plpgsql immutable
as $$
declare v numeric;
begin
  if p_q_mov is null or p_q_mov = 0 then
    raise exception 'La cantidad del movimiento no puede ser cero.';
  end if;
  if p_q_mov > 0 then
    if p_cu is null then return p_a_prev; end if;
    if p_a_prev is null or coalesce(p_q_prev, 0) <= 0 then return round(p_cu, 6); end if;
    return round((p_q_prev * p_a_prev + p_q_mov * p_cu) / (p_q_prev + p_q_mov), 6);
  end if;
  -- salida
  if not p_retira_costo or p_cu is null or p_a_prev is null then return p_a_prev; end if;
  if coalesce(p_q_prev, 0) + p_q_mov <= 0 then return p_a_prev; end if;
  v := (p_q_prev * p_a_prev + p_q_mov * p_cu) / (p_q_prev + p_q_mov);
  if v < 0 then return p_a_prev; end if;
  return round(v, 6);
end
$$;

-- ---------------------------------------------------------------- tablas
create table public.movimientos (
  id               bigint generated always as identity primary key,
  fecha            date not null,                      -- fecha operativa
  registrado_en    timestamptz not null default now(),
  tipo             public.tipo_movimiento not null,
  producto_id      uuid not null references public.productos (id),
  ubicacion        text not null references public.ubicaciones (codigo),
  cantidad         numeric not null check (cantidad <> 0),  -- unidad base, con signo
  costo_unitario   numeric check (costo_unitario >= 0),     -- $ por unidad base
  costo_total      numeric generated always as (cantidad * costo_unitario) stored,
  saldo_producto   numeric not null,   -- saldo total del producto después del movimiento
  saldo_ubicacion  numeric not null,   -- saldo en la ubicación después del movimiento
  costo_promedio   numeric,            -- promedio del producto después del movimiento
  documento_tipo   text not null,
  documento_id     uuid,
  linea_id         uuid,
  reversa_de       bigint unique references public.movimientos (id),
  motivo           text,
  usuario_id       uuid default auth.uid(),
  check ((tipo = 'REVERSA') = (reversa_de is not null))
);

create index movimientos_producto_idx on public.movimientos (producto_id, id);
create index movimientos_documento_idx on public.movimientos (documento_tipo, documento_id);

create trigger movimientos_inmutables
  before update or delete on public.movimientos
  for each row execute function privado.bloquear_cambios();

-- Saldos vigentes: los escribe SOLO privado.registrar_movimiento.
create table public.existencias (
  producto_id    uuid not null references public.productos (id),
  ubicacion      text not null references public.ubicaciones (codigo),
  cantidad       numeric not null default 0,
  actualizado_en timestamptz not null default now(),
  primary key (producto_id, ubicacion)
);

create table public.costos_producto (
  producto_id        uuid primary key references public.productos (id),
  cantidad           numeric not null default 0,
  costo_promedio     numeric,
  ultimo_movimiento  bigint references public.movimientos (id),
  actualizado_en     timestamptz not null default now()
);

-- Costo de referencia por producto, calculado de las compras históricas de los Sheets o
-- medido a mano. Solo valoriza el SALDO_INICIAL del primer conteo: el kardex manda después.
create table public.costos_referencia (
  producto_id          uuid primary key references public.productos (id),
  costo_unitario_base  numeric not null check (costo_unitario_base >= 0),
  fuente               text not null,
  n_compras            integer,
  ultima_compra        date,
  calculado_en         date not null default current_date
);

-- ---------------------------------------------------------------- registro de un movimiento
-- Único camino de escritura al kardex. Bloquea la fila de costo del producto, aplica la
-- fórmula y deja en el movimiento la foto del saldo y del promedio resultantes.
create or replace function privado.registrar_movimiento(
  p_tipo            public.tipo_movimiento,
  p_producto        uuid,
  p_ubicacion       text,
  p_cantidad        numeric,           -- magnitud > 0; el signo lo pone el tipo (ignorada en REVERSA)
  p_fecha           date,
  p_costo_unitario  numeric default null,
  p_documento_tipo  text default null,
  p_documento_id    uuid default null,
  p_linea_id        uuid default null,
  p_reversa_de      bigint default null,
  p_motivo          text default null
) returns public.movimientos
language plpgsql security definer set search_path = ''
as $$
declare
  v_orig      public.movimientos;
  v_q         numeric;
  v_cu        numeric;
  v_retira    boolean := false;
  v_q_prev    numeric;
  v_a_prev    numeric;
  v_a_nuevo   numeric;
  v_saldo_ub  numeric;
  v_ubicacion text := p_ubicacion;
  v_producto  uuid := p_producto;
  v_mov       public.movimientos;
begin
  if p_tipo = 'REVERSA' then
    select * into v_orig from public.movimientos where id = p_reversa_de;
    if not found then raise exception 'No existe el movimiento % a reversar.', p_reversa_de; end if;
    if v_orig.tipo = 'REVERSA' then raise exception 'Una reversa no se reversa: registre el movimiento correcto.'; end if;
    if exists (select 1 from public.movimientos m where m.reversa_de = v_orig.id) then
      raise exception 'El movimiento % ya fue reversado.', v_orig.id;
    end if;
    v_producto  := v_orig.producto_id;
    v_ubicacion := v_orig.ubicacion;
    v_q         := -v_orig.cantidad;
    v_cu        := v_orig.costo_unitario;
    v_retira    := v_orig.cantidad > 0;     -- deshacer una entrada retira su costo del promedio
  else
    if p_reversa_de is not null then raise exception 'reversa_de solo aplica a REVERSA.'; end if;
    if p_cantidad is null or p_cantidad <= 0 then
      raise exception 'Cantidad no válida (%): debe ser mayor que cero.', p_cantidad;
    end if;
    v_q := case when p_tipo in ('SALDO_INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_PRODUCCION',
                                'AJUSTE_CONTEO_POSITIVO', 'TRASLADO_ENTRADA')
                then p_cantidad else -p_cantidad end;
    -- ENTRADA_COMPRA puede llegar sin costo solo si la recepción se forzó sin precio (B6), y
    -- SALDO_INICIAL si el producto no tiene costo de referencia: entran sin valor y la primera
    -- compra fija el promedio.
    if p_tipo = 'DEVOLUCION_PROVEEDOR' and p_costo_unitario is null then
      raise exception '% necesita costo unitario.', p_tipo;
    end if;
    v_retira := p_tipo = 'DEVOLUCION_PROVEEDOR';
  end if;

  -- fila de costo bloqueada: dos iPads no pueden pisarse el promedio
  insert into public.costos_producto (producto_id) values (v_producto) on conflict do nothing;
  select c.cantidad, c.costo_promedio into v_q_prev, v_a_prev
    from public.costos_producto c where c.producto_id = v_producto for update;

  if p_tipo <> 'REVERSA' then
    v_cu := case when p_tipo in ('SALDO_INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_PRODUCCION', 'DEVOLUCION_PROVEEDOR')
                 then p_costo_unitario
                 else v_a_prev end;   -- los demás entran o salen al promedio vigente
  end if;

  v_a_nuevo := privado.nuevo_promedio(v_q_prev, v_a_prev, v_q, v_cu, v_retira);

  insert into public.existencias as e (producto_id, ubicacion, cantidad)
  values (v_producto, v_ubicacion, v_q)
  on conflict (producto_id, ubicacion)
  do update set cantidad = e.cantidad + excluded.cantidad, actualizado_en = now()
  returning e.cantidad into v_saldo_ub;

  insert into public.movimientos (fecha, tipo, producto_id, ubicacion, cantidad, costo_unitario,
                                  saldo_producto, saldo_ubicacion, costo_promedio,
                                  documento_tipo, documento_id, linea_id, reversa_de, motivo)
  values (coalesce(p_fecha, case when p_tipo = 'REVERSA' then privado.hoy() end),
          p_tipo, v_producto, v_ubicacion, v_q, v_cu,
          v_q_prev + v_q, v_saldo_ub, v_a_nuevo,
          coalesce(p_documento_tipo, case when p_tipo = 'REVERSA' then v_orig.documento_tipo end),
          coalesce(p_documento_id, case when p_tipo = 'REVERSA' then v_orig.documento_id end),
          coalesce(p_linea_id, case when p_tipo = 'REVERSA' then v_orig.linea_id end),
          case when p_tipo = 'REVERSA' then v_orig.id end, p_motivo)
  returning * into v_mov;

  update public.costos_producto
     set cantidad = v_q_prev + v_q, costo_promedio = v_a_nuevo,
         ultimo_movimiento = v_mov.id, actualizado_en = now()
   where producto_id = v_producto;

  return v_mov;
end
$$;

-- ---------------------------------------------------------------- costo vigente de un genérico
-- Ficha y receta piden genéricos; el kardex lleva productos. El costo del genérico es el
-- promedio de sus productos ponderado por existencias; sin existencias, el promedio del
-- producto que se movió por última vez.
create or replace function privado.costo_vigente_generico(p_generico uuid)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select sum(c.cantidad * c.costo_promedio) / nullif(sum(c.cantidad), 0)
       from public.costos_producto c join public.productos p on p.id = c.producto_id
      where p.generico_id = p_generico and c.cantidad > 0 and c.costo_promedio is not null),
    (select c.costo_promedio
       from public.costos_producto c join public.productos p on p.id = c.producto_id
      where p.generico_id = p_generico and c.costo_promedio is not null
      order by c.ultimo_movimiento desc nulls last limit 1))
$$;

-- ---------------------------------------------------------------- costo estándar de una ficha
-- Costo de MPI, plato o bebida = Σ (cantidad de la ficha en unidad base × costo vigente).
-- Las líneas SIN_COSTO valen $0. Una línea sin cantidad, sin conversión o sin costo
-- deja la ficha INCOMPLETA y dice qué falta.
create or replace function public.costo_ficha(p_ficha uuid)
returns table (linea integer, generico_id uuid, generico text, cantidad numeric, unidad text,
               cantidad_base numeric, costo_unitario numeric, costo numeric, falta text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.ve_costos() then raise exception 'Sin permiso para ver costos.'; end if;
  return query
  select l.linea, g.id, g.nombre, l.cantidad, l.unidad, b.base, cu.valor,
         case when g.tipo = 'SIN_COSTO' or b.traza then 0 else b.base * cu.valor end,
         case
           when l.cantidad is null then 'La ficha no trae cantidad de ' || g.nombre
           when b.traza then null
           when b.base is null then 'Falta la conversión ' || l.unidad || '→' || g.unidad_base || ' de ' || g.nombre
           when g.tipo <> 'SIN_COSTO' and cu.valor is null then 'Sin costo vigente de ' || g.nombre
         end
    from public.ficha_lineas l
    join public.genericos g on g.id = l.generico_id
    -- dash, gotas: traza sin conversión medida = $0 (regla de SGI-COSTOS v1.1)
    cross join lateral (select x.base, (x.base is null and lower(l.unidad) in ('dash', 'gts', 'gota')) as traza
                          from (select privado.a_base(g.id, l.cantidad, l.unidad) as base) x) b
    cross join lateral (select case when g.tipo = 'SIN_COSTO' then 0::numeric
                                    else privado.costo_vigente_generico(g.id) end as valor) cu
   where l.ficha_id = p_ficha
   order by l.linea;
end
$$;

-- ---------------------------------------------------------------- vistas (respetan RLS del usuario)
create view public.v_kardex with (security_invoker = true) as
select m.id, m.fecha, m.registrado_en, m.tipo, p.codigo as producto_codigo, g.nombre as generico,
       p.marca, p.presentacion, g.unidad_base, m.ubicacion, m.cantidad, m.costo_unitario, m.costo_total,
       m.saldo_ubicacion, m.saldo_producto, m.costo_promedio, m.documento_tipo, m.documento_id,
       m.reversa_de, m.motivo, m.usuario_id
  from public.movimientos m
  join public.productos p on p.id = m.producto_id
  join public.genericos g on g.id = p.generico_id;

create view public.v_existencias with (security_invoker = true) as
select e.producto_id, p.codigo as producto_codigo, g.nombre as generico, p.marca, p.presentacion,
       g.unidad_base, g.area, e.ubicacion, e.cantidad, c.costo_promedio,
       e.cantidad * c.costo_promedio as valor
  from public.existencias e
  join public.productos p on p.id = e.producto_id
  join public.genericos g on g.id = p.generico_id
  left join public.costos_producto c on c.producto_id = e.producto_id;

create view public.v_costo_fichas with (security_invoker = true) as
select f.id as ficha_id, f.codigo, g.nombre as resultado, g.tipo, f.version, f.neto_esperado,
       t.total, t.lineas, t.lineas_con_costo,
       (t.lineas = t.lineas_con_costo) as completa,
       case when t.lineas = t.lineas_con_costo and f.neto_esperado > 0 then t.total / f.neto_esperado end
         as costo_por_unidad_neta,
       pv.precio_con_impuesto,
       case when t.lineas = t.lineas_con_costo and pv.precio_con_impuesto > 0
            then t.total / (pv.precio_con_impuesto / (1 + privado.parametro_num('IMPOCONSUMO_PCT', 8) / 100))
       end as pct_costo,
       t.faltantes
  from public.fichas f
  join public.genericos g on g.id = f.generico_id
  cross join lateral (
    select coalesce(sum(c.costo), 0) as total, count(*) as lineas,
           count(*) filter (where c.falta is null) as lineas_con_costo,
           array_remove(array_agg(c.falta), null) as faltantes
      from public.costo_ficha(f.id) c) t
  left join lateral (
    select v.precio_con_impuesto from public.precios_venta v
     where v.generico_id = f.generico_id and v.vigente_desde <= current_date
     order by v.vigente_desde desc limit 1) pv on true
 where f.vigente_hasta is null or f.vigente_hasta >= current_date;

-- ---------------------------------------------------------------- RLS
alter table public.movimientos     enable row level security;
alter table public.existencias     enable row level security;
alter table public.costos_producto enable row level security;
alter table public.costos_referencia enable row level security;
create policy costos_referencia_leer on public.costos_referencia for select to authenticated using (privado.ve_costos());
create policy costos_referencia_escribir on public.costos_referencia for insert to authenticated with check (privado.tiene_rol('admin'));
create policy costos_referencia_editar on public.costos_referencia for update to authenticated using (privado.tiene_rol('admin'));
revoke all on public.costos_referencia from anon;
create trigger costos_referencia_auditar after insert or update on public.costos_referencia
  for each row execute function privado.auditar();

create policy movimientos_leer     on public.movimientos     for select to authenticated using (privado.ve_costos());
create policy existencias_leer     on public.existencias     for select to authenticated using (privado.ve_costos());
create policy costos_producto_leer on public.costos_producto for select to authenticated using (privado.ve_costos());

revoke all on public.movimientos, public.existencias, public.costos_producto from anon;
revoke insert, update, delete, truncate on public.movimientos, public.existencias, public.costos_producto from authenticated;
revoke all on public.v_kardex, public.v_existencias, public.v_costo_fichas from anon;
