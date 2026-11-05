-- =====================================================================================
-- SGI Di Égida · Precios de mercado para los insumos de bar que están en fichas y no tenían costo
-- Investigación del 05/11/2026 (Dislicores, Éxito, Carulla, Olímpica, Makro, Mercado Libre y las
-- compras de cocina), aprobada por Anthony: solo los de confianza alta y media (71).
-- Detalle y fuentes: supabase/datos/precios_mercado_bar.csv.
-- Entra como costo de referencia de cada presentación activa del genérico, SOLO si no tiene
-- costo ni movimientos en el kardex. No pisa ningún precio existente. La primera compra real lo
-- reemplaza (Precios desde fotos o el costo promedio del kardex). Idempotente.
-- =====================================================================================

with precios (codigo, costo, fuente) as (values
  ('BAR_MPe_0101', 198, 'Mercado: Dislicores · Botella 750 ml · 05/11/2026'),
  ('BAR_MPe_0099', 130.653333, 'Mercado: Dislicores · Botella 750 ml · 05/11/2026'),
  ('BAR_MPe_0102', 108, 'Mercado: Éxito · Botella 1000 ml · 05/11/2026'),
  ('BAR_MPe_0100', 228.142857, 'Mercado: Carulla · Botella 700 ml · 05/11/2026'),
  ('BAR_MPe_0108', 242.714286, 'Mercado: Éxito · Botella 700 ml · 05/11/2026'),
  ('BAR_MPe_0028', 99.986667, 'Mercado: Dislicores · Botella 750 ml · 05/11/2026'),
  ('BAR_MPe_0095', 213.2, 'Mercado: Mercado Libre · Botella 750 ml · 05/11/2026'),
  ('BAR_MPe_0096', 77.333333, 'Mercado: Dislicores · Botella 750 ml · 05/11/2026'),
  ('BAR_MPe_0097', 220, 'Mercado: Dislicores (precio regular) · Botella 700 ml · 05/11/2026'),
  ('BAR_MPe_0106', 350.4, 'Mercado: Carulla · Botella 750 ml · 05/11/2026'),
  ('BAR_MPe_0092', 81.32, 'Mercado: Dislicores · Botella 750 ml · 05/11/2026'),
  ('BAR_MPe_0105', 213.714286, 'Mercado: Éxito · Botella 700 ml (quebranta) · 05/11/2026'),
  ('BAR_MPe_0093', 492.714286, 'Mercado: Dislicores · Botella 700 ml · 05/11/2026'),
  ('BAR_MPe_0098', 115.7, 'Mercado: Dislicores · Botella 700 ml · 05/11/2026'),
  ('BAR_MPe_0086', 144.142857, 'Mercado: Carulla · Botella 700 ml · 05/11/2026'),
  ('BAR_MPe_0089', 90.4, 'Mercado: Dislicores · Botella 750 ml · 05/11/2026'),
  ('BAR_MPe_0091', 100, 'Mercado: Mercado Libre · Botella 750 ml · 05/11/2026'),
  ('BAR_MPe_0063', 76.8, 'Mercado: Carulla (oferta $70.500) · Botella 1000 ml · 05/11/2026'),
  ('BAR_MPe_0107', 230.666667, 'Mercado: Éxito · Botella 750 ml · 05/11/2026'),
  ('BAR_MPe_0110', 56.333333, 'Mercado: Éxito · Botella 750 ml · 05/11/2026'),
  ('BAR_MPe_0109', 118.653333, 'Mercado: Dislicores · Botella 750 ml (Mionetto Brut) · 05/11/2026'),
  ('BAR_MPe_0113', 28.666667, 'Mercado: Dislicores · Botella 750 ml · 05/11/2026'),
  ('BAR_MPe_0112', 28.666667, 'Mercado: Dislicores · Botella 750 ml · 05/11/2026'),
  ('BAR_MPe_0120', 10800, 'Mercado: Éxito · Lata 250 ml · 05/11/2026'),
  ('BAR_MPe_0119', 3210, 'Mercado: Éxito · Lata 310 ml · 05/11/2026'),
  ('BAR_MPe_0117', 5998, 'Mercado: Dislicores · Lata 207 ml (pack x4 $23.990) · 05/11/2026'),
  ('BAR_MPe_0122', 4270, 'Mercado: Éxito · Botella 330 ml · 05/11/2026'),
  ('BAR_MPe_0121', 4300, 'Mercado: Olímpica · Lata 269 ml (pack x4 $17.200) · 05/11/2026'),
  ('BAR_MPe_0002', 23.53, 'Precio de cocina (tus compras) · 1 g'),
  ('BAR_MPe_0004', 3.91, 'Precio de cocina (tus compras) · 1 g'),
  ('BAR_MPe_0029', 6.13, 'Precio de cocina (tus compras) · 1 g'),
  ('BAR_MPe_0034', 6, 'Precio de cocina (tus compras) · 1 g'),
  ('BAR_MPe_0057', 2.56, 'Precio de cocina (tus compras) · 1 g'),
  ('BAR_MPe_0067', 30.92, 'Precio de cocina (tus compras) · 1 ml'),
  ('BAR_MPe_0016', 18.6, 'Precio de cocina (tus compras) · 1 g'),
  ('BAR_MPe_0027', 5.7, 'Precio de cocina (tus compras) · 1 ml'),
  ('BAR_MPe_0123', 32.831858, 'Precio de cocina (tus compras) · Lata 565 g'),
  ('BAR_MPe_0023', 550, 'Precio de cocina (tus compras) · Panal x30'),
  ('BAR_MPe_0003', 33.292, 'Mercado: Carulla · Bolsa 500 g · 05/11/2026'),
  ('BAR_MPe_0018', 102.4, 'Mercado: Carulla · Bolsa 50 g · 05/11/2026'),
  ('BAR_MPe_0033', 10.22, 'Mercado: Éxito · 1 kg · 05/11/2026'),
  ('BAR_MPe_0048', 9.12, 'Mercado: Éxito · 1 kg · 05/11/2026'),
  ('BAR_MPe_0050', 12.23, 'Mercado: Éxito · 1 kg (importada) · 05/11/2026'),
  ('BAR_MPe_0125', 4.508, 'Mercado: Makro · 1 kg · 05/11/2026'),
  ('BAR_MPe_0060', 17.76, 'Mercado: Olímpica · Pulpa 500 g · 05/11/2026'),
  ('BAR_MPe_0061', 16.35, 'Mercado: Éxito · Tarrina 400 g sin capacho · 05/11/2026'),
  ('BAR_MPe_0124', 32.2, 'Mercado: Olímpica · Frasco 250 g (Al''fresco) · 05/11/2026'),
  ('BAR_MPe_0006', 7.94, 'Mercado: Éxito · Bolsa 500 g (Manuelita) · 05/11/2026'),
  ('BAR_MPe_0010', 174.624, 'Mercado: Makro · Bolsa 500 g (Aro) · 05/11/2026'),
  ('BAR_MPe_0011', 188.48, 'Mercado: Mercado Libre · Bolsa 250 g · 05/11/2026'),
  ('BAR_MPe_0013', 36.725, 'Mercado: Carulla · Bolsa 400 g (Frescampo) · 05/11/2026'),
  ('BAR_MPe_0014', 180, 'Mercado: Éxito · Sobre 9 g (El Rey) · 05/11/2026'),
  ('BAR_MPe_0015', 293.589744, 'Mercado: Mercado Libre · Frasco 78 ml (Prodia) · 05/11/2026'),
  ('BAR_MPe_0017', 22.446809, 'Mercado: Éxito · Lata 470 g · 05/11/2026'),
  ('BAR_MPe_0019', 25.16129, 'Mercado: Éxito · Frasco 155 ml (Frescampo) · 05/11/2026'),
  ('BAR_MPe_0020', 166.6, 'Mercado: Éxito · Bolsa 50 g · 05/11/2026'),
  ('BAR_MPe_0038', 85.8, 'Mercado: Mercado Libre · Flor entera 500 g · 05/11/2026'),
  ('BAR_MPe_0043', 47.9, 'Mercado: Éxito · Frasco 500 g (El Edén) · 05/11/2026'),
  ('BAR_MPe_0044', 127.952756, 'Mercado: Carulla · Frasco 330 g (≈254 ml) · 05/11/2026'),
  ('BAR_MPe_0052', 107.6, 'Mercado: Mercado Libre · Bolsa 250 g en grano · 05/11/2026'),
  ('BAR_MPe_0126', 691, 'Mercado: Mercado Libre · Bolsa 50 g · 05/11/2026'),
  ('BAR_MPe_0055', 773.333333, 'Mercado: Mercado Libre · Frasco 15 g · 05/11/2026'),
  ('BAR_MPe_0127', 39.9, 'Mercado: Olímpica · Bolsa 500 g (Natusal) · 05/11/2026'),
  ('BAR_MPe_0062', 8500, 'Mercado: Mercado Libre · Paquete x10 vainas · 05/11/2026'),
  ('BAR_MPe_0064', 71.5, 'Mercado: Éxito · Botella 500 ml (Roland) · 05/11/2026'),
  ('BAR_MPe_0065', 3.98, 'Mercado: Olímpica · Botella 500 ml (Medalla de Oro) · 05/11/2026'),
  ('BAR_MPe_0066', 8.84, 'Mercado: Éxito · Botella 500 ml (Barrentos) · 05/11/2026'),
  ('BAR_MPe_0128', 75.333333, 'Mercado: Carulla · Cubeta 600 g (Popsy) · 05/11/2026'),
  ('BAR_MPe_0026', 19.974684, 'Mercado: Olímpica · Lata 395 g (Medalla de Oro) · 05/11/2026'),
  ('BAR_MPe_0129', 4190, 'Mercado: Mercado Libre · Caja x10 (iSi 8,4 g) · 05/11/2026'),
  ('BAR_MPe_0008', 5470, 'Mercado: Mercado Libre · Caja x10 · 05/11/2026')
),
destino as (
  select p.id as producto_id, x.costo, x.fuente
    from precios x
    join public.genericos g on g.codigo = x.codigo and g.activo
    join public.productos p on p.generico_id = g.id and p.activo
   where not exists (select 1 from public.costos_referencia cr where cr.producto_id = p.id)
     and not exists (select 1 from public.movimientos m where m.producto_id = p.id)
)
insert into public.costos_referencia (producto_id, costo_unitario_base, fuente, n_compras, ultima_compra, calculado_en)
select producto_id, costo, fuente, null, null, current_date from destino
on conflict (producto_id) do nothing;

select privado.bitacora('PRECIOS DE MERCADO CARGADOS', 'costos_referencia', 'BAR',
  jsonb_build_object('insumos', 71, 'fecha_investigacion', '2026-11-05'));
