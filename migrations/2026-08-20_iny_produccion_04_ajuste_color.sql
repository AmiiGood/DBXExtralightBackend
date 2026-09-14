-- ============================================================================
-- PRODUCCIÓN INYECCIÓN — Ajuste de tamaño de iny_productos.color_codigo
--
-- En Crocs el color es un código corto ('001', '0DA', '6ZW'), pero en Suela,
-- Almohada y Dual Color la misma columna del Excel trae la descripción del
-- material. El valor más largo del histórico mide 41 caracteres:
--   'CHARCOAL 301-1.80 + COMPACTO CHARCOAL 301'
--
-- Correr DESPUÉS de 2026-08-20_iny_produccion_01_schema.sql.
-- Idempotente (ampliar un varchar es reentrante y no reescribe la tabla).
-- ============================================================================

BEGIN;

ALTER TABLE public.iny_productos
  ALTER COLUMN color_codigo TYPE varchar(60);

COMMIT;
