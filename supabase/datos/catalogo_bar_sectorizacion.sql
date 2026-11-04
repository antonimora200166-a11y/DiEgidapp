-- =====================================================================================
-- SGI Di Égida · Altas del bar que pide la sectorización de la barra (2026-11-04)
-- 1. Productos del documento que no estaban en el catálogo (consumibles, desechables, aseo) y
--    el menaje: vasos, copas, herramientas y equipos, en las categorías nuevas MENAJE y ASEO.
--    Entran PROVISIONALES, como un alta desde la app: el jefe de bar los valida.
-- 2. Las zonas que solo guardan menaje y la asignación de lo nuevo a su zona.
-- Va después de zonas_bar.sql. Idempotente: si el genérico ya existe (mismo nombre en BAR) no se
-- vuelve a crear; las asignaciones actualizan el orden, no borran nada.
-- =====================================================================================

insert into public.categorias (codigo, nombre, area) values
  ('MENAJE', 'Menaje, equipos y herramientas', 'BAR'),
  ('ASEO',   'Aseo y limpieza', 'BAR')
on conflict do nothing;

create temp table _alta (nombre text, tipo public.tipo_generico, categoria text, ub public.unidad_base,
                         marca text, presentacion text, ucompra text, contenido numeric, variable boolean)
  on commit drop;

