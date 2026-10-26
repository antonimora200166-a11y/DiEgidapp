-- =====================================================================================
-- SGI Di Égida · 10 · Errores de la app
-- Lo que falla en el servidor (Next) o en el celular de alguien queda aquí para que
-- administración se entere sin esperar a que se lo cuenten. Solo se agrega; no se edita.
-- =====================================================================================

create table public.errores_app (
  id           bigint generated always as identity primary key,
  ocurrido_en  timestamptz not null default now(),
  origen       text not null check (origen in ('SERVIDOR', 'NAVEGADOR')),
  usuario_id   uuid default auth.uid(),
  ruta         text,
  mensaje      text not null,
  detalle      text,
  agente       text,                           -- navegador y equipo
  huella       text                            -- digest de Next para cruzar con el registro de Vercel
);
create index errores_app_recientes on public.errores_app (ocurrido_en desc);

create trigger errores_app_inmutable before update or delete on public.errores_app
  for each row execute function privado.bloquear_cambios();

alter table public.errores_app enable row level security;
revoke all on public.errores_app from anon;
revoke insert, update, delete, truncate on public.errores_app from authenticated;
create policy errores_app_leer on public.errores_app
  for select to authenticated using (privado.tiene_rol('admin', 'auditor'));

-- Desde el navegador: cualquier usuario con sesión puede reportar un error suyo. Se recorta todo
-- para que un cliente defectuoso no llene la tabla con textos enormes.
create or replace function public.reportar_error(p_ruta text, p_mensaje text, p_detalle text default null,
                                                 p_agente text default null, p_huella text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then return; end if;
  -- como mucho 30 reportes por usuario por hora (un error en bucle no inunda la tabla)
  if (select count(*) from public.errores_app e where e.usuario_id = auth.uid() and e.ocurrido_en > now() - interval '1 hour') >= 30 then
    return;
  end if;
  insert into public.errores_app (origen, ruta, mensaje, detalle, agente, huella)
  values ('NAVEGADOR', left(p_ruta, 300), left(coalesce(nullif(trim(p_mensaje), ''), '(sin mensaje)'), 500),
          left(p_detalle, 4000), left(p_agente, 300), left(p_huella, 100));
end
$$;

revoke execute on function public.reportar_error(text, text, text, text, text) from public, anon;
grant execute on function public.reportar_error(text, text, text, text, text) to authenticated;
