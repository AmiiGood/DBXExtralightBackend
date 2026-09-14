-- ============================================================================
-- COMPOUND — Catálogo de causas de tiempo muerto
--
-- CC, TMM y PLAN están CONFIRMADAS: aparecen descritas en la columna
-- OBSERVACIONES del Excel de producción.
--
--   CC    "1 hrs arranque inicio de turno, 3 cambios de color"
--   TMM   "10 hrs línea 2 por revisión de mantenimiento", "8 hrs por mantenimiento"
--   PLAN  "3 cambios de color, 5 hrs por programación"
--
-- Las otras cuatro son una lectura de las observaciones, NO validadas por
-- planta. Van con confirmada = false; el reporte las muestra con un asterisco.
-- Cuando planta conteste, corregir así (no toca ningún dato):
--
--   UPDATE comp_causas_paro SET nombre = '...', confirmada = true WHERE codigo = 'AM';
--
-- Idempotente.
-- ============================================================================

BEGIN;

INSERT INTO public.comp_causas_paro (codigo, nombre, descripcion, planeado, confirmada, orden)
VALUES
  ('CC',   'Cambio de color',
   'Confirmada: las observaciones cuentan los cambios de color por turno.',
   false, true,  1),

  ('PLAN', 'Paro programado',
   'Confirmada: las observaciones lo llaman "por programación".',
   true,  true,  2),

  ('TMM',  'Mantenimiento',
   'Confirmada: las observaciones hablan de revisión o paro por mantenimiento.',
   true,  true,  3),

  ('AM',   'Arranque de máquina',
   'SIN CONFIRMAR. Se infiere de "1 hrs arranque inicio de turno".',
   false, false, 4),

  ('FT',   'Falta de trabajo',
   'SIN CONFIRMAR. Falta que planta diga qué significa la sigla.',
   false, false, 5),

  ('FP',   'Falta de personal',
   'SIN CONFIRMAR. Se infiere de "falta de personal" en las observaciones.',
   false, false, 6),

  ('LH',   'Limpieza',
   'SIN CONFIRMAR. Solo 11 h en todo el histórico, la causa más rara.',
   false, false, 7)
ON CONFLICT (codigo) DO NOTHING;

COMMIT;
