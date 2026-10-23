# Migración del histórico de bar

Generado por `scripts/migracion/extraer.mjs` · corte de costos **2026-10-22** · fuente: los tres libros de `referencia/`.

## Qué entra

| Qué | Cantidad |
|---|---|
| Genéricos | 344 (MPe 203, MPI 82, sin costo 9, cócteles 50) |
| Genéricos nuevos (estaban en inventario o compras, no en el catálogo de costos) | 82 |
| Productos (genérico + marca + presentación) | 305 |
| — con presentación por confirmar | 3 |
| Taras | 72 (29 sin peso de botella vacía) |
| Alias de nombres | 607 |
| Conversiones con valor | 7 |
| Fichas | 49 de MPI + 50 de cócteles, 433 líneas |
| Proveedores | 8 |
| Costos de referencia | 60 productos |

**Qué no entra:** las compras y los lotes históricos no entran al kardex. Solo dejan su costo de referencia, que valoriza el saldo inicial del primer conteo. Herramientas, utensilios y cristalería tampoco entran, porque son activos y no consumibles.

## Por confirmar antes de migrar (no se migró)

Nada.

## Nombres de compra sin producto

- «Uva verde»: Una sola línea, sin precio ni unidad, y no está en el catálogo de costos.

## Alias en conflicto (dos genéricos con el mismo nombre)

Nada.

## Avisos

- «Aperitivo Campari»: La compra dice «Botx700ml»; inventario, taras y factores dicen 750 ml.
- «Jagermaister»: La compra dice «Botx750»; inventario, taras y factores dicen 700 ml.
- BAR_MPe_0039-GR: 1 compra(s) descartada(s) por precio contradictorio.
- Ficha #44 línea 2 («Vino Blanco»): BAR_MPe_0068 → BAR_MPe_0112 por decisión de mapeo.

## Compras repetidas (no entran al costo de referencia)

- BAR-20261001-001-001 repite BAR-20261001-002-001 (Ginger Canad Dry x300, 2026-10-01, 24 BOT, $43704)
- BAR-20261001-001-002 repite BAR-20261001-002-002 (Tónica Canadá Dry CERO x300, 2026-10-01, 24 BOT, $46128)
- BAR-20261001-001-003 repite BAR-20261001-002-003 (Soda Bretaña x300, 2026-10-01, 24 BOT, $54888)
- BAR-20261001-001-004 repite BAR-20261001-002-004 (Agua Hatsu x300, 2026-10-01, 24 BOT, $49992)
- BAR-20260905-002-002 repite BAR-20260905-001-002 (Vino Tarapacá, reserva Merlot bot 750 ml, 2026-09-05, 3 UND, $226500)
- BAR-20260905-002-003 repite BAR-20260905-001-003 (Aguardiente origen atardecer sin azúcar, 2026-09-05, 2 UND, $101980)
- BAR-20260905-002-005 repite BAR-20260905-001-005 (Whisky glenfiddich 12 años, 2026-09-05, 2 UND, $455000)

## Unidades de compra sin factor

- BAR_MPe_0035-GR: UND
- BAR_MPe_0042-CJA: CJA
- BAR_MPe_0054-GR: UND
- BAR_MPe_0034-GR: UND
- BAR_MPe_0050-GR: UND
- BAR_MPe_0037-GR: UND

## Compras excluidas del costo de referencia

- **Unidad de compra sin factor a unidad base**: 8
- **Línea de prueba del motor (05/10/2026).**: 1
- **Línea REVERSADA**: 20
- **Servicio de transporte: no es insumo.**: 3
- **Sin cantidad, valor o fecha**: 1
- **Desechable de servicio: no es insumo del kardex.**: 1
- **Hallazgo que invalida el precio (H09)**: 2
- **Hallazgo que invalida el precio (H12)**: 1
- **Hallazgo que invalida el precio (H02, H03)**: 2
- **Producto sin mapear**: 1
- **Hallazgo que invalida el precio (H04)**: 2

## Fichas con neto en ml sin densidad (neto_esperado queda vacío)

- #5 Sirope Simple: 4275 ml
- #12 Sirope Stella Du Solei: 2397 ml
- #13 Sirope Stella Di Mango: 2520 ml
- #14 Sirope Stella Di Rosso: 3064 ml
- #16 Sirope Pinefizz: 2556 ml
- #19 Sirope De Chamoy: 2064 ml
- #38 Licor De Flor De Jamaica: 1500 ml
- #41 Licor De Limoncillo: 1500 ml
- #6 Sirope De Jengibre: 1695 ml
- #7 Sirope De Vainilla: 1200 ml
- #8 Sirope De Cardamomo: 1350 ml
- #9 Sirope Naranja Amarga: 1120 ml
- #10 Sirope de Romero: 1400 ml
- #15 Sirope De Tamarindo: 1300 ml
- #17 Sirope Scarlet Kiss: 1416 ml
- #18 Sirope Tabaco-Naranja: 1666 ml
- #29 Licor De Vainilla: 1450 ml
- #31 Sirope De Manzanilla: 1500 ml
- #32 Licor De Manzanilla: 1500 ml
- #35 Licor De Menta Fresca: 1500 ml
- #37 Sirope De Flor De Jamaica: 1500 ml
- #40 Sirope De Limoncillo: 1500 ml

