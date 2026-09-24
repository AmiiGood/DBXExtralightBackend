-- ============================================================================
-- STAFF — Catálogo de métricas
--
-- Una fila por renglón del Excel que se va a graficar. Los códigos son los que
-- devuelve src/utils/staffExcelParser.js; si aquí falta uno, la carga lo
-- rechaza por la llave foránea en vez de guardarlo en silencio.
--
-- `serie` es lo que une el dato con su meta ('inv_crocs' e 'inv_crocs_meta'
-- comparten CROCS), y `orden` es el orden de dibujo dentro del bloque.
--
-- Dos cosas que el Excel deja implícitas y aquí quedan escritas:
--
--   La almohada se cuenta en PIEZAS y todo lo demás en PARES. En la hoja se ve
--   en el nombre de la meta: 'Goal Crocs Prs' y 'Goal Suole Prs' contra 'Goal
--   Pillow Pcs'. Una almohada no es un par, y sumarlas con el resto no
--   significa nada.
--
--   Dual Color se factura pero NO tiene meta: la fila 'Open PO´s Dual Color
--   Goal' del Excel está en ceros desde que existe, y en facturación ni
--   siquiera hay renglón de meta. Se deja sin meta en vez de inventarle una.
--
-- Idempotente. Correr DESPUÉS de 01_schema.
-- ============================================================================

BEGIN;

INSERT INTO public.staff_metricas (codigo, nombre, bloque, serie, es_meta, unidad, orden) VALUES
  -- Facturación (hoja 'Compras', bloque '3.  INVOICE')
  ('inv_crocs',             'Crocs',                   'INVOICE',   'CROCS',          false, 'PARES',      1),
  ('inv_crocs_meta',        'Meta Crocs',              'INVOICE',   'CROCS',          true,  'PARES',      2),
  ('inv_foam_canada',       'Foam Canada',             'INVOICE',   'FOAM_CANADA',    false, 'PARES',      3),
  ('inv_foam_canada_meta',  'Meta Foam Canada',        'INVOICE',   'FOAM_CANADA',    true,  'PARES',      4),
  ('inv_sole',              'Sole',                    'INVOICE',   'SOLE',           false, 'PARES',      5),
  ('inv_sole_meta',         'Meta Sole',               'INVOICE',   'SOLE',           true,  'PARES',      6),
  ('inv_dual_color',        'Dual Color',              'INVOICE',   'DUAL_COLOR',     false, 'PARES',      7),

  -- Inyección (hoja 'Data Tracking', bloque '4.-INJECTION'). Promedio diario.
  ('inj_crocs',             'Inyección Crocs',         'INYECCION', 'CROCS',          false, 'PARES',      1),
  ('inj_crocs_meta',        'Meta Crocs',              'INYECCION', 'CROCS',          true,  'PARES',      2),
  ('inj_suela',             'Inyección Suela',         'INYECCION', 'SUELA',          false, 'PARES',      3),
  ('inj_suela_meta',        'Meta Suela',              'INYECCION', 'SUELA',          true,  'PARES',      4),
  ('inj_almohada',          'Inyección Almohada',      'INYECCION', 'ALMOHADA',       false, 'PIEZAS',     5),
  ('inj_almohada_meta',     'Meta Almohada',           'INYECCION', 'ALMOHADA',       true,  'PIEZAS',     6),

  -- Ensamble (hoja 'Data Tracking', bloque '5.- ASSY'). Promedio diario.
  ('assy_crocs',            'Ensamble Crocs',          'ENSAMBLE',  'CROCS',          false, 'PARES',      1),
  ('assy_crocs_meta',       'Meta Crocs',              'ENSAMBLE',  'CROCS',          true,  'PARES',      2),
  ('assy_suela',            'Ensamble Suela',          'ENSAMBLE',  'SUELA',          false, 'PARES',      3),
  ('assy_suela_meta',       'Meta Suela',              'ENSAMBLE',  'SUELA',          true,  'PARES',      4),
  ('assy_almohada',         'Ensamble Almohada',       'ENSAMBLE',  'ALMOHADA',       false, 'PIEZAS',     5),
  ('assy_almohada_meta',    'Meta Almohada',           'ENSAMBLE',  'ALMOHADA',       true,  'PIEZAS',     6),

  -- Rotación semanal (hoja 'Data Tracking', bloque '8.- ROTACION SEMANAL').
  -- Los porcentajes se guardan como fracción, tal cual vienen (0.0414 = 4.14%).
  ('rot_plantilla',         'Plantilla',               'ROTACION',  'PLANTILLA',      false, 'PERSONAS',   1),
  ('rot_plantilla_meta',    'Meta de plantilla',       'ROTACION',  'PLANTILLA',      true,  'PERSONAS',   2),
  ('rot_bajas',             'Bajas',                   'ROTACION',  'BAJAS',          false, 'PERSONAS',   3),
  ('rot_pct_bajas',         '% de bajas',              'ROTACION',  'PCT_BAJAS',      false, 'PORCENTAJE', 4),
  ('rot_pct_ausentismo',    '% de ausentismo',         'ROTACION',  'PCT_AUSENTISMO', false, 'PORCENTAJE', 5),
  ('rot_pct_antiguedad',    '% con 2 semanas de antigüedad', 'ROTACION', 'PCT_ANTIGUEDAD', false, 'PORCENTAJE', 6),
  ('rot_variantes',         'Variantes de ausentismo', 'ROTACION',  'VARIANTES',      false, 'PORCENTAJE', 7),
  ('rot_variantes_meta',    'Meta de variantes',       'ROTACION',  'VARIANTES',      true,  'PORCENTAJE', 8),
  ('rot_administracion',    'Administración',          'ROTACION',  'ADMINISTRACION', false, 'PERSONAS',   9),
  ('rot_budget',            'Budget',                  'ROTACION',  'BUDGET',         false, 'PERSONAS',  10),
  ('rot_total_foam',        'Total Foam',              'ROTACION',  'TOTAL_FOAM',     false, 'PERSONAS',  11)
ON CONFLICT (codigo) DO UPDATE SET
  nombre  = EXCLUDED.nombre,
  bloque  = EXCLUDED.bloque,
  serie   = EXCLUDED.serie,
  es_meta = EXCLUDED.es_meta,
  unidad  = EXCLUDED.unidad,
  orden   = EXCLUDED.orden;

COMMIT;
