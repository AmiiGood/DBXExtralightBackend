-- ==========================================================================
-- PRODUCCIÓN INYECCIÓN — Seed
-- Generado desde 'Producción Inyección.xlsx' (hoja Producción, 336,567 filas,
-- del 02/01/2025 al 08/08/2026).
--
-- PROVISIONAL: máquinas y estaciones salen de lo que se ha capturado, no de un
-- catálogo oficial. Están pendientes de confirmación del gerente de planta (ver
-- 'Validación Máquinas y Estaciones - Inyección.xlsx'). Las estaciones se
-- normalizaron a 'NN-A'/'NN-B': el Excel trae '07-A', 'S7-A' y '7A' para lo mismo.
--
-- 'activo' = hubo captura en los últimos 90 días del histórico.
--
-- Correr DESPUÉS de 2026-08-20_iny_produccion_01_schema.sql. Idempotente.
-- ==========================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Máquinas
-- --------------------------------------------------------------------------
INSERT INTO public.iny_maquinas (codigo, unidad_negocio_id, orden, activo)
SELECT v.codigo, u.id, v.orden, v.activo
FROM (VALUES
  ('DCR1', 'DUAL COLOR', 10, true),   --  9,317 registros, último 2026-08-08
  ('DCR2', 'DUAL COLOR', 20, true),   --  7,775 registros, último 2026-08-08
  ('DRG2', 'SUELA', 30, true),   --  3,077 registros, último 2026-06-26
  ('EVA08', 'ALMOHADA', 40, true),   -- 10,832 registros, último 2026-08-08
  ('EVA10', 'ALMOHADA', 50, true),   --  7,755 registros, último 2026-08-08
  ('KS01', 'CROCS', 60, false),   --  1,271 registros, último 2026-02-28
  ('KS02', 'CROCS', 70, true),   -- 19,079 registros, último 2026-08-08
  ('KS03', 'CROCS', 80, true),   -- 20,983 registros, último 2026-08-08
  ('KS05', 'CROCS', 90, true),   -- 21,343 registros, último 2026-08-08
  ('KS06', 'CROCS', 100, true),   -- 19,023 registros, último 2026-08-08
  ('KS07', 'CROCS', 110, true),   -- 20,629 registros, último 2026-08-08
  ('KS09', 'CROCS', 120, true),   -- 21,344 registros, último 2026-08-08
  ('KS14', 'CROCS', 130, true),   -- 21,101 registros, último 2026-08-08
  ('KS16', 'CROCS', 140, true),   -- 20,797 registros, último 2026-08-08
  ('KS18', 'CROCS', 150, true),   -- 21,529 registros, último 2026-08-08
  ('STR1', 'SUELA', 160, true),   -- 11,818 registros, último 2026-08-08
  ('STR2', 'ALMOHADA', 170, true),   --  7,300 registros, último 2026-08-07
  ('STR3', 'SUELA', 180, true),   -- 10,402 registros, último 2026-07-24
  ('STR4', 'ALMOHADA', 190, true),   --  9,889 registros, último 2026-08-08
  ('STR5', 'ALMOHADA', 200, true),   -- 12,838 registros, último 2026-08-08
  ('STR6', 'CROCS', 210, true),   -- 18,498 registros, último 2026-07-17
  ('STR7', 'SUELA', 220, true),   -- 16,229 registros, último 2026-08-08
  ('STR8', 'CROCS', 230, true)   -- 12,539 registros, último 2026-08-08
) AS v(codigo, unidad, orden, activo)
LEFT JOIN public.unidades_negocio u ON u.nombre = v.unidad
ON CONFLICT (codigo) DO NOTHING;

