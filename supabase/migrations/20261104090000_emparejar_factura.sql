-- =====================================================================================
-- SGI Di Égida · Recibir: emparejar las líneas de la factura con el catálogo
-- buscar_productos ponía al mismo nivel «Zanahoria» y «Zanahoria Ahumada» (word_similarity
-- da 1 a todo lo que contiene la palabra) y se confundía con el relleno de las facturas
-- («NARANJA COMUN 2,5KG», «UCHUVA TARRINA»). emparejar_factura:
--   · limpia la descripción: cantidades con unidad, números y palabras de relleno;
--   · solo mira lo que se recibe (MPe activos del área);
--   · puntúa por parecido total, por cuánto de la factura está en el nombre y, con más peso,
--     por cuánto del nombre del producto está completo en la factura;
--   · un nombre igual vale 1; un alias aprendido (factura o inventario anterior), 0,97: si hay
--     un producto que se llama igual, gana ese.
-- Devuelve hasta 4 candidatos por línea, en el orden de las descripciones.
-- =====================================================================================

-- palabras que en una factura no dicen qué producto es
create or replace function privado.limpiar_factura(p text)
returns text
language sql immutable set search_path = ''
as $$
  select trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    privado.normalizar(coalesce(p, '')), '[^a-z0-9., ]', ' ', 'g'),
    '\m[0-9]+([.,][0-9]+)?\s*(kg|kgs|kl|g|gr|grs|lb|lbs|ml|l|lt|lts|cc|und|un|oz)\M', ' ', 'g'),
    '\m[0-9]+([.,][0-9]+)?\M', ' ', 'g'),
    '[.,]', ' ', 'g'),
    '\m(comun|corriente|tarrina|malla|unidad|unidades|und|libra|libras|media|x|de|del|la|el|los|las|por|bolsa|paquete|'
      || 'fresco|fresca|frescos|frescas|nacional|premium|extra|selecta|tipo|kilo|kilos)\M', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;

-- el nombre del catálogo, sin artículos ni «(fresco)»: «Cilantro (fresco)» → «cilantro»
create or replace function privado.limpiar_nombre(p text)
returns text
language sql immutable set search_path = ''
as $$
  select trim(regexp_replace(regexp_replace(regexp_replace(privado.normalizar(coalesce(p, '')), '[^a-z0-9 ]', ' ', 'g'),
    '\m(de|del|la|el|los|las|fresco|fresca|frescos|frescas)\M', ' ', 'g'), '\s+', ' ', 'g'))
$$;

create or replace function public.emparejar_factura(p_area public.area_app, p_textos text[])
returns table (n integer, producto_id uuid, parecido numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not privado.puede_operar(p_area) then
    raise exception 'Sin permiso para recibir en %.', p_area using errcode = '42501';
  end if;
  return query
  with t as (
    select x.n::int as n, privado.normalizar(x.txt) as crudo, privado.limpiar_factura(x.txt) as q
      from unnest(p_textos) with ordinality as x(txt, n)
  ), pr as (
    select p.id, g.id as gid, privado.limpiar_nombre(g.nombre) as nom, length(g.nombre) as largo
      from public.productos p join public.genericos g on g.id = p.generico_id
     where p.activo and g.activo and g.area = p_area and g.tipo = 'MPe'
  ), por_nombre as (
    select t.n, pr.id, pr.largo,
           case when t.q = pr.nom then 1
                else 0.35 * extensions.similarity(t.q, pr.nom) + 0.25 * extensions.word_similarity(t.q, pr.nom)
                   + 0.40 * extensions.word_similarity(pr.nom, t.q) end as s
      from t cross join pr where t.q <> ''
  ), por_alias as (
    -- un nombre de factura ya confirmado en una recepción anterior
    select t.n, pr.id, pr.largo, 0.97::double precision as s
      from t join public.alias a on a.alias_norm = t.crudo and a.fuente in ('RECEPCION', 'INVENTARIO')
      join pr on pr.gid = a.generico_id and (a.producto_id is null or a.producto_id = pr.id)
  ), mejor as (
    select distinct on (u.n, u.id) u.n, u.id, u.largo, u.s
      from (select * from por_nombre union all select * from por_alias) u
     where u.s >= 0.35
     order by u.n, u.id, u.s desc
  ), orden as (
    select m.*, row_number() over (partition by m.n order by m.s desc, m.largo) as k from mejor m
  )
  select o.n, o.id, round(o.s::numeric, 2) from orden o where o.k <= 4 order by o.n, o.k;
end
$$;

revoke execute on function public.emparejar_factura(public.area_app, text[]) from public, anon;
grant execute on function public.emparejar_factura(public.area_app, text[]) to authenticated;
