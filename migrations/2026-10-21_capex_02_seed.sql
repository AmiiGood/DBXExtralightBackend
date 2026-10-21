-- ============================================================================
-- CAPEX — El libro que se vigila
--
-- En las máquinas del área la carpeta está en F:\Manufacturing\..., y F: es
-- \\172.16.101.124\AREAS: el mismo recurso de donde ya lee Customer Service.
--
-- Idempotente, y NO pisa lo que ya esté configurado desde la pantalla.
-- ============================================================================

BEGIN;

INSERT INTO public.capex_archivo (clave, nombre, carpeta, patron, hoja, bloque, activo) VALUES
  ('CAPEX',
   'Plan CAPEX (estratto MEX)',
   '\\172.16.101.124\AREAS\Manufacturing\CAPEX 2025-2026\CAPEX 26-30',
   'estratto MEX_piano FNJ PS 2025-2028 Rev',
   'Capex update 2025-2026',
   'CAPEX 2026',
   true)
ON CONFLICT (clave) DO NOTHING;

COMMIT;
