-- ============================================================================
-- AIMS — El libro que se vigila
--
-- Sin carpeta y apagado: el área va a dejar el libro en una carpeta de
-- \\172.16.101.124\AREAS pero todavía no decide cuál. Se pega la ruta en la
-- pantalla "Archivo de AIMS" y se prende ahí mismo.
--
-- El nombre trae la revisión y la fecha ('KPIs AIMS rev8 Oct 21.xlsx'); se
-- toma el de la rev más alta que empiece con el patrón.
--
-- Idempotente, y NO pisa lo que ya esté configurado desde la pantalla.
-- ============================================================================

BEGIN;

INSERT INTO public.aims_archivo (clave, nombre, carpeta, patron, activo) VALUES
  ('AIMS', 'Indicadores AIMS', '', 'KPIs AIMS rev', false)
ON CONFLICT (clave) DO NOTHING;

COMMIT;
