-- =====================================================================================
-- SGI Di Égida · Taras de los envases de subprocesos de bar (siropes, zumos, picadillos,
-- licores macerados, garnituras)
-- Fuente: referencia/REG-INV-BAR-002-2026_09_21.xlsx, hoja «Subprocesos (semanal)», col. F
-- «Tara (gr)». Las taras de botellas de licor/vino ya vienen en historico_bar.sql.
-- Todos estos subprocesos se llevan en gramos: basta la tara, no hace falta densidad.
-- Con esto la hoja de conteo puede pesar el envase abierto y restarle el envase.
-- Idempotente: solo llena taras que falten; no pisa una tara que ya se haya pesado en la app.
-- No se cargan las filas sin tara en el Excel (Sirope di fiore, Orchata Di Égida).
-- =====================================================================================

create temporary table _tara_envase (codigo text primary key, tara_g numeric not null, envase text not null) on commit drop;

insert into _tara_envase (codigo, tara_g, envase) values
  -- botella de sirope (390 g)
  ('BAR_MPi_0006-GR', 390, 'Sirope simple'),
  ('BAR_MPi_0013-GR', 390, 'Sirope Stella Du Solei'),
  ('BAR_MPi_0014-GR', 390, 'Sirope Stella Di Mango'),
  ('BAR_MPi_0015-GR', 390, 'Sirope Stella Di Rosso'),
  ('BAR_MPi_0065-GR', 390, 'Miel de jengibre'),
  ('BAR_MPi_0009-GR', 390, 'Sirope de cardamomo'),
  ('BAR_MPi_0010-GR', 390, 'Sirope de naranja amarga'),
  ('BAR_MPi_0011-GR', 390, 'Sirope de romero'),
  ('BAR_MPi_0080-GR', 390, 'Sirope de canela'),
  ('BAR_MPi_0020-GR', 390, 'Sirope de chamoy'),
  ('BAR_MPi_0019-GR', 390, 'Sirope de tabaco-naranja'),
  ('BAR_MPi_0068-GR', 390, 'Clarificado piña romero'),
  ('BAR_MPi_0023-GR', 390, 'Sirope Morfeo Pee'),
  ('BAR_MPi_0017-GR', 390, 'Sirope Pinefizz'),
  ('BAR_MPi_0018-GR', 390, 'Sirope Scarlet Kiss'),
  ('BAR_MPi_0028-GR', 390, 'Sirope Green Velvet'),
  ('BAR_MPi_0016-GR', 390, 'Sirope de tamarindo'),
  ('BAR_MPi_0032-GR', 390, 'Sirope de manzanilla'),
  ('BAR_MPi_0012-GR', 390, 'Mix de cítricos'),
  ('BAR_MPi_0001-GR', 390, 'Zumo de limón'),
  ('BAR_MPi_0003-GR', 390, 'Zumo de naranja'),
  ('BAR_MPi_0002-GR', 390, 'Zumo manzana-pera'),
  -- envase de picadillo (193 g)
  ('BAR_MPi_0021-GR', 193, 'Picadillo sangría tradicional'),
  ('BAR_MPi_0022-GR', 193, 'Picadillo Morfeo Pee'),
  ('BAR_MPi_0024-GR', 193, 'Picadillo Fairy Blood'),
  ('BAR_MPi_0027-GR', 193, 'Picadillo Green Velvet'),
  -- botella de licor macerado (622 g)
  ('BAR_MPi_0030-GR', 622, 'Licor de vainilla'),
  ('BAR_MPi_0039-GR', 622, 'Licor de Jamaica'),
  ('BAR_MPi_0036-GR', 622, 'Licor de menta fresca'),
  ('BAR_MPi_0033-GR', 622, 'Licor de manzanilla'),
  ('BAR_MPi_0042-GR', 622, 'Licor de limoncillo'),
  ('BAR_MPi_0067-GR', 622, 'Gin especiado con clitoria'),
  -- frascos propios
  ('BAR_MPi_0044-GR', 788, 'Cerezas maceradas en vermouth'),
  ('BAR_MPi_0043-GR', 509, 'Láminas de jengibre'),
  ('BAR_MPi_0046-GR', 614, 'Sal de fresa'),
  ('BAR_MPi_0047-GR', 1359, 'Garnitura de limón'),
  ('BAR_MPi_0048-GR', 457, 'Garnitura fideos de naranja');

do $$
declare v text;
begin
  select string_agg(t.codigo, ', ') into v
    from _tara_envase t left join public.productos p on p.codigo = t.codigo where p.id is null;
  if v is not null then raise exception 'Códigos de producto que no están en el catálogo: %', v; end if;
end $$;

insert into public.taras (producto_id, tara_g, densidad_g_ml, medido_en)
select p.id, t.tara_g, null, date '2026-09-21'
  from _tara_envase t join public.productos p on p.codigo = t.codigo
on conflict (producto_id) do update
   set tara_g = excluded.tara_g, medido_en = excluded.medido_en
 where public.taras.tara_g is null;
