# Rescate de precios de cocina

Generado por `scripts/migracion/rescatar_precios.mjs` · 2026-11-04 · fuente: `REG_REC_COC_003` (BD_RECEPCIONES) enlazado con el catálogo actual de la base.

| Qué | Líneas |
|---|---|
| Líneas activas leídas | 461 |
| Sin cantidad, valor o fecha (no se puede recuperar) | 196 |
| Ya estaban cargadas | 54 |
| **Rescatadas** | **185** (165 cuentan para el costo, 20 quedan como no computables) |
| Nombre sin enlace al catálogo | 4 nombre(s) |
| Unidad que no se pudo pasar a la del genérico | 19 |

Genéricos de cocina que ganan precio: **99**.


## Nombres de factura sin enlace (de mayor a menor valor comprado) — crear o enlazar en el catálogo

- «Queso mozzarella Camoti» · $139.900
- «Queso mozzarella» · $85.995
- «Huevo» · $70.379
- «salsa de pescado squid» · $18.530

## Unidad distinta — falta una conversión del genérico

- Brotes mix Hortifrescos → Brotes mix Hortifrescos: la factura viene en und y el genérico va en g (1 línea(s))
- New York steak → New York steak: la factura viene en und y el genérico va en g (2 línea(s))
- Panceta barril → Panceta barril: la factura viene en und y el genérico va en g (1 línea(s))
- Res riñón → Res riñón: la factura viene en und y el genérico va en g (1 línea(s))
- Coco → Coco: la factura viene en und y el genérico va en g (1 línea(s))
- Alcohol 3800 ml → Alcohol: la factura viene en und y el genérico va en ml (1 línea(s))
- Jabón antibacterial neutro → Jabón antibacterial neutro: la factura viene en und y el genérico va en ml (1 línea(s))
- Salsa de ostras Panda → Salsa de ostras Panda: la factura viene en und y el genérico va en g (1 línea(s))
- Aceite de sésamo Kaduya → Aceite de sésamo Kaduya: la factura viene en und y el genérico va en ml (1 línea(s))
- Leche de coco Kari → Leche de Coco: la factura viene en und y el genérico va en ml (1 línea(s))
- Tomates secos Karisma → Tomates secos Karisma: la factura viene en und y el genérico va en g (1 línea(s))
- Vinagre vino blanco Colavita → Vinagre vino blanco: la factura viene en und y el genérico va en ml (2 línea(s))
- Germinados mixtos → Germinados mixtos: la factura viene en und y el genérico va en g (1 línea(s))
- Pera fruiticola → Pera fruiticola: la factura viene en und y el genérico va en g (1 línea(s))
- Frambuesa nacional → Frambuesa nacional: la factura viene en und y el genérico va en g (1 línea(s))
- Leche de coco → Leche de Coco: la factura viene en g y el genérico va en ml (1 línea(s))
- Vinagre balsamico → Vinagre Balsámico: la factura viene en und y el genérico va en ml (1 línea(s))

## Pasadas a la unidad base con el contenido de su única presentación — revisar

- Coliflor (2026-10-01): 3 und → 540 g ($29.63 por g) → Coliflor
- Pechuga (2026-10-01): 4157 und → 4157 g ($18.47 por g) → Pechuga De Pato
- Pulpo baby (2026-10-01): 2000 und → 2000 g ($44.6 por g) → Pulpo Baby
- Camarón vannamei 51/60 (2026-10-01): 4000 und → 4000 g ($26.62 por g) → Camarón vannamei 51/60
- Langostino u 10 (2026-10-01): 1500 und → 1500 g ($58.4 por g) → Langostinos U10
- Conejo (2026-10-01): 5060 und → 5060 g ($53.42 por g) → Conejo
- Tocineta (2026-10-01): 5000 und → 5000 g ($31.57 por g) → Tocineta
- Lomo de res (2026-10-01): 5778 und → 5778 g ($61.92 por g) → Res (lomo fino)
- Lomo de cerdo (2026-10-01): 1500 und → 1500 g ($52.46 por g) → Lomo de Cerdo
- Carne molida (2026-10-01): 8360 und → 8360 g ($26.9 por g) → Carne molida
- Queso cheddar (2026-10-01): 2270 und → 2270 g ($31.94 por g) → Queso Cheddar (tajado)
- Coliflor (2026-09-25): 6 und → 1080 g ($23.15 por g) → Coliflor
- Aceite de freir (2026-09-23): 114 und → 431490 ml ($1.95 por ml) → Aceite de freir
- Café (2026-09-15): 2500 und → 2500 g ($63.96 por g) → Café
- Vinagre vino blanco Colavita (2026-09-11): 500 und → 500 ml ($29.75 por ml) → Vinagre vino blanco
- Vinagre de vino tinto Colavita (2026-09-11): 500 und → 500 ml ($29.75 por ml) → Vinagre de vino tinto
- Coliflor (2026-09-11): 1661 und → 1661 g ($10.42 por g) → Coliflor
- Mix de queso crystal farm (2026-09-11): 1814 und → 1814 g ($47.3 por g) → Mix de quesos
- Mix de queso crystal farm (2026-09-11): 2721 und → 2721 g ($47.3 por g) → Mix de quesos
- Queso parmesano cuña member selection (2026-09-11): 1812 und → 1812 g ($65.85 por g) → Queso parmesano cuña
- Vinagre de vino tinto Colavita (2026-08-05): 2 und → 1000 ml ($31.5 por ml) → Vinagre de vino tinto
- Brotes mix Hortifrescos (2026-08-05): 1 und → 30 g ($230 por g) → Brotes mix Hortifrescos
- Coliflor (2026-07-28): 4 und → 720 g ($41.67 por g) → Coliflor

