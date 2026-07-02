-- Migración: la identidad de una caja de recepción es box_id + SKU + consecutivo.
--
-- Motivo: el primer campo del QR (box_id) a veces es una FECHA (ej. 02072026),
-- no un folio único de caja. En ese caso, distintos SKU pueden reutilizar el
-- mismo consecutivo el mismo día, y la restricción anterior UNIQUE(box_id,
-- consecutivo) los trataba como la misma caja (retomaba la caja equivocada y,
-- al intentar crear la nueva, habría chocado con la restricción).
--
-- Idempotente: se puede correr varias veces sin error.

BEGIN;

ALTER TABLE public.recepcion_cajas
  DROP CONSTRAINT IF EXISTS recepcion_cajas_box_id_consecutivo_key;

ALTER TABLE public.recepcion_cajas
  DROP CONSTRAINT IF EXISTS recepcion_cajas_box_id_sku_consecutivo_key;

ALTER TABLE public.recepcion_cajas
  ADD CONSTRAINT recepcion_cajas_box_id_sku_consecutivo_key
  UNIQUE (box_id, sku, consecutivo);

COMMIT;