-- --------------------------------------------------------------------------
-- 2. Estaciones (cavidades_default = valor más frecuente del histórico)
-- --------------------------------------------------------------------------
INSERT INTO public.iny_estaciones (maquina_id, codigo, cavidades_default, orden, activo)
SELECT m.id, v.codigo, v.cav, v.orden, v.activo
FROM (VALUES
  ('DCR1', '01-A', 1, 11, true),   --    398 registros
  ('DCR1', '01-B', 1, 12, true),   --    286 registros
  ('DCR1', '02-A', 1, 21, true),   --  1,202 registros
  ('DCR1', '02-B', 1, 22, true),   --  1,090 registros
  ('DCR1', '03-A', 1, 31, true),   --  1,107 registros
  ('DCR1', '03-B', 1, 32, true),   --  1,025 registros
  ('DCR1', '04-A', 1, 41, true),   --  1,114 registros
  ('DCR1', '04-B', 1, 42, true),   --  1,120 registros
  ('DCR1', '05-A', 1, 51, false),   --    751 registros
  ('DCR1', '05-B', 1, 52, false),   --    810 registros
  ('DCR1', '06-A', 0, 61, false),   --     69 registros
  ('DCR1', '06-B', 0, 62, false),   --     69 registros
  ('DCR2', '01-A', 1, 11, true),   --    327 registros
  ('DCR2', '01-B', 1, 12, true),   --    358 registros
  ('DCR2', '02-A', 1, 21, true),   --    954 registros
  ('DCR2', '02-B', 1, 22, true),   --    918 registros
  ('DCR2', '03-A', 1, 31, true),   --    902 registros
  ('DCR2', '03-B', 1, 32, true),   --    928 registros
  ('DCR2', '04-A', 1, 41, true),   --    872 registros
  ('DCR2', '04-B', 1, 42, true),   --    978 registros
  ('DCR2', '05-A', 1, 51, false),   --    485 registros
  ('DCR2', '05-B', 1, 52, false),   --    639 registros
  ('DCR2', '06-A', 0, 61, false),   --     69 registros
  ('DCR2', '06-B', 0, 62, false),   --     69 registros
  ('DRG2', '01-A', 1, 11, true),   --    215 registros
  ('DRG2', '01-B', 1, 12, true),   --    204 registros
  ('DRG2', '02-A', 1, 21, true),   --    220 registros
  ('DRG2', '02-B', 1, 22, true),   --    235 registros
  ('DRG2', '03-A', 1, 31, true),   --    306 registros
  ('DRG2', '03-B', 1, 32, true),   --    283 registros
  ('DRG2', '04-A', 1, 41, true),   --    249 registros
  ('DRG2', '04-B', 1, 42, true),   --    270 registros
  ('DRG2', '05-A', 1, 51, false),   --    229 registros
  ('DRG2', '05-B', 1, 52, true),   --    220 registros
  ('DRG2', '06-A', 1, 61, false),   --    213 registros
  ('DRG2', '06-B', 1, 62, false),   --    150 registros
  ('DRG2', '07-A', 1, 71, false),   --      4 registros
  ('DRG2', '07-B', 1, 72, false),   --      3 registros
  ('EVA08', '01-A', 1, 11, true),   --    996 registros
  ('EVA08', '01-B', 1, 12, true),   --    856 registros
  ('EVA08', '02-A', 1, 21, true),   --    923 registros
  ('EVA08', '02-B', 1, 22, true),   --    944 registros
  ('EVA08', '03-A', 1, 31, true),   --  1,018 registros
  ('EVA08', '03-B', 1, 32, true),   --    948 registros
  ('EVA08', '04-A', 1, 41, true),   --    947 registros
  ('EVA08', '04-B', 1, 42, true),   --    959 registros
  ('EVA08', '05-A', 1, 51, true),   --    692 registros
  ('EVA08', '05-B', 1, 52, true),   --    761 registros
  ('EVA08', '06-A', 1, 61, true),   --    824 registros
  ('EVA08', '06-B', 1, 62, true),   --    615 registros
  ('EVA08', '07-A', 1, 71, false),   --     19 registros
  ('EVA08', '07-B', 1, 72, false),   --     18 registros
  ('EVA10', '01-A', 1, 11, true),   --    676 registros
  ('EVA10', '01-B', 1, 12, true),   --    718 registros
  ('EVA10', '02-A', 1, 21, true),   --    635 registros
  ('EVA10', '02-B', 1, 22, true),   --    707 registros
  ('EVA10', '03-A', 1, 31, true),   --    461 registros
  ('EVA10', '03-B', 1, 32, true),   --    325 registros
  ('EVA10', '04-A', 1, 41, true),   --    712 registros
  ('EVA10', '04-B', 1, 42, true),   --    646 registros
  ('EVA10', '05-A', 2, 51, true),   --    589 registros
  ('EVA10', '05-B', 1, 52, true),   --    637 registros
  ('EVA10', '06-A', 1, 61, true),   --    705 registros
  ('EVA10', '06-B', 2, 62, true),   --    592 registros
  ('EVA10', '07-A', 1, 71, false),   --     46 registros
  ('EVA10', '07-B', 4, 72, false),   --     30 registros
  ('KS01', '01-A', 1, 11, false),   --     72 registros
  ('KS01', '01-B', 1, 12, false),   --     73 registros
  ('KS01', '02-A', 1, 21, false),   --     83 registros
  ('KS01', '02-B', 1, 22, false),   --     83 registros
  ('KS01', '03-A', 1, 31, false),   --     82 registros
  ('KS01', '03-B', 1, 32, false),   --     81 registros
  ('KS01', '04-A', 1, 41, false),   --     84 registros
  ('KS01', '04-B', 1, 42, false),   --     83 registros
  ('KS01', '05-A', 1, 51, false),   --     90 registros
  ('KS01', '05-B', 1, 52, false),   --     90 registros
  ('KS01', '06-A', 1, 61, false),   --     76 registros
  ('KS01', '06-B', 1, 62, false),   --     76 registros
  ('KS01', '07-A', 1, 71, false),   --     80 registros
  ('KS01', '07-B', 1, 72, false),   --     80 registros
  ('KS01', '08-A', 1, 81, false),   --     69 registros
  ('KS01', '08-B', 1, 82, false),   --     69 registros
  ('KS02', '01-A', 2, 11, true),   --  1,188 registros
  ('KS02', '01-B', 2, 12, true),   --  1,181 registros
  ('KS02', '02-A', 2, 21, true),   --  1,213 registros
  ('KS02', '02-B', 2, 22, true),   --  1,229 registros
  ('KS02', '03-A', 2, 31, true),   --  1,272 registros
  ('KS02', '03-B', 2, 32, true),   --  1,232 registros
  ('KS02', '04-A', 2, 41, true),   --  1,269 registros
  ('KS02', '04-B', 2, 42, true),   --  1,252 registros
  ('KS02', '05-A', 2, 51, true),   --  1,256 registros
  ('KS02', '05-B', 2, 52, true),   --  1,234 registros
  ('KS02', '06-A', 2, 61, true),   --  1,063 registros
  ('KS02', '06-B', 2, 62, true),   --  1,005 registros
  ('KS02', '07-A', 2, 71, true),   --  1,211 registros
  ('KS02', '07-B', 2, 72, true),   --  1,177 registros
  ('KS02', '08-A', 2, 81, true),   --  1,192 registros
  ('KS02', '08-B', 2, 82, true),   --  1,105 registros
  ('KS03', '01-A', 2, 11, true),   --  1,307 registros
  ('KS03', '01-B', 2, 12, true),   --  1,311 registros
  ('KS03', '02-A', 2, 21, true),   --  1,330 registros
  ('KS03', '02-B', 2, 22, true),   --  1,322 registros
  ('KS03', '03-A', 2, 31, true),   --  1,306 registros
  ('KS03', '03-B', 2, 32, true),   --  1,316 registros
  ('KS03', '04-A', 2, 41, true),   --  1,313 registros
  ('KS03', '04-B', 2, 42, true),   --  1,315 registros
  ('KS03', '05-A', 2, 51, true),   --  1,328 registros
  ('KS03', '05-B', 2, 52, true),   --  1,308 registros
  ('KS03', '06-A', 2, 61, true),   --  1,305 registros
  ('KS03', '06-B', 2, 62, true),   --  1,315 registros
  ('KS03', '07-A', 2, 71, true),   --  1,296 registros
  ('KS03', '07-B', 2, 72, true),   --  1,296 registros
  ('KS03', '08-A', 2, 81, true),   --  1,311 registros
  ('KS03', '08-B', 2, 82, true),   --  1,304 registros
  ('KS05', '01-A', 8, 11, true),   --  1,273 registros
  ('KS05', '01-B', 8, 12, true),   --  1,362 registros
  ('KS05', '02-A', 8, 21, true),   --  1,344 registros
  ('KS05', '02-B', 8, 22, true),   --  1,342 registros
  ('KS05', '03-A', 8, 31, true),   --  1,309 registros
  ('KS05', '03-B', 8, 32, true),   --  1,306 registros
  ('KS05', '04-A', 8, 41, true),   --  1,346 registros
  ('KS05', '04-B', 8, 42, true),   --  1,355 registros
  ('KS05', '05-A', 8, 51, true),   --  1,324 registros
  ('KS05', '05-B', 8, 52, true),   --  1,346 registros
  ('KS05', '06-A', 8, 61, true),   --  1,345 registros
  ('KS05', '06-B', 8, 62, true),   --  1,364 registros
  ('KS05', '07-A', 8, 71, true),   --  1,329 registros
  ('KS05', '07-B', 8, 72, true),   --  1,353 registros
  ('KS05', '08-A', 8, 81, true),   --  1,331 registros
  ('KS05', '08-B', 8, 82, true),   --  1,314 registros
  ('KS06', '01-A', 8, 11, true),   --  1,160 registros
  ('KS06', '01-B', 8, 12, true),   --  1,184 registros
  ('KS06', '02-A', 8, 21, true),   --  1,215 registros
  ('KS06', '02-B', 8, 22, true),   --  1,230 registros
  ('KS06', '03-A', 8, 31, true),   --  1,218 registros
  ('KS06', '03-B', 8, 32, true),   --  1,234 registros
  ('KS06', '04-A', 8, 41, true),   --  1,215 registros
  ('KS06', '04-B', 8, 42, true),   --  1,224 registros
  ('KS06', '05-A', 8, 51, true),   --  1,175 registros
  ('KS06', '05-B', 8, 52, true),   --  1,176 registros
  ('KS06', '06-A', 8, 61, true),   --  1,150 registros
  ('KS06', '06-B', 8, 62, true),   --  1,159 registros
  ('KS06', '07-A', 8, 71, true),   --  1,228 registros
  ('KS06', '07-B', 8, 72, true),   --  1,198 registros
  ('KS06', '08-A', 8, 81, true),   --  1,146 registros
  ('KS06', '08-B', 8, 82, true),   --  1,111 registros
  ('KS07', '01-A', 2, 11, true),   --  1,325 registros
  ('KS07', '01-B', 2, 12, true),   --  1,319 registros
  ('KS07', '02-A', 2, 21, true),   --  1,276 registros
  ('KS07', '02-B', 2, 22, true),   --  1,274 registros
  ('KS07', '03-A', 2, 31, true),   --  1,298 registros
  ('KS07', '03-B', 2, 32, true),   --  1,323 registros
  ('KS07', '04-A', 2, 41, true),   --  1,312 registros
  ('KS07', '04-B', 2, 42, true),   --  1,320 registros
  ('KS07', '05-A', 2, 51, true),   --  1,162 registros
  ('KS07', '05-B', 2, 52, true),   --  1,160 registros
  ('KS07', '06-A', 2, 61, true),   --  1,297 registros
  ('KS07', '06-B', 2, 62, true),   --  1,316 registros
  ('KS07', '07-A', 2, 71, true),   --  1,308 registros
  ('KS07', '07-B', 2, 72, true),   --  1,307 registros
  ('KS07', '08-A', 2, 81, true),   --  1,309 registros
  ('KS07', '08-B', 2, 82, true),   --  1,323 registros
  ('KS09', '01-A', 2, 11, true),   --  1,335 registros
  ('KS09', '01-B', 2, 12, true),   --  1,338 registros
  ('KS09', '02-A', 2, 21, true),   --  1,334 registros
  ('KS09', '02-B', 2, 22, true),   --  1,340 registros
  ('KS09', '03-A', 2, 31, true),   --  1,337 registros
  ('KS09', '03-B', 2, 32, true),   --  1,348 registros
  ('KS09', '04-A', 2, 41, true),   --  1,309 registros
  ('KS09', '04-B', 2, 42, true),   --  1,327 registros
  ('KS09', '05-A', 2, 51, true),   --  1,337 registros
  ('KS09', '05-B', 2, 52, true),   --  1,326 registros
  ('KS09', '06-A', 2, 61, true),   --  1,339 registros
  ('KS09', '06-B', 2, 62, true),   --  1,325 registros
  ('KS09', '07-A', 2, 71, true),   --  1,345 registros
  ('KS09', '07-B', 2, 72, true),   --  1,348 registros
  ('KS09', '08-A', 2, 81, true),   --  1,327 registros
  ('KS09', '08-B', 2, 82, true),   --  1,329 registros
  ('KS14', '01-A', 2, 11, true),   --  1,344 registros
  ('KS14', '01-B', 2, 12, true),   --  1,328 registros
  ('KS14', '02-A', 2, 21, true),   --  1,226 registros
  ('KS14', '02-B', 2, 22, true),   --  1,246 registros
  ('KS14', '03-A', 2, 31, true),   --  1,318 registros
  ('KS14', '03-B', 2, 32, true),   --  1,296 registros
  ('KS14', '04-A', 2, 41, true),   --  1,359 registros
  ('KS14', '04-B', 2, 42, true),   --  1,341 registros
  ('KS14', '05-A', 2, 51, true),   --  1,341 registros
  ('KS14', '05-B', 2, 52, true),   --  1,340 registros
  ('KS14', '06-A', 2, 61, true),   --  1,311 registros
  ('KS14', '06-B', 2, 62, true),   --  1,314 registros
  ('KS14', '07-A', 2, 71, true),   --  1,344 registros
  ('KS14', '07-B', 2, 72, true),   --  1,330 registros
  ('KS14', '08-A', 2, 81, true),   --  1,331 registros
  ('KS14', '08-B', 2, 82, true),   --  1,332 registros
  ('KS16', '01-A', 2, 11, true),   --  1,305 registros
  ('KS16', '01-B', 2, 12, true),   --  1,313 registros
  ('KS16', '02-A', 2, 21, true),   --  1,308 registros
  ('KS16', '02-B', 2, 22, true),   --  1,308 registros
  ('KS16', '03-A', 2, 31, true),   --  1,237 registros
  ('KS16', '03-B', 2, 32, true),   --  1,240 registros
  ('KS16', '04-A', 2, 41, true),   --  1,318 registros
  ('KS16', '04-B', 2, 42, true),   --  1,327 registros
  ('KS16', '05-A', 2, 51, true),   --  1,288 registros
  ('KS16', '05-B', 2, 52, true),   --  1,309 registros
  ('KS16', '06-A', 2, 61, true),   --  1,304 registros
  ('KS16', '06-B', 2, 62, true),   --  1,300 registros
  ('KS16', '07-A', 2, 71, true),   --  1,331 registros
  ('KS16', '07-B', 2, 72, true),   --  1,315 registros
  ('KS16', '08-A', 2, 81, true),   --  1,298 registros
  ('KS16', '08-B', 2, 82, true),   --  1,296 registros
  ('KS18', '01-A', 2, 11, true),   --  1,355 registros
  ('KS18', '01-B', 2, 12, true),   --  1,348 registros
  ('KS18', '02-A', 2, 21, true),   --  1,352 registros
  ('KS18', '02-B', 2, 22, true),   --  1,349 registros
  ('KS18', '03-A', 2, 31, true),   --  1,356 registros
  ('KS18', '03-B', 2, 32, true),   --  1,361 registros
  ('KS18', '04-A', 2, 41, true),   --  1,355 registros
  ('KS18', '04-B', 2, 42, true),   --  1,359 registros
  ('KS18', '05-A', 2, 51, true),   --  1,350 registros
  ('KS18', '05-B', 2, 52, true),   --  1,351 registros
  ('KS18', '06-A', 2, 61, true),   --  1,303 registros
  ('KS18', '06-B', 2, 62, true),   --  1,298 registros
  ('KS18', '07-A', 2, 71, true),   --  1,347 registros
  ('KS18', '07-B', 2, 72, true),   --  1,335 registros
  ('KS18', '08-A', 2, 81, true),   --  1,363 registros
  ('KS18', '08-B', 2, 82, true),   --  1,347 registros
  ('STR1', '02-A', 1, 21, true),   --    764 registros
  ('STR1', '02-B', 1, 22, true),   --    756 registros
  ('STR1', '03-A', 1, 31, true),   --    867 registros
  ('STR1', '03-B', 1, 32, true),   --    744 registros
  ('STR1', '04-A', 1, 41, true),   --    820 registros
  ('STR1', '04-B', 1, 42, true),   --    776 registros
  ('STR1', '05-A', 1, 51, true),   --    794 registros
  ('STR1', '05-B', 1, 52, true),   --    787 registros
  ('STR1', '06-A', 1, 61, true),   --    815 registros
  ('STR1', '06-B', 1, 62, true),   --    768 registros
  ('STR1', '07-A', 1, 71, true),   --    755 registros
  ('STR1', '07-B', 1, 72, true),   --    776 registros
  ('STR1', '08-A', 1, 81, true),   --    678 registros
  ('STR1', '08-B', 1, 82, true),   --    699 registros
  ('STR1', '09-A', 1, 91, true),   --    620 registros
  ('STR1', '09-B', 1, 92, true),   --    399 registros
  ('STR2', '01-A', 2, 11, true),   --      1 registros
  ('STR2', '01-B', 2, 12, true),   --      1 registros
  ('STR2', '02-A', 1, 21, true),   --    338 registros
  ('STR2', '02-B', 1, 22, true),   --    522 registros
  ('STR2', '03-A', 1, 31, true),   --    421 registros
  ('STR2', '03-B', 1, 32, true),   --    462 registros
  ('STR2', '04-A', 1, 41, true),   --    360 registros
  ('STR2', '04-B', 1, 42, true),   --    476 registros
  ('STR2', '05-A', 1, 51, true),   --    492 registros
  ('STR2', '05-B', 1, 52, true),   --    458 registros
  ('STR2', '06-A', 1, 61, true),   --    454 registros
  ('STR2', '06-B', 1, 62, true),   --    443 registros
  ('STR2', '07-A', 1, 71, true),   --    457 registros
  ('STR2', '07-B', 1, 72, true),   --    571 registros
  ('STR2', '08-A', 1, 81, true),   --    178 registros
  ('STR2', '08-B', 1, 82, true),   --    596 registros
  ('STR2', '09-A', 1, 91, true),   --    554 registros
  ('STR2', '09-B', 1, 92, true),   --    516 registros
  ('STR3', '01-A', 1, 11, true),   --    797 registros
  ('STR3', '01-B', 1, 12, true),   --    874 registros
  ('STR3', '02-A', 1, 21, true),   --    917 registros
  ('STR3', '02-B', 1, 22, true),   --    956 registros
  ('STR3', '03-A', 1, 31, true),   --    890 registros
  ('STR3', '03-B', 1, 32, true),   --    845 registros
  ('STR3', '04-A', 1, 41, true),   --    773 registros
  ('STR3', '04-B', 1, 42, true),   --    808 registros
  ('STR3', '05-A', 1, 51, true),   --    870 registros
  ('STR3', '05-B', 1, 52, true),   --    839 registros
  ('STR3', '06-A', 1, 61, true),   --    855 registros
  ('STR3', '06-B', 1, 62, true),   --    611 registros
  ('STR3', '07-A', 0, 71, false),   --    122 registros
  ('STR3', '07-B', 0, 72, false),   --    107 registros
  ('STR3', '08-A', 0, 81, false),   --     69 registros
  ('STR3', '08-B', 0, 82, false),   --     69 registros
  ('STR4', '01-A', 2, 11, false),   --     14 registros
  ('STR4', '01-B', 2, 12, false),   --     24 registros
  ('STR4', '02-A', 2, 21, true),   --    628 registros
  ('STR4', '02-B', 2, 22, true),   --    707 registros
  ('STR4', '03-A', 2, 31, true),   --    601 registros
  ('STR4', '03-B', 4, 32, true),   --    599 registros
  ('STR4', '04-A', 2, 41, true),   --    593 registros
  ('STR4', '04-B', 2, 42, true),   --    520 registros
  ('STR4', '05-A', 2, 51, true),   --    558 registros
  ('STR4', '05-B', 2, 52, true),   --    497 registros
  ('STR4', '06-A', 2, 61, true),   --    637 registros
  ('STR4', '06-B', 4, 62, true),   --    633 registros
  ('STR4', '07-A', 2, 71, true),   --    437 registros
  ('STR4', '07-B', 4, 72, true),   --    809 registros
  ('STR4', '08-A', 1, 81, true),   --    773 registros
  ('STR4', '08-B', 2, 82, true),   --    488 registros
  ('STR4', '09-A', 2, 91, true),   --    642 registros
  ('STR4', '09-B', 2, 92, true),   --    729 registros
  ('STR5', '01-A', 1, 11, true),   --    923 registros
  ('STR5', '01-B', 2, 12, true),   --    816 registros
  ('STR5', '02-A', 2, 21, true),   --    823 registros
  ('STR5', '02-B', 1, 22, true),   --    697 registros
  ('STR5', '03-A', 2, 31, true),   --    880 registros
  ('STR5', '03-B', 2, 32, true),   --    783 registros
  ('STR5', '04-A', 2, 41, true),   --    768 registros
  ('STR5', '04-B', 2, 42, true),   --    641 registros
  ('STR5', '05-A', 2, 51, true),   --    749 registros
  ('STR5', '05-B', 2, 52, true),   --    688 registros
  ('STR5', '06-A', 2, 61, true),   --    752 registros
  ('STR5', '06-B', 2, 62, true),   --    648 registros
  ('STR5', '07-A', 1, 71, true),   --    854 registros
  ('STR5', '07-B', 2, 72, true),   --  1,029 registros
  ('STR5', '08-A', 1, 81, true),   --    737 registros
  ('STR5', '08-B', 2, 82, true),   --    945 registros
  ('STR5', '09-A', 1, 91, false),   --     40 registros
  ('STR5', '09-B', 2, 92, false),   --     65 registros
  ('STR6', '01-A', 2, 11, true),   --  1,095 registros
  ('STR6', '01-B', 2, 12, true),   --  1,151 registros
  ('STR6', '02-A', 2, 21, true),   --  1,174 registros
  ('STR6', '02-B', 2, 22, true),   --  1,229 registros
  ('STR6', '03-A', 2, 31, true),   --  1,175 registros
  ('STR6', '03-B', 2, 32, true),   --  1,227 registros
  ('STR6', '04-A', 2, 41, true),   --  1,188 registros
  ('STR6', '04-B', 2, 42, true),   --  1,127 registros
  ('STR6', '05-A', 2, 51, true),   --  1,161 registros
  ('STR6', '05-B', 2, 52, true),   --  1,129 registros
  ('STR6', '06-A', 2, 61, true),   --  1,148 registros
  ('STR6', '06-B', 2, 62, true),   --  1,158 registros
  ('STR6', '07-A', 2, 71, true),   --  1,108 registros
  ('STR6', '07-B', 2, 72, true),   --  1,180 registros
  ('STR6', '08-A', 2, 81, true),   --  1,080 registros
  ('STR6', '08-B', 2, 82, true),   --  1,025 registros
  ('STR6', '09-A', 2, 91, false),   --     91 registros
  ('STR6', '09-B', 2, 92, false),   --     52 registros
  ('STR7', '01-A', 1, 11, true),   --  1,002 registros
  ('STR7', '01-B', 1, 12, true),   --    964 registros
  ('STR7', '02-A', 1, 21, true),   --  1,092 registros
  ('STR7', '02-B', 1, 22, true),   --  1,028 registros
  ('STR7', '03-A', 1, 31, true),   --    997 registros
  ('STR7', '03-B', 1, 32, true),   --    937 registros
  ('STR7', '04-A', 1, 41, true),   --  1,012 registros
  ('STR7', '04-B', 1, 42, true),   --    960 registros
  ('STR7', '05-A', 1, 51, true),   --    976 registros
  ('STR7', '05-B', 1, 52, true),   --    972 registros
  ('STR7', '06-A', 1, 61, true),   --  1,064 registros
  ('STR7', '06-B', 1, 62, true),   --  1,020 registros
  ('STR7', '07-A', 1, 71, true),   --  1,042 registros
  ('STR7', '07-B', 1, 72, true),   --    968 registros
  ('STR7', '08-A', 1, 81, true),   --  1,030 registros
  ('STR7', '08-B', 1, 82, true),   --    966 registros
  ('STR7', '09-A', 2, 91, false),   --     98 registros
  ('STR7', '09-B', 2, 92, false),   --    101 registros
  ('STR8', '01-A', 2, 11, true),   --    783 registros
  ('STR8', '01-B', 2, 12, true),   --    786 registros
  ('STR8', '02-A', 2, 21, true),   --    807 registros
  ('STR8', '02-B', 2, 22, true),   --    806 registros
  ('STR8', '03-A', 2, 31, true),   --    813 registros
  ('STR8', '03-B', 2, 32, true),   --    801 registros
  ('STR8', '04-A', 2, 41, true),   --    802 registros
  ('STR8', '04-B', 2, 42, true),   --    798 registros
  ('STR8', '05-A', 2, 51, true),   --    794 registros
  ('STR8', '05-B', 2, 52, true),   --    785 registros
  ('STR8', '06-A', 2, 61, true),   --    778 registros
  ('STR8', '06-B', 2, 62, true),   --    792 registros
  ('STR8', '07-A', 2, 71, true),   --    780 registros
  ('STR8', '07-B', 2, 72, true),   --    790 registros
  ('STR8', '08-A', 2, 81, true),   --    692 registros
  ('STR8', '08-B', 2, 82, true),   --    704 registros
  ('STR8', '09-A', 2, 91, false),   --     13 registros
  ('STR8', '09-B', 1, 92, false)   --     15 registros
) AS v(maquina, codigo, cav, orden, activo)
JOIN public.iny_maquinas m ON m.codigo = v.maquina
ON CONFLICT (maquina_id, codigo) DO NOTHING;

