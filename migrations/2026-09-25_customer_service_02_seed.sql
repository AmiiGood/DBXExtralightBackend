-- ============================================================================
-- CUSTOMER SERVICE — Archivos que se vigilan
--
-- Se siembran los dos con la ruta y el nombre de hoy. A partir de aquí se
-- editan desde la pantalla: en enero solo cambia el año del nombre.
--
-- La ruta va en UNC y no como 'F:', que es como está mapeada en las máquinas
-- del área. La letra solo existe dentro de la sesión de Windows de quien la
-- montó; el proceso del backend no la ve.
--
-- Idempotente, y NO pisa lo que ya esté configurado: si alguien ya cambió el
-- nombre del archivo desde la pantalla, volver a correr esto no se lo deshace.
-- ============================================================================

BEGIN;

INSERT INTO public.cs_archivos (clave, nombre, carpeta, archivo, activo) VALUES
  ('KPI',
   'KPI Customer Service',
   '\\172.16.101.124\AREAS\Customer Service\Metricos Clientes',
   'KPI Customer Service 2026.xlsx',
   true),
  ('MUESTRAS',
   'Muestras',
   '\\172.16.101.124\AREAS\Customer Service\Metricos Clientes',
   'Muestras 2026.xlsx',
   true)
ON CONFLICT (clave) DO NOTHING;

COMMIT;
