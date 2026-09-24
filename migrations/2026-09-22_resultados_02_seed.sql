-- ============================================================================
-- RESULTADOS — Catálogos de unidades de negocio y métricas
--
-- Los códigos son los que devuelve src/utils/resultadosExcelParser.js. Si
-- falta uno, la carga lo rechaza por la llave foránea en vez de guardarlo en
-- silencio.
--
-- Idempotente. Correr DESPUÉS de 01_schema.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Unidades de negocio
--
-- FOOTWEAR solo existe en el estado de resultados, donde vale Suela + Dual
-- Color. No se puede deshacer, así que se queda como unidad propia y nunca
-- debe sumarse junto con SUELA y DUAL_COLOR: sería contar dos veces.
-- ---------------------------------------------------------------------------
INSERT INTO public.res_unidades_negocio (codigo, nombre, medida, orden) VALUES
  ('CROCS',       'Crocs',       'PARES',     1),
  ('FOAM_DESIGN', 'Foam Design', 'PIEZAS',    2),
  ('SUELA',       'Suela',       'PARES',     3),
  ('DUAL_COLOR',  'Dual Color',  'PARES',     4),
  ('COMPOUND',    'Compound',    'TONELADAS', 5),
  ('FOOTWEAR',    'Footwear',    'PARES',     6),
  ('PLANTA',      'Planta',      'PLANTA',    9)
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  medida = EXCLUDED.medida,
  orden  = EXCLUDED.orden;

COMMENT ON COLUMN public.res_unidades_negocio.medida IS
  'PARES / PIEZAS / TONELADAS. FOOTWEAR = Suela + Dual Color, solo en el estado de resultados.';

