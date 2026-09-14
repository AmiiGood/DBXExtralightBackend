-- ============================================================================
-- COMPOUND — El módulo se llama "Compuestos" en pantalla
--
-- Alexis pidió el nombre en español. Solo cambia el NOMBRE del módulo, que es
-- lo que se muestra; la `ruta` sigue siendo /compound/reportes porque es la
-- llave con la que roles_modulos concede permisos, y renombrarla obligaría a
-- reasignar los permisos de todos los roles sin ganar nada.
--
-- Por lo mismo se quedan en inglés los identificadores internos: las tablas
-- comp_*, los archivos compound*.js y el prefijo de la API.
--
-- Idempotente.
-- ============================================================================

BEGIN;

UPDATE public.modulos
   SET nombre = 'Reportes de Compuestos'
 WHERE nombre = 'Reportes de Compound';

COMMIT;