insert into _alta values
  -- consumibles que faltaban
  ('Disaronno Velvet', 'MPe', 'LICOR', 'ml', 'Disaronno Velvet', 'Botella 700 ml', 'BOT', 700, false),
  ('Licor neutro 80°', 'MPe', 'LICOR', 'ml', '', 'Presentación por confirmar', 'BOT', null, true),
  ('Licor De Naranja Con Jengibre', 'MPI', 'MPI', 'g', '', 'Producción propia', 'GR', 1, false),
  ('Ginger Sweepers 1.5 (finalizador sangría)', 'MPI', 'MPI', 'g', '', 'Producción propia', 'GR', 1, false),
  ('Hielo perfect cubo', 'MPI', 'MPI', 'g', '', 'Producción propia', 'GR', 1, false),
  ('Hielo perfect bola', 'MPI', 'MPI', 'g', '', 'Producción propia', 'GR', 1, false),
  ('Láminas de limón', 'MPI', 'MPI', 'g', '', 'Producción propia', 'GR', 1, false),
  ('Láminas de naranja', 'MPI', 'MPI', 'g', '', 'Producción propia', 'GR', 1, false),
  ('Isomalta granular', 'MPe', 'INSUMO_SECO', 'g', '', 'Granel', 'GR', 1, false),
  ('Tajín', 'MPe', 'INSUMO_SECO', 'g', '', 'Granel', 'GR', 1, false),
  ('Té Bitaco vainilla', 'MPe', 'INSUMO_SECO', 'g', 'Bitaco', 'Granel', 'GR', 1, false),
  ('Salsa Worcestershire', 'MPe', 'INSUMO_SECO', 'ml', '', 'Granel', 'ML', 1, false),
  ('Extracto de malta', 'MPe', 'INSUMO_SECO', 'ml', '', 'Granel', 'ML', 1, false),
  ('Escarcha diamantina violeta', 'MPe', 'INSUMO_SECO', 'g', '', 'Granel', 'GR', 1, false),
  ('Escarcha diamantina azul agua marina', 'MPe', 'INSUMO_SECO', 'g', '', 'Granel', 'GR', 1, false),
  ('Escarcha diamantina azul rey', 'MPe', 'INSUMO_SECO', 'g', '', 'Granel', 'GR', 1, false),
  ('Escarcha diamantina tornasol blanca', 'MPe', 'INSUMO_SECO', 'g', '', 'Granel', 'GR', 1, false),
  ('Escarcha murano tornasol azul', 'MPe', 'INSUMO_SECO', 'g', '', 'Granel', 'GR', 1, false),
  ('Escarcha murano tornasol verde', 'MPe', 'INSUMO_SECO', 'g', '', 'Granel', 'GR', 1, false),
  ('Matizante perlado amarillo', 'MPe', 'INSUMO_SECO', 'g', '', 'Granel', 'GR', 1, false),
  ('Matizante perlado azul rey', 'MPe', 'INSUMO_SECO', 'g', '', 'Granel', 'GR', 1, false),
  ('Matizante perlado verde esmeralda', 'MPe', 'INSUMO_SECO', 'g', '', 'Granel', 'GR', 1, false),
  ('Matizante perlado naranja', 'MPe', 'INSUMO_SECO', 'g', '', 'Granel', 'GR', 1, false),
  ('Matizante perlado violeta', 'MPe', 'INSUMO_SECO', 'g', '', 'Granel', 'GR', 1, false),
  ('Matizante perlado azul cielo', 'MPe', 'INSUMO_SECO', 'g', '', 'Granel', 'GR', 1, false),
  ('Colorante comestible frambuesa', 'MPe', 'INSUMO_SECO', 'ml', '', 'Granel', 'ML', 1, false),
  ('Colorante comestible lila', 'MPe', 'INSUMO_SECO', 'ml', '', 'Granel', 'ML', 1, false),
  ('Colorante comestible azul', 'MPe', 'INSUMO_SECO', 'ml', '', 'Granel', 'ML', 1, false),
  ('Colorante comestible color piel', 'MPe', 'INSUMO_SECO', 'ml', '', 'Granel', 'ML', 1, false),
  ('Colorante comestible rojo', 'MPe', 'INSUMO_SECO', 'ml', '', 'Granel', 'ML', 1, false),
  -- desechables
  ('Palillos de decoración', 'MPe', 'DESECHABLE', 'und', '', 'Unidad', 'UND', 1, false),
  ('Rótulos', 'MPe', 'DESECHABLE', 'und', '', 'Unidad', 'UND', 1, false),
  ('Vaso desechable frío/caliente', 'MPe', 'DESECHABLE', 'und', '', 'Unidad', 'UND', 1, false),
  ('Vaso desechable 16 oz', 'MPe', 'DESECHABLE', 'und', '', 'Unidad', 'UND', 1, false),
  ('Pitillos', 'MPe', 'DESECHABLE', 'und', '', 'Unidad', 'UND', 1, false),
  ('Tapas verdes', 'MPe', 'DESECHABLE', 'und', '', 'Unidad', 'UND', 1, false),
  ('Bolsas de basura', 'MPe', 'DESECHABLE', 'und', '', 'Unidad', 'UND', 1, false),
  ('Rollo de papel craft', 'MPe', 'DESECHABLE', 'und', '', 'Unidad', 'UND', 1, false),
  ('Bolsa ziploc 20 x 35', 'MPe', 'DESECHABLE', 'und', '', 'Unidad', 'UND', 1, false),
  ('Bolsa ziploc 10 x 22', 'MPe', 'DESECHABLE', 'und', '', 'Unidad', 'UND', 1, false),
  ('Waypal', 'MPe', 'DESECHABLE', 'und', '', 'Unidad', 'UND', 1, false),
  ('Gas butano', 'MPe', 'DESECHABLE', 'und', '', 'Unidad', 'UND', 1, false),
  -- aseo
  ('Jabón en polvo', 'MPe', 'ASEO', 'und', '', 'Unidad', 'UND', 1, false),
  ('Jabón líquido', 'MPe', 'ASEO', 'und', '', 'Unidad', 'UND', 1, false),
  ('Aromatizante', 'MPe', 'ASEO', 'und', '', 'Unidad', 'UND', 1, false);

