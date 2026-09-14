-- ============================================================================
-- COMPUESTOS — La carga del Excel pasa a ser un módulo aparte
--
-- Antes la pantalla de carga colgaba del permiso de crear del propio reporte.
-- Se separa igual que "Carga de Producción" de Inyección para poder dar
-- permisos por separado: quien consulta el reporte no tiene por qué poder
-- reemplazar los datos, y quien sube el Excel no necesariamente ve el reporte.
--
-- La ruta /compound/carga es la llave con la que roles_modulos concede los
-- permisos y la que verifica el backend en /api/compound/carga/*.
--
-- Idempotente.
-- ============================================================================

BEGIN;

INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo)
SELECT 'Carga de Compuestos',
       'Subida de los Excel de producción diaria y recuperación de polvo',
       'Upload',
       '/compound/carga',
       true
WHERE NOT EXISTS (
  SELECT 1 FROM public.modulos WHERE nombre = 'Carga de Compuestos'
);

COMMIT;
