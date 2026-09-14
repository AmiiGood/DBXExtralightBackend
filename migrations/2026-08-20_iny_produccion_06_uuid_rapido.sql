-- ============================================================================
-- PRODUCCIÓN INYECCIÓN — uuid: uuid_generate_v4() -> gen_random_uuid()
--
-- Medido en este servidor:
--   uuid_generate_v4()   (extensión uuid-ossp)        176 uuid/s
--   gen_random_uuid()    (núcleo de Postgres 13+)  86,957 uuid/s   = 494x
--
-- Eso era TODO el cuello de botella de la carga histórica: 336,538 uuids a
-- 5.7 ms cada uno = 32 de los 40 minutos que tardó. El servidor mete 1.3
-- millones de filas por segundo cuando no hay que generar uuids.
--
-- Las dos funciones producen un UUID v4 aleatorio; el cambio es solo de
-- rendimiento. gen_random_uuid() viene en el núcleo desde Postgres 13 (aquí
-- corre la 18), así que no hace falta ninguna extensión.
--
-- No afecta a las filas ya cargadas: solo cambia el DEFAULT de las nuevas.
--
-- Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.iny_produccion
  ALTER COLUMN uuid SET DEFAULT gen_random_uuid();

COMMIT;
