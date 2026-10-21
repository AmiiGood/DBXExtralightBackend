-- ============================================================================
-- ARCHIVOS DE SHAREPOINT — Los que se vigilan
--
-- Se siembran con el nombre que traen hoy los libros y SIN ubicación: la URL
-- de la carpeta se pega desde la pantalla. Nacen inactivos; se prenden ahí
-- mismo cuando "Probar" ya encuentra el archivo.
--
-- Compound son dos libros que van al mismo importador con distinto destino,
-- por eso son dos renglones.
--
-- Idempotente, y NO pisa lo que ya esté configurado desde la pantalla.
-- ============================================================================

BEGIN;

INSERT INTO public.sp_archivos (clave, nombre, importador, archivo) VALUES
  ('COMPOUND_PRODUCCION',
   'Compound — Producción diaria',
   'COMPOUND_PRODUCCION',
   'Producción Diaria 2025 rev01.xlsx'),
  ('COMPOUND_RECUPERACION',
   'Compound — Powder recovery',
   'COMPOUND_RECUPERACION',
   'Powder recovery.xlsx'),
  ('INYECCION',
   'Producción Inyección',
   'INYECCION',
   'Produccion Inyección.xlsx')
ON CONFLICT (clave) DO NOTHING;

COMMIT;