## Rescatadas pero no computables — revisar en la hoja de verificación

- 2026-10-01 · «Cajas de germinados» → Cajas de germinados: $15.000 por 1 g · Costo por g fuera de rango ($15000): revisar unidad o contenido
- 2026-10-01 · «Manzana Gala» → Manzana Gala: $15.000 por 6 g · Costo por g fuera de rango ($2500): revisar unidad o contenido
- 2026-10-01 · «Carne molida» → Carne molida: $224.884 por 8360 g · Precio contradictorio con las demás compras del genérico (mediana $3.68 por g)
- 2026-09-26 · «Panal de huevos» → Panal de huevos: $13.990 por 30 und · Dos compras con precios que no cuadran entre sí (más de 3 veces): revisar cuál es la buena
- 2026-09-25 · «Germinado» → Cajas de germinados: $15.000 por 31250 g · Costo por g fuera de rango ($0.48): revisar unidad o contenido
- 2026-09-15 · «Naranja» → Naranja: $16.000 por 4000 g · Dos compras con precios que no cuadran entre sí (más de 3 veces): revisar cuál es la buena
- 2026-09-15 · «Naranja» → Naranja: $29.500 por 2200 g · Dos compras con precios que no cuadran entre sí (más de 3 veces): revisar cuál es la buena
- 2026-09-15 · «Queso parmesano Belgioioso» → Queso parmesano: $269.700 por 4080 g · Dos compras con precios que no cuadran entre sí (más de 3 veces): revisar cuál es la buena
- 2026-08-29 · «Panal de huevos» → Panal de huevos: $46.000 por 2 und · Revisión del Sheet: Unidad base ambigua en el histórico — validar con chef
- 2026-08-27 · «Tocineta premium» → Tocineta premium: $733.577 por 10510 g · Dos compras con precios que no cuadran entre sí (más de 3 veces): revisar cuál es la buena
- 2026-08-27 · «Leche Alquería» → Leche: $42.850 por 6 ml · Revisión del Sheet: Unidad base ambigua en el histórico — validar con chef
- 2026-08-22 · «Tomate chonto» → Tomate Chonto (rojo): $24.000 por 4097 g · Revisión del Sheet: Unidad vs precio incoherente en v1.0 — validar presentación real
- 2026-08-22 · «Panal de huevos» → Panal de huevos: $32.700 por 3 und · Revisión del Sheet: Unidad base ambigua en el histórico — validar con chef
- 2026-08-15 · «Leche Alquería» → Leche: $29.700 por 6600 ml · Revisión del Sheet: Unidad base ambigua en el histórico — validar con chef
- 2026-08-05 · «Aceite de ajonjolí» → Aceite de ajonjolí: $35.200 por 207 ml · Revisión del Sheet: Unidad base ambigua en el histórico — validar con chef
- 2026-08-01 · «Panal de huevos» → Panal de huevos: $25.980 por 2 und · Dos compras con precios que no cuadran entre sí (más de 3 veces): revisar cuál es la buena
- 2026-08-01 · «Queso parmesano rallado Belgioioso» → Queso parmesano: $19.700 por 1000 g · Dos compras con precios que no cuadran entre sí (más de 3 veces): revisar cuál es la buena
- 2026-07-28 · «Tocineta premium» → Tocineta premium: $91.214 por 4165 g · Dos compras con precios que no cuadran entre sí (más de 3 veces): revisar cuál es la buena
- 2026-07-28 · «Coliflor» → Coliflor: $30.000 por 720 g · Revisión del Sheet: Unidad base ambigua en el histórico — validar con chef
- 2026-07-22 · «Aceite de ajonjolí» → Aceite de ajonjolí: $156.100 por 1656 ml · Revisión del Sheet: Unidad base ambigua en el histórico — validar con chef