## Líneas de ficha o receta sin cantidad

- Ficha #11 (Mix De Citricos): Limon Lima En Rodajas
- Ficha #11 (Mix De Citricos): Limon Tahiti En Rodajas
- Ficha #11 (Mix De Citricos): Azucar Blanca
- Ficha #11 (Mix De Citricos): Azucar Glass
- Ficha #23 (Picadillo y Sirope Fairy Blood): Triple Bled Fruit (pricemart)
- Ficha #23 (Picadillo y Sirope Fairy Blood): Azucar
- Ficha #42 (Laminas De Jengibre): Reaprovechamiento Ficha #6
- Ficha #46 (Garnitura de Limón): Rodajas de limon del mix de citricos
- Ficha #47 (Garnitura de fideos de naranja): Cascaras de naranja
- Ficha #47 (Garnitura de fideos de naranja): Sirope simple
- Ficha #47 (Garnitura de fideos de naranja): Azucar
- Cóctel C39 Sour Café Almendrado: Espuma de café (Ficha sin cantidad («para coronar»): pesar una porción)

## Medidas pendientes (PESAJE)

- Cuánto trae 1 CJA de Uchuva (g por caja: confirmar. Ojo: la compra del 06/08 tiene 500 «CJA» que parecen gramos)
- Cuánto trae 1 CJA de Menta francesa (unidades por caja: confirmar (x25 o x50))
- Cuánto trae 1 UND de Vinagre balsámico (ml por botella (recepción de cocina))
- Cuánto trae 1 UND de Crema de leche (g por unidad (recepción de cocina))
- Sirope Simple: ml→g (desbloquea 15 línea(s) de ficha)
- Miel de abejas: ml→g (desbloquea 6 línea(s) de ficha)
- Ácido cítrico: cda→g (desbloquea 4 línea(s) de ficha)
- Canela cassia: und→g (desbloquea 4 línea(s) de ficha)
- Manzana verde: und→g (desbloquea 3 línea(s) de ficha)
- Manzana gala: und→g (desbloquea 2 línea(s) de ficha)
- Zumo de Limón (Súper limón): ml→g (desbloquea 2 línea(s) de ficha)
- Sirope de azúcar morena: ml→g (desbloquea 2 línea(s) de ficha)
- Piña oro miel: und→g (desbloquea 2 línea(s) de ficha)
- Pera: und→g (desbloquea 1 línea(s) de ficha)
- Zumo De Naranja Importada: ml→g (desbloquea 1 línea(s) de ficha)
- Romero: und→g (desbloquea 1 línea(s) de ficha)
- Pulpa de maracuyá: ml→g (desbloquea 1 línea(s) de ficha)
- Maracuyá: und→g (desbloquea 1 línea(s) de ficha)
- Granadilla: und→g (desbloquea 1 línea(s) de ficha)
- Limón Tahití: und→g (desbloquea 1 línea(s) de ficha)
- Clavos de olor: und→g (desbloquea 1 línea(s) de ficha)
- Leche Evaporada: ml→g (desbloquea 1 línea(s) de ficha)
- Leche condensada: ml→g (desbloquea 1 línea(s) de ficha)
- Melón: und→g (desbloquea 1 línea(s) de ficha)
- Kiwi: und→g (desbloquea 1 línea(s) de ficha)
- Lulo: und→g (desbloquea 1 línea(s) de ficha)
- Colorante comestible verde: gota→ml (desbloquea 1 línea(s) de ficha)
- Ácido cítrico: ml→g (desbloquea 1 línea(s) de ficha)
- Coco: und→g (desbloquea 0 línea(s) de ficha)
- Zumo De Naranja: ml→g (desbloquea 0 línea(s) de ficha)
- Mix De Citricos: ml→g (desbloquea 0 línea(s) de ficha)
- Zumo de Mandarina: ml→g (desbloquea 0 línea(s) de ficha)
- Licor De Flor De Jamaica: ml→g (desbloquea 0 línea(s) de ficha)
- Licor De Manzanilla: ml→g (desbloquea 0 línea(s) de ficha)
- Zumo Manzana-Pera: ml→g (desbloquea 0 línea(s) de ficha)
- Licor De Limoncillo: ml→g (desbloquea 0 línea(s) de ficha)
- Licor De Menta Fresca: ml→g (desbloquea 0 línea(s) de ficha)
- Arándano fresco: und→g (desbloquea 0 línea(s) de ficha)
- Lychee en almíbar (lata): ml→g (desbloquea 0 línea(s) de ficha)
- Ginger ale: bot→ml (desbloquea 0 línea(s) de ficha)
- Picadillo De Sangria Tradicional: cda→g (desbloquea 0 línea(s) de ficha)
- Licor De Vainilla: ml→g (desbloquea 0 línea(s) de ficha)
- Sirope Morfeo Pee: ml→g (desbloquea 0 línea(s) de ficha)
- Horchata Di Égida: ml→g (desbloquea 0 línea(s) de ficha)
- Picadillo y Sirope Fairy Blood: ml→g (desbloquea 0 línea(s) de ficha)
- Sirope Green Velvet: ml→g (desbloquea 0 línea(s) de ficha)
- Sirope De Chamoy: ml→g (desbloquea 0 línea(s) de ficha)
- Sirope De Tamarindo: ml→g (desbloquea 0 línea(s) de ficha)
- Sirope de Romero: ml→g (desbloquea 0 línea(s) de ficha)
- Sirope Naranja Amarga: ml→g (desbloquea 0 línea(s) de ficha)
- Aceituna verde deshuesada: und→g (desbloquea 0 línea(s) de ficha)
- Sirope De Jengibre: ml→g (desbloquea 0 línea(s) de ficha)
- Limón Tahití: casco→g (desbloquea 0 línea(s) de ficha)
- Sirope Stella Du Solei: ml→g (desbloquea 0 línea(s) de ficha)
- Sirope Stella Di Mango: ml→g (desbloquea 0 línea(s) de ficha)
- Sirope Stella Di Rosso: ml→g (desbloquea 0 línea(s) de ficha)
- Lychee en almíbar (lata): und→g (desbloquea 0 línea(s) de ficha)
- Picadillo Morfeo Pee: cda→g (desbloquea 0 línea(s) de ficha)
- Picadillo y Sirope Fairy Blood: cda→g (desbloquea 0 línea(s) de ficha)
- Picadillo Green Velvet: cda→g (desbloquea 0 línea(s) de ficha)
- Sirope De Cardamomo: ml→g (desbloquea 0 línea(s) de ficha)
- Licor de Granadilla: ml→g (desbloquea 0 línea(s) de ficha)
- Té de flor de clitoria: ml→g (desbloquea 0 línea(s) de ficha)
- Sirope Pinefizz: ml→g (desbloquea 0 línea(s) de ficha)
- Sirope Scarlet Kiss: ml→g (desbloquea 0 línea(s) de ficha)
- Helado de macadamia: bola→g (desbloquea 0 línea(s) de ficha)
- Sirope Tabaco-Naranja: ml→g (desbloquea 0 línea(s) de ficha)

