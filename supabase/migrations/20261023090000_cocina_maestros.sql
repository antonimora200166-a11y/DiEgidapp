-- =====================================================================================
-- SGI Di Égida · 05 · Maestros que pide cocina
-- Cadena de frío del genérico (FMT-REC-COC-003: régimen de conservación y temperatura
-- máxima de llegada) y la ubicación de cada producto por zona (INV-COC-001: CAT_UBICACION),
-- que ordena la hoja de conteo y lleva el mínimo por zona.
-- =====================================================================================

alter table public.genericos
  add column conservacion text check (conservacion in ('Ambiente', 'Refrigerado', 'Congelado')),
  add column temp_max_llegada numeric check (temp_max_llegada between -30 and 30);

comment on column public.genericos.temp_max_llegada is
  'Temperatura máxima (°C) con que se acepta en la recepción. Base de la compuerta de cadena de frío.';

-- Bar y cocina compran cosas con el mismo nombre («Limón Tahití», «Pera»): un alias es único
-- dentro de su área, no en todo el sistema. El área sale del genérico al que apunta.
alter table public.alias add column area public.area_app;
update public.alias a set area = g.area from public.genericos g where g.id = a.generico_id;
alter table public.alias alter column area set not null;
alter table public.alias drop constraint alias_fuente_alias_norm_key;
alter table public.alias add constraint alias_area_fuente_alias_norm_key unique (area, fuente, alias_norm);

create or replace function privado.alias_area()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.area := (select g.area from public.genericos g where g.id = new.generico_id);
  return new;
end
$$;
create trigger alias_area before insert or update of generico_id on public.alias
  for each row execute function privado.alias_area();
revoke execute on function privado.alias_area() from public;

create table public.ubicacion_productos (
  ubicacion    text not null references public.ubicaciones (codigo),
  producto_id  uuid not null references public.productos (id),
  orden        integer,                                  -- orden de recorrido en el conteo
  minimo       numeric check (minimo >= 0),              -- en unidades de conteo, para esa zona
  activo       boolean not null default true,
  primary key (ubicacion, producto_id)
);

create trigger ubicacion_productos_auditar after insert or update on public.ubicacion_productos
  for each row execute function privado.auditar();
create trigger ubicacion_productos_sin_borrado before delete on public.ubicacion_productos
  for each row execute function privado.bloquear_cambios();

alter table public.ubicacion_productos enable row level security;
revoke all on public.ubicacion_productos from anon;
create policy ubicacion_productos_leer on public.ubicacion_productos
  for select to authenticated using (privado.usuario_activo());
create policy ubicacion_productos_escribir on public.ubicacion_productos for insert to authenticated
  with check (privado.edita_generico((select p.generico_id from public.productos p where p.id = producto_id)));
create policy ubicacion_productos_editar on public.ubicacion_productos for update to authenticated
  using (privado.edita_generico((select p.generico_id from public.productos p where p.id = producto_id)));
