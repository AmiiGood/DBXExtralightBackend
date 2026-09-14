-- ============================================================================
-- uuid: uuid_generate_v4() -> gen_random_uuid() en el RESTO del sistema
--
-- Mismo cambio que 2026-08-20_iny_produccion_06_uuid_rapido.sql, pero sobre las
-- tablas de los otros módulos. Va en archivo aparte porque toca módulos que no
-- son el de inyección — córrelo cuando quieras, no es requisito para nada.
--
-- En este servidor uuid_generate_v4() tarda 5.7 ms por llamada. Eso significa
-- que hoy CADA alta paga esos 5.7 ms:
--   registros_defectos   captura de scrap
--   qr_escaneos          escaneo de QR
--   usuarios            alta de usuario
--
-- Con un registro a la vez ni se siente, pero en el escaneo de QR (que va en
-- ráfaga) sí: son 176 inserciones por segundo como techo, contra 86,957.
--
-- Las dos funciones dan un UUID v4 aleatorio: el cambio es solo de rendimiento
-- y no toca ninguna fila existente.
--
-- Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.registros_defectos ALTER COLUMN uuid SET DEFAULT gen_random_uuid();
ALTER TABLE public.qr_escaneos        ALTER COLUMN uuid SET DEFAULT gen_random_uuid();
ALTER TABLE public.usuarios           ALTER COLUMN uuid SET DEFAULT gen_random_uuid();

COMMIT;
