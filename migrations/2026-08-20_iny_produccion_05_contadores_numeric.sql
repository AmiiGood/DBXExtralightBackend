-- ============================================================================
-- PRODUCCIÓN INYECCIÓN — Contadores a numeric
--
-- Los contadores de la máquina deberían ser enteros, pero el histórico trae 2
-- filas con valor fraccionario (Final = 10.5 y 4.5, ambas en KS09). Son 2 de
-- 336,567, casi seguro errores de captura, pero se conservan tal cual para que
-- la migración sea fiel al Excel y se puedan corregir después con evidencia.
--
-- Al cambiar el tipo hay que reconstruir las columnas generadas que dependen de
-- ellos (ciclos, produccion_teorica) y la vista que las usa.
--
-- Correr DESPUÉS de 2026-08-20_iny_produccion_01_schema.sql. Idempotente.
-- ============================================================================

BEGIN;

-- La vista depende de ciclos: se recrea al final.
DROP VIEW IF EXISTS public.v_iny_produccion;

-- No se puede cambiar el tipo de una columna de la que depende una generada.
ALTER TABLE public.iny_produccion DROP COLUMN IF EXISTS ciclos;
ALTER TABLE public.iny_produccion DROP COLUMN IF EXISTS produccion_teorica;

ALTER TABLE public.iny_produccion
  ALTER COLUMN contador_inicial TYPE numeric(10,2),
  ALTER COLUMN contador_final   TYPE numeric(10,2);

ALTER TABLE public.iny_produccion
  ADD COLUMN IF NOT EXISTS ciclos numeric(10,2)
    GENERATED ALWAYS AS (contador_final - contador_inicial) STORED;

ALTER TABLE public.iny_produccion
  ADD COLUMN IF NOT EXISTS produccion_teorica numeric(12,2)
    GENERATED ALWAYS AS ((contador_final - contador_inicial) * cavidades) STORED;

CREATE OR REPLACE VIEW public.v_iny_produccion AS
SELECT
  p.id,
  p.tipo,
  p.fecha,
  EXTRACT(YEAR  FROM p.fecha)::int  AS anio,
  EXTRACT(MONTH FROM p.fecha)::int  AS mes_num,
  TO_CHAR(p.fecha, 'TMMonth')       AS mes,
  EXTRACT(WEEK  FROM p.fecha)::int  AS semana,
  t.nombre                          AS turno,
  m.codigo                          AS maquina,
  e.codigo                          AS estacion,
  pr.sku,
  pr.descripcion,
  COALESCE(mo.nombre, mop.nombre)   AS modelo,
  COALESCE(p.bu_reporte, pr.bu_reporte, mo.bu_reporte, mop.bu_reporte) AS bu,
  p.cavidades,
  p.ciclos,
  p.produccion,
  p.scrap
FROM public.iny_produccion p
LEFT JOIN public.turnos          t   ON t.id  = p.turno_id
LEFT JOIN public.iny_maquinas    m   ON m.id  = p.maquina_id
LEFT JOIN public.iny_estaciones  e   ON e.id  = p.estacion_id
LEFT JOIN public.iny_productos   pr  ON pr.id = p.producto_id
LEFT JOIN public.modelos         mo  ON mo.id = p.modelo_id
LEFT JOIN public.modelos         mop ON mop.id = pr.modelo_id;

COMMIT;