-- --------------------------------------------------------------------------
-- 3. Modelos que YA existen: solo se les pone la etiqueta de BU (42)
-- --------------------------------------------------------------------------
UPDATE public.modelos m SET bu_reporte = v.bu
FROM (VALUES
  ('AHS FREEFLOW', 'Almohada'),
  ('BALTIMORE', 'Suela'),
  ('BUBBLE', 'Suela'),
  ('BURNET', 'Suela'),
  ('CALIFORNIA', 'Suela'),
  ('CAMINANDO', 'Suela'),
  ('CATALEYA', 'Suela'),
  ('CEREZA', 'Suela'),
  ('CONTOUR LOUNGE', 'Almohada'),
  ('DRUMOND', 'Suela'),
  ('DYNASTY CLUB', 'Almohada'),
  ('ELBOW', 'Suela'),
  ('EPPING', 'Suela'),
  ('FERGUSON', 'Suela'),
  ('GINEBRA', 'Suela'),
  ('HENRY', 'Suela'),
  ('HURON', 'Suela'),
  ('INSOLE STAND SANDAL', 'Suela'),
  ('J200 2017', 'Almohada'),
  ('JESSICA', 'Suela'),
  ('JONES', 'Suela'),
  ('MEEKER', 'Suela'),
  ('MISE', 'Almohada'),
  ('MISSION ICON', 'Almohada'),
  ('MODERN', 'Suela'),
  ('MOWER', 'Suela'),
  ('MOWER DONNA', 'Suela'),
  ('NORWALK', 'Dual Color'),
  ('OUTSOLE STAND SANDAL', 'Suela'),
  ('PAYSON', 'Suela'),
  ('PAYSON DONNA', 'Suela'),
  ('RICHFIELD', 'Suela'),
  ('SD 880 LOWER', 'Almohada'),
  ('SD 880 UPPER', 'Almohada'),
  ('SERENA', 'Suela'),
  ('SOFTSENSE SPORT', 'Suela'),
  ('SPARKLE', 'Suela'),
  ('SPOKANE', 'Suela'),
  ('SUPERFLEX', 'Suela'),
  ('VECTOR INNER', 'Almohada'),
  ('VERMILLION', 'Suela'),
  ('VERMONT', 'Suela')
) AS v(nombre, bu)
WHERE upper(m.nombre) = v.nombre AND m.bu_reporte IS DISTINCT FROM v.bu;

COMMIT;
