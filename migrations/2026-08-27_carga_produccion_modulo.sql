-- ============================================================================
-- CARGA DE PRODUCCIÓN — Módulo de subida del Excel
--
-- Se decidió que por ahora la información siga entrando por el archivo de
-- Excel y se cargue desde el sistema, en vez de capturarse en el formulario.
--
-- Por eso se registra el módulo de carga y se DESACTIVA el de captura. No se
-- borra nada: el formulario y sus tablas siguen ahí, y para volver a
-- habilitarlo basta con poner activo = true.
--
-- Idempotente.
-- ============================================================================

BEGIN;

INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo)
SELECT 'Carga de Producción',
       'Subida del Excel de Producción Inyección',
       'Upload',
       '/produccion/carga-produccion',
       true
WHERE NOT EXISTS (
  SELECT 1 FROM public.modulos WHERE nombre = 'Carga de Producción'
);

-- El formulario de captura se oculta del menú, no se elimina
UPDATE public.modulos
   SET activo = false
 WHERE nombre = 'Producción Inyección';

COMMIT;
