-- =====================================================================================
-- SGI Di Égida · 07 · Pares del catálogo por revisar
-- El catálogo unificado (scripts/migracion/unificar.mjs) se carga sin esperar a que se decidan
-- los posibles duplicados: cada par queda aquí y lo decide el jefe del área desde la app.
-- Mientras tanto los dos genéricos siguen separados; lo nuevo entró PROVISIONAL.
-- =====================================================================================

create table public.revision_catalogo (
  id            text primary key,                          -- par estable: «INV:aceite…|RCOC:aceite…»
  area          public.area_app not null,
  tipo          text not null check (tipo in ('DUPLICADO', 'CASI-DUPLICADO')),
  parecido      numeric not null check (parecido between 0 and 1),
  propuesta     text not null check (propuesta in ('FUSIONAR', 'SEPARAR', 'REVISAR')),
  motivo        text,
  a_fuente      text not null,
  a_nombre      text not null,
  a_generico_id uuid references public.genericos (id),     -- null si la fuente no quedó ubicada
  b_fuente      text not null,
  b_nombre      text not null,
  b_generico_id uuid references public.genericos (id),
  decision      text check (decision in ('FUSIONAR', 'SEPARAR')),
  decidido_por  uuid references public.perfiles (id),
  decidido_en   timestamptz,
  nota          text,
  creado_en     timestamptz not null default now(),
  check ((decision is null) = (decidido_en is null))
);

comment on table public.revision_catalogo is
  'Posibles duplicados del catálogo migrado. Se decide en la app; nada se fusiona sin una persona.';

create index revision_catalogo_pendientes on public.revision_catalogo (area) where decision is null;

create trigger revision_catalogo_auditar after insert or update on public.revision_catalogo
  for each row execute function privado.auditar();
create trigger revision_catalogo_sin_borrado before delete on public.revision_catalogo
  for each row execute function privado.bloquear_cambios();

-- Lee quien edita el maestro del área (y auditoría). Nadie escribe directo: la decisión llega
-- por una RPC que también hace la fusión.
alter table public.revision_catalogo enable row level security;
revoke all on public.revision_catalogo from anon;
revoke insert, update, delete, truncate on public.revision_catalogo from authenticated;
create policy revision_catalogo_leer on public.revision_catalogo
  for select to authenticated using (privado.edita_area(area) or privado.tiene_rol('auditor'));
