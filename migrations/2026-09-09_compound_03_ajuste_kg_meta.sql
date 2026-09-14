-- ============================================================================
-- COMPOUND — Corrección: "Kg PERDIDOS" no son pérdidas
--
-- Al reconstruir las fórmulas del Excel contra las 1,926 filas quedó claro que
-- la columna `Kg PERDIDOS` es, literalmente:
--
--     Kg PERDIDOS = PRODUCCIÓN(Kg) − META DIARIA(Turno)
--
-- El signo está al revés de lo que dice el nombre. Ejemplos del propio archivo:
--
--     2025-01-03 L1  prod 2,520  meta 2,678  ->  "perdidos" = −157
--     2025-07-31 L2  prod     0  meta −3,780 ->  "perdidos" = 3,780
--
--     suma de la columna:      +223,972 kg
--     suma de (meta − prod):   −223,972 kg   (exactamente lo opuesto)
--
-- Es decir: POSITIVO = se produjo POR ENCIMA de la meta. En todo el histórico
-- Compound quedó 223,972 kg ARRIBA de la meta acumulada, un 5.76% a favor.
--
-- El .pbix grafica esta columna bajo la etiqueta "%SCRAP". Eso es incorrecto y
-- se corrige aquí: en estos datos NO existe ninguna columna de scrap ni de
-- merma de material. Llamarle scrap a un excedente invierte la lectura.
--
-- Por eso la columna se renombra a `kg_vs_meta` y se quita la restricción de
-- no-negativo: el signo es la información.
--
-- Además:
--   * `meta_turno_kg` se conserva como viene capturada. Se verificó que
--     %CUMPLIMIENTO = produccion / meta_turno_kg cuadra en 1,324 de 1,324
--     casos, así que es el número con el que el área mide y no se toca.
--   * OJO: meta_turno_kg = meta_kg_hora × (turno − TIEMPO MUERTO de la columna
--     del Excel), que difiere en 46.5 h (1.3%) de la suma de las siete causas
--     que guarda `tiempo_muerto`. Se dejan los dos a propósito: el análisis de
--     paro necesita el desglose, el %cumplimiento necesita el número del área.
--   * 106 renglones traen meta en cero y ahí `kg_vs_meta` queda igual a la
--     producción; el reporte los excluye de los porcentajes.
--
-- Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.comp_produccion
  DROP CONSTRAINT IF EXISTS comp_produccion_kg_check;

ALTER TABLE public.comp_produccion
  RENAME COLUMN kg_perdidos TO kg_vs_meta;

ALTER TABLE public.comp_produccion
  ALTER COLUMN kg_vs_meta DROP NOT NULL,
  ALTER COLUMN kg_vs_meta DROP DEFAULT;

-- Solo la producción tiene que ser no-negativa; kg_vs_meta lleva signo
ALTER TABLE public.comp_produccion
  ADD CONSTRAINT comp_produccion_kg_check CHECK (produccion_kg >= 0);

COMMENT ON COLUMN public.comp_produccion.kg_vs_meta IS
  'produccion_kg - meta_turno_kg. POSITIVO = por encima de la meta. En el Excel se llama "Kg PERDIDOS" pero el signo está invertido respecto al nombre.';

COMMIT;
