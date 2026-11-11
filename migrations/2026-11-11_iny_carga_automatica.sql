-- ============================================================================
-- INYECCIÓN — cargas automáticas (sin usuario)
--
-- Archivos de SharePoint carga el libro de Inyección solo, desde SharePoint o
-- desde una carpeta sincronizada con OneDrive. Esa carga no la hace nadie, así
-- que no hay usuario que poner en "cargado_por" ni en "registrado_por", y las
-- dos columnas eran obligatorias: la primera carga automática real falló con
-- 'el valor nulo en la columna «cargado_por» ... viola la restricción de no
-- nulo' (2026-11-11). Compound ya las tenía opcionales.
--
-- Vacío = carga automática. La carga manual y la captura siguen guardando a
-- la persona como siempre.
--
-- Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.iny_cargas     ALTER COLUMN cargado_por    DROP NOT NULL;
ALTER TABLE public.iny_produccion ALTER COLUMN registrado_por DROP NOT NULL;

COMMIT;