-- menaje, equipos y herramientas: se cuentan por unidad
insert into _alta
select n, 'MPe', 'MENAJE', 'und', '', 'Unidad', 'UND', 1, false
  from unnest(array[
    -- equipos
    'Máquina de hielo', 'Computador', 'Bitácora (cuaderno)', 'Deshidratadora', 'Cafetera', 'Exprimidor eléctrico',
    'Gramera eléctrica', 'Ventilador de piso', 'Extintor', 'Bajo de música', 'Escalera', 'Sifón verde', 'Gasificador',
    'Olla rusa',
    -- vasos, copas y recipientes
    'Vaso collins extralargo (jugo)', 'Vaso collins highball corrugado', 'Vaso collins liso', 'Vaso rockero corrugado',
    'Vaso collins zac', 'Copa shot 60 ml', 'Copa shot 30 ml', 'Vaso collins tiki', 'Vaso de cobre (moscow mule)',
    'Copa balón corrugada', 'Copa balón sweepers', 'Copa balón manantial', 'Copa margarita', 'Shot de piedra',
    'Decanter pequeño de vidrio', 'Decanter de agua', 'Bidón de agua', 'Jarra medidora ovalada',
    'Frasco de cierre hermético', 'Botella vacía de vino', 'Botella vacía de cierre hermético', 'Hielera grande',
    'Base de hielera', 'Molde de hielo',
    -- herramientas
    'Tapete escurridor', 'Pala de hielo', 'Azafate metálico grande (hielera)', 'Azafate metálico cuadrado',
    'Azafate metálico pequeño', 'Topinera de especias', 'Organizador de bar', 'Organizador de herramientas',
    'Sacacorchos', 'Bar spoon', 'Colador oruga', 'Colador de malla fina', 'Colador chino grande',
    'Colador doble propósito', 'Majador', 'Tijeras de bar', 'Picahielo', 'Pinza de precisión', 'Pinza punta de pato',
    'Pelador', 'Tabla de picar verde', 'Michelador', 'Embudo', 'Cuchara larga platinada', 'Microplane',
    'Exprimidor manual', 'Cuchara de helado', 'Cucharón', 'Shaker', 'Shaker de práctica', 'Mix in glass',
    'Destapador doble propósito', 'Destapador manual', 'Destapador eléctrico', 'Juego de pinceles',
    'Parisienne (sacabolas)', 'Cuchara para esferificados', 'Miserable (espátula)', 'Jigger doble cara',
    'Moldeador de hielo de bronce', 'Torneador de hielo', 'Plato de piedra para ahumar', 'Miligramera',
    'Acetato rígido para deshidratadora', 'Herramientas de deshidratadora', 'Cartuchera verde', 'Fajinador blanco',
    'Espolvoreador', 'Bandeja mediana de servicio', 'Portavasos Mítica', 'Glorificador de cerveza Mítica',
    'Florero de flores artificiales',
    -- aseo (equipos)
    'Escoba', 'Escoba gruesa (cepillo de piso)', 'Recogedor', 'Trapero', 'Balde de basura blanco'
  ]) as n;

do $$
declare
  r     record;
  v_gen public.genericos%rowtype;
begin
  for r in select * from _alta loop
    select * into v_gen from public.genericos g where g.area = 'BAR' and g.nombre_norm = privado.normalizar(r.nombre);
    if v_gen.id is null then
      insert into public.genericos (codigo, nombre, tipo, categoria, area, unidad_base, estado, nota)
      values (privado.codigo_generico('BAR', r.tipo), r.nombre, r.tipo, r.categoria, 'BAR', r.ub, 'PROVISIONAL',
              'Alta desde la sectorización de la barra (2026-11-04): falta validar.')
      returning * into v_gen;
    end if;
    if not exists (select 1 from public.productos p where p.generico_id = v_gen.id) then
      insert into public.productos (codigo, generico_id, marca, presentacion, unidad_compra, contenido_base,
                                    contenido_variable, estado, nota)
      values (v_gen.codigo || '-P01', v_gen.id, r.marca, r.presentacion, r.ucompra,
              case when r.variable then null else r.contenido end, r.variable, 'PROVISIONAL',
              'Alta desde la sectorización de la barra (2026-11-04): falta validar.');
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- zonas de menaje
insert into public.ubicaciones (codigo, nombre, area) values
  ('BAR_CGSU', 'Congelador · área superior', 'BAR'),
  ('BAR_NOSI', 'Nevera octagonales · superior izquierda (vasos)', 'BAR'),
  ('BAR_NESU', 'Nevera ensamble · zona superior (herramientas)', 'BAR'),
  ('BAR_STSU', 'Steward · zona superior', 'BAR'),
  ('BAR_STSC', 'Steward · entrepaño superior central (herramientas al cierre)', 'BAR'),
  ('BAR_STBI', 'Steward · bodega inferior izquierda', 'BAR'),
  ('BAR_STBD', 'Steward · bodega inferior derecha', 'BAR'),
  ('BAR_CORI', 'Corredor de ingreso al bar', 'BAR'),
  ('BAR_CORB', 'Corredor bajo', 'BAR'),
  ('BAR_ETI',  'Exhibición trasera · izquierda', 'BAR'),
  ('BAR_ETC',  'Exhibición trasera · central (copas)', 'BAR'),
  ('BAR_ETD',  'Exhibición trasera · derecha (bodega de menaje extra)', 'BAR')