-- ---------------------------------------------------------------------------
-- Métricas
--
-- `signo` arma la cascada del estado de resultados: +1 arranca o aporta, -1
-- resta, y 0 es un subtotal o una cifra informativa que NO se acumula. Fuera
-- del bloque MARGEN no se usa.
--
-- El orden de la cascada NO es el orden en que la hoja lista los conceptos, y
-- eso no se ve leyéndola de arriba abajo. Comprobado contra las cifras de
-- Crocs, al céntimo:
--
--   'Variable costs' YA INCLUYE la mano de obra directa
--       6,717,171 materia prima + 786,174 servicios + 294,986 transportes
--       + 0 comisiones + 3,104,606 mano de obra directa = 10,902,938
--
--   'Contribution Margin ENI' se calcula ANTES de la mano de obra
--       16,377,298 ventas − 7,798,332 (los cuatro conceptos sin mano de obra)
--       = 8,578,966
--
--   y solo entonces se resta la mano de obra directa para llegar al margen de
--   contribución, 5,474,360.
--
-- Por eso 'Costos variables' va en signo 0: sumarlo a la cascada contaría dos
-- veces sus componentes. Y 'Otros ingresos y gastos' también va en 0, porque
-- el EBITDA de la hoja sale sin él (con él daría 2,563,830 en vez de
-- 2,471,059).
-- ---------------------------------------------------------------------------
INSERT INTO public.res_metricas (codigo, nombre, bloque, unidad, agregacion, signo, orden) VALUES
  -- Facturación. El precio por unidad sale de dividir las dos y es, de lejos,
  -- lo más interesante que el libro tiene sin graficar.
  ('fact_qty', 'Unidades facturadas', 'FACTURACION', 'UNIDADES', 'SUMA', 0, 1),
  ('fact_usd', 'Facturación USD',     'FACTURACION', 'USD',      'SUMA', 0, 2),

  -- Capacidad. La instalada es un NIVEL: se promedia, no se suma.
  ('cap_instalada',    'Capacidad instalada diaria', 'CAPACIDAD', 'UNIDADES', 'PROMEDIO', 0, 1),
  ('cap_comprometida', 'Capacidad comprometida',     'CAPACIDAD', 'UNIDADES', 'PROMEDIO', 0, 2),
  ('cap_dias_habiles', 'Días hábiles',               'CAPACIDAD', 'DIAS',     'SUMA',     0, 3),

  -- Carga: la foto de PO abierta traducida a días de trabajo.
  ('carga_po_qty',  'PO abierta',          'CARGA', 'UNIDADES', 'ULTIMO', 0, 1),
  ('carga_po_dias', 'Días de trabajo',     'CARGA', 'DIAS',     'ULTIMO', 0, 2),

  -- Personal. Plantilla y rotación son niveles.
  ('hr_empleados',        'Plantilla',              'PERSONAL', 'PERSONAS',   'PROMEDIO', 0, 1),
  ('hr_rotacion',         'Rotación',               'PERSONAL', 'PORCENTAJE', 'PROMEDIO', 0, 2),
  ('hr_horas_trabajadas', 'Horas trabajadas',       'PERSONAL', 'HORAS',      'SUMA',     0, 3),
  ('hr_horas_estandar',   'Horas estándar',         'PERSONAL', 'HORAS',      'SUMA',     0, 4),
  ('hr_horas_extra',      'Horas extra',            'PERSONAL', 'HORAS',      'SUMA',     0, 5),
  ('hr_horas_pagadas',    'Horas pagadas',          'PERSONAL', 'HORAS',      'SUMA',     0, 6),
  ('hr_qty_producida',    'Unidades producidas',    'PERSONAL', 'UNIDADES',   'SUMA',     0, 7),
  ('hr_qty_buena',        'Unidades buenas',        'PERSONAL', 'UNIDADES',   'SUMA',     0, 8),

  -- Energía. En euros, como viene en el libro.
  ('ene_kwh', 'Consumo',        'ENERGIA', 'KWH', 'SUMA', 0, 1),
  ('ene_eur', 'Importe',        'ENERGIA', 'EUR', 'SUMA', 0, 2),

  -- Compound, en toneladas. El fee de disposición va en pesos.
  ('comp_producido', 'Producido',              'COMPOUND', 'TONELADAS', 'SUMA', 0, 1),
  ('comp_polvo',     'Polvo recuperado',       'COMPOUND', 'TONELADAS', 'SUMA', 0, 2),
  ('comp_purga',     'Purga recuperada',       'COMPOUND', 'TONELADAS', 'SUMA', 0, 3),
  ('comp_scrap',     'Scrap',                  'COMPOUND', 'TONELADAS', 'SUMA', 0, 4),
  ('comp_fee_mxn',   'Costo de disposición',   'COMPOUND', 'MXN',       'SUMA', 0, 5),

  -- Scrap por unidad de negocio. Las piezas netas y el % se recalculan.
  ('scrap_producido', 'Producidas', 'SCRAP', 'UNIDADES', 'SUMA', 0, 1),
  ('scrap_rechazo',   'Rechazadas', 'SCRAP', 'UNIDADES', 'SUMA', 0, 2),

  -- Estado de resultados, en euros y anual.
  ('mg_qty_vendida',         'Unidades vendidas',        'MARGEN', 'UNIDADES', 'SUMA',  0,  1),
  ('mg_ventas',              'Ventas',                   'MARGEN', 'EUR',      'SUMA',  1,  2),
  ('mg_costo_variable',      'Costos variables',         'MARGEN', 'EUR',      'SUMA',  0,  3),
  ('mg_materia_prima',       'Materia prima',            'MARGEN', 'EUR',      'SUMA', -1,  4),
  ('mg_utilities',           'Servicios',                'MARGEN', 'EUR',      'SUMA', -1,  5),
  ('mg_transportes',         'Transportes',              'MARGEN', 'EUR',      'SUMA', -1,  6),
  ('mg_comisiones',          'Comisiones',               'MARGEN', 'EUR',      'SUMA', -1,  7),
  ('mg_margen_eni',          'Margen de contribución ENI',   'MARGEN', 'EUR',  'SUMA',  0,  8),
  ('mg_mano_obra_directa',   'Mano de obra directa',     'MARGEN', 'EUR',      'SUMA', -1,  9),
  ('mg_margen_finproject',   'Margen de contribución',   'MARGEN', 'EUR',      'SUMA',  0, 10),
  ('mg_costos_fijos',        'Costos fijos',             'MARGEN', 'EUR',      'SUMA', -1, 11),
  ('mg_mano_obra_indirecta', 'de los cuales: mano de obra indirecta', 'MARGEN', 'EUR', 'SUMA', 0, 12),
  ('mg_mantenimiento',       'de los cuales: mantenimiento',          'MARGEN', 'EUR', 'SUMA', 0, 13),
  ('mg_otros',               'Otros ingresos y gastos',  'MARGEN', 'EUR',      'SUMA',  0, 14),
  ('mg_ebitda',              'EBITDA',                   'MARGEN', 'EUR',      'SUMA',  0, 15),
  ('mg_depreciacion',        'Depreciación',             'MARGEN', 'EUR',      'SUMA', -1, 16),
  ('mg_ebit',                'EBIT',                     'MARGEN', 'EUR',      'SUMA',  0, 17)
ON CONFLICT (codigo) DO UPDATE SET
  nombre     = EXCLUDED.nombre,
  bloque     = EXCLUDED.bloque,
  unidad     = EXCLUDED.unidad,
  agregacion = EXCLUDED.agregacion,
  signo      = EXCLUDED.signo,
  orden      = EXCLUDED.orden;

COMMIT;
