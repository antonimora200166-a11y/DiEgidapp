-- Datos iniciales de configuración (no operativos). Valores tomados de CONFIG de
-- FMT-REC-BAR-001 v1.1 y SGI-COSTOS v1.1. Cambiar un parámetro = insertar una nueva vigencia.

insert into public.parametros (clave, valor, descripcion)
select v.clave, v.valor, v.descripcion from (values
  ('ZONA_HORARIA',            'America/Bogota', 'Zona para la fecha operativa de hoy.'),
  ('MIN_MOTIVO_OVERRIDE',     '15',  'Largo mínimo del motivo para forzar un bloqueo o anular.'),
  ('DIAS_ATRAS_MAXIMO',       '60',  'Aviso si la fecha del documento es más antigua que estos días.'),
  ('DIAS_VENCIMIENTO_AVISO',  '15',  'Aviso si el producto vence dentro de estos días.'),
  ('FACTOR_BANDA_PRECIO',     '20',  'Banda de categoría: mediana ÷/× este factor (capa 1).'),
  ('FACTOR_BANDA_HEREDADA',   '3',   'Ensanche adicional de la banda con menos de 3 datos.'),
  ('DESVIO_AVISO_PCT',        '15',  'Desvío % contra la mediana del producto que solo avisa.'),
  ('DESVIO_BLOQUEO_PCT',      '60',  'Desvío % contra la mediana del producto que bloquea.'),
  ('DESVIO_ATIPICO_X',        '3',   'Múltiplo de la mediana del producto que bloquea como atípico.'),
  ('BLOQUEA_SELLO',           'SI',  'Licor o vino sin sello marcado o roto bloquea (B8).'),
  ('BLOQUEA_BANDA',           'SI',  'Precio fuera de banda bloquea (B7).'),
  ('BLOQUEA_DIFERENCIA',      'NO',  'Diferencia pedido/recibido sin observación: NO = solo avisa.'),
  ('MAX_CANTIDAD_LINEA',      '50000', 'Una línea de producción mayor a esto pide motivo (B1).'),
  ('DESVIO_REND_AVISO_PCT',   '15',  'Aviso si el rendimiento del lote se aparta más de este % de la ficha.'),
  ('IMPOCONSUMO_PCT',         '8',   'Impuesto al consumo incluido en el precio de carta.')
) as v (clave, valor, descripcion)
where not exists (select 1 from public.parametros p where p.clave = v.clave);

insert into public.ubicaciones (codigo, nombre, area) values
  ('BAR_BODEGA', 'Bodega de bar', 'BAR'),
  ('BAR_BARRA',  'Barra', 'BAR'),
  ('COC_BODEGA', 'Bodega de cocina', 'COCINA')
on conflict do nothing;

insert into public.categorias (codigo, nombre, area, exige_sello, es_perecedero) values
  ('LICOR',       'Licores',            'BAR', true,  false),
  ('VINO',        'Vinos y espumantes', 'BAR', true,  false),
  ('CERVEZA',     'Cervezas',           'BAR', false, true),
  ('MIXER',       'Mixers y gaseosas',  'BAR', false, true),
  ('FRUVER',      'Frutas y verduras',  'BAR', false, true),
  ('HIELO',       'Hielo',              'BAR', false, false),
  ('INSUMO_SECO', 'Insumos secos',      'BAR', false, false),
  ('LACTEO',      'Lácteos',            'BAR', false, true),
  ('MPI',         'Producción propia',  'BAR', false, true),
  ('AGUA',        'Agua',               'BAR', false, false),
  ('COCTEL',      'Coctelería de carta','BAR', false, false),
  ('DESECHABLE',  'Desechables',        'BAR', false, false),
  ('OTROS',       'Otros',              'BAR', false, false)
on conflict do nothing;