on conflict (codigo) do update set nombre = excluded.nombre, activo = true;

-- ---------------------------------------------------------------- qué va en cada zona (por genérico)
create temp table _zg (ubicacion text, nombre text, orden integer) on commit drop;

insert into _zg (ubicacion, nombre, orden)
select z.ubicacion, n.nombre, z.base + n.i::integer
  from (values
    ('BAR_CGSU', 0, array['Tapete escurridor', 'Pala de hielo', 'Máquina de hielo', 'Computador', 'Bitácora (cuaderno)']),
    ('BAR_CG1S', 100, array['Hielo perfect cubo', 'Hielo perfect bola', 'Azafate metálico cuadrado', 'Azafate metálico pequeño', 'Molde de hielo']),
    ('BAR_CG1I', 100, array['Shot de piedra']),
    ('BAR_NOSI', 0, array['Vaso collins extralargo (jugo)', 'Vaso collins highball corrugado', 'Vaso collins liso',
                          'Vaso rockero corrugado', 'Vaso collins zac', 'Copa shot 60 ml', 'Copa shot 30 ml']),
    ('BAR_NOSC', 100, array['Disaronno Velvet']),
    ('BAR_NESU', 0, array['Azafate metálico grande (hielera)', 'Topinera de especias', 'Organizador de bar', 'Sacacorchos',
                          'Bar spoon', 'Colador oruga', 'Colador de malla fina', 'Majador', 'Tijeras de bar', 'Picahielo',
                          'Pinza de precisión', 'Pelador', 'Tabla de picar verde', 'Michelador']),
    ('BAR_NE1I', 100, array['Licor De Naranja Con Jengibre', 'Ginger Sweepers 1.5 (finalizador sangría)']),
    ('BAR_NE2S', 100, array['Láminas de limón', 'Láminas de naranja']),
    ('BAR_NE3I', 100, array['Decanter de agua', 'Bidón de agua']),
    ('BAR_NE4',  100, array['Decanter de agua']),
    ('BAR_STSU', 0, array['Deshidratadora', 'Tapete escurridor']),
    ('BAR_STSI', 100, array['Salsa Worcestershire', 'Tajín', 'Palillos de decoración', 'Extracto de malta', 'Miligramera',
                            'Rótulos', 'Té Bitaco vainilla', 'Escarcha diamantina violeta', 'Escarcha diamantina azul agua marina',
                            'Escarcha diamantina azul rey', 'Escarcha diamantina tornasol blanca', 'Escarcha murano tornasol azul',
                            'Escarcha murano tornasol verde', 'Matizante perlado amarillo', 'Matizante perlado azul rey',
                            'Matizante perlado verde esmeralda', 'Matizante perlado naranja', 'Matizante perlado violeta',
                            'Matizante perlado azul cielo', 'Colorante comestible frambuesa', 'Colorante comestible lila',
                            'Colorante comestible azul', 'Colorante comestible color piel', 'Colorante comestible rojo']),
    ('BAR_STSC', 0, array['Michelador', 'Embudo', 'Cuchara larga platinada', 'Microplane', 'Pinza punta de pato',
                          'Exprimidor manual', 'Cuchara de helado', 'Cucharón', 'Organizador de herramientas',
                          'Gramera eléctrica', 'Shaker de práctica', 'Bar spoon', 'Colador de malla fina',
                          'Colador doble propósito', 'Pinza de precisión', 'Destapador doble propósito', 'Picahielo',
                          'Pelador', 'Majador', 'Tijeras de bar', 'Juego de pinceles', 'Colador oruga', 'Sacacorchos',
                          'Parisienne (sacabolas)', 'Cuchara para esferificados', 'Miserable (espátula)', 'Jigger doble cara',
                          'Topinera de especias', 'Moldeador de hielo de bronce', 'Tabla de picar verde']),
    ('BAR_STSD', 100, array['Espolvoreador']),
    ('BAR_STII', 100, array['Isomalta granular']),
    ('BAR_STIC', 100, array['Isomalta granular', 'Vaso desechable frío/caliente', 'Vaso desechable 16 oz', 'Pitillos',
                            'Tapas verdes', 'Bolsas de basura', 'Sifón verde', 'Gasificador', 'Waypal', 'Gas butano',
                            'Rollo de papel craft', 'Bolsa ziploc 20 x 35', 'Bolsa ziploc 10 x 22',
                            'Herramientas de deshidratadora', 'Cartuchera verde', 'Fajinador blanco', 'Licor neutro 80°',
                            'Cafetera']),
    ('BAR_STBI', 0, array['Colador chino grande', 'Colador de malla fina', 'Acetato rígido para deshidratadora',
                          'Exprimidor eléctrico', 'Jarra medidora ovalada', 'Azafate metálico pequeño',
                          'Azafate metálico cuadrado', 'Frasco de cierre hermético']),
    ('BAR_STBD', 0, array['Botella vacía de vino', 'Botella vacía de cierre hermético', 'Jabón en polvo', 'Olla rusa',
                          'Jabón líquido', 'Aromatizante', 'Tapete escurridor', 'Deshidratadora']),
    ('BAR_CORI', 0, array['Escoba', 'Recogedor', 'Escoba gruesa (cepillo de piso)', 'Trapero', 'Escalera',
                          'Ventilador de piso', 'Extintor', 'Balde de basura blanco']),
    ('BAR_CORB', 0, array['Base de hielera', 'Hielera grande', 'Bajo de música']),
    ('BAR_MES',  100, array['Florero de flores artificiales', 'Glorificador de cerveza Mítica', 'Destapador manual',
                            'Destapador eléctrico', 'Frasco de cierre hermético', 'Shaker', 'Mix in glass',
                            'Torneador de hielo', 'Bar spoon', 'Colador oruga', 'Colador de malla fina',
                            'Pinza de precisión', 'Plato de piedra para ahumar', 'Vaso de cobre (moscow mule)',
                            'Portavasos Mítica', 'Bandeja mediana de servicio']),
    ('BAR_ETI',  0, array['Vaso collins tiki', 'Vaso de cobre (moscow mule)', 'Shaker', 'Mix in glass',
                          'Decanter pequeño de vidrio']),
    ('BAR_ETC',  0, array['Copa balón corrugada', 'Copa balón sweepers', 'Copa balón manantial', 'Copa margarita'])
  ) as z (ubicacion, base, nombres)
  cross join lateral unnest(z.nombres) with ordinality as n (nombre, i);

-- la bodega de menaje extra puede recibir cualquier pieza de menaje
insert into _zg (ubicacion, nombre, orden)
select 'BAR_ETD', g.nombre, (row_number() over (order by g.nombre))::integer
  from public.genericos g where g.area = 'BAR' and g.categoria = 'MENAJE' and g.activo;

do $$
declare v text;
begin
  select string_agg(distinct z.nombre, ', ') into v
    from _zg z left join public.genericos g on g.area = 'BAR' and g.nombre_norm = privado.normalizar(z.nombre)
   where g.id is null;
  if v is not null then raise exception 'Genéricos que no están en el catálogo del bar: %', v; end if;
end $$;

insert into public.ubicacion_productos (ubicacion, producto_id, orden)
select z.ubicacion, p.id, min(z.orden)
  from _zg z
  join public.genericos g on g.area = 'BAR' and g.nombre_norm = privado.normalizar(z.nombre)
  join public.productos p on p.generico_id = g.id and p.activo
 group by z.ubicacion, p.id
on conflict (ubicacion, producto_id) do update set orden = excluded.orden, activo = true;