## Taras sin producto en el inventario

- Trapiche Medalla — Malbec 750 ml
- Disaronno Amaretto Velbet 700 ml

## Taras sin peso de botella vacía

- José Cuervo Especial 375 ml
- Olmeca Reposado 700 ml
- Monkey Shoulder 1000 ml
- Cachaça 51 965 ml
- Cachaça Jamel 1000 ml
- Coloma — Licor de café 700 ml
- Ancho Reyes — Licor de chile 750 ml
- Cointreau — Licor de naranja 700 ml
- Convier — Licor de durazno 750 ml
- Absenta — Licor de hierbas 700 ml
- Convier — Licor de maracuyá 750 ml
- Aguardiente Origen Atardecer 750 ml
- Dubonnet — Vino Fortificado 750 ml
- Monkey Shoulder 700 ml
- Cacique 500 750 ml
- Flor de Caña 750 ml
- Aguardiente Amarillo 750 ml
- Aguardiente Amarillo 375 ml
- Aguardiente Cumbre Premium 750 ml
- Diablo Dark — Blend 750 ml
- Finca de las Moras — Malbec 375 ml
- Marqués de Riscal Reserva — Tempranillo 750 ml
- Marqués de Riscal Gran Reserva — Tempranillo 750 ml
- Morandé Pionero — Cabernet Sauvignon 750 ml
- Tarapacá Reserva — Merlot 750 ml
- Cono Sur Bicicleta — Pinot Noir 750 ml
- Mar de Frades — Albariño 750 ml
- Tarapacá Reserva — Chardonnay 750 ml
- Tarapacá Sauvignon Blanc 750 ml

## Productos con presentación por confirmar

- BAR_MPe_0080-PC · Licor neutro 35°
- BAR_MPe_0130-PC · Angostura bitters
- BAR_MPe_0131-PC · Orange bitters
