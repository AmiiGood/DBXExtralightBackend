-- ============================================================================
-- Orden del menú para los módulos del proyecto de reportes por área
--
-- Todos los módulos agregados desde agosto quedaron con orden = 0, así que
-- empataban y el menú lateral los acomodaba como saliera: "Carga de Compuestos"
-- aparecía antes que "Reportes de Compuestos". Se ponen después de los módulos
-- que ya existían (el mayor era 9), reporte primero y su carga detrás.
--
-- Se busca por ruta y no por nombre: la ruta es la llave estable (el nombre de
-- Compuestos ya cambió una vez).
--
-- Idempotente.
-- ============================================================================

BEGIN;

UPDATE public.modulos SET orden = 10 WHERE ruta = '/produccion/reportes';
UPDATE public.modulos SET orden = 11 WHERE ruta = '/produccion/carga-produccion';
UPDATE public.modulos SET orden = 12 WHERE ruta = '/compound/reportes';
UPDATE public.modulos SET orden = 13 WHERE ruta = '/compound/carga';
UPDATE public.modulos SET orden = 14 WHERE ruta = '/moldes/reportes';
UPDATE public.modulos SET orden = 15 WHERE ruta = '/admin/envio-reportes';

COMMIT;
