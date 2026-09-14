-- ============================================================================
-- CARGA MASIVA DE ARTÍCULOS — Product Family y correcciones de catálogo
--
-- Fuente: "Catálogos y artículos/Relación de Familias.xlsx" (2026-09-11),
-- verificada contra sus 255 renglones y contra los dos archivos ejemplo.
--
-- Product Family sigue DOS reglas distintas, por eso vive en dos lugares:
--
--   PF   una familia por ESTILO, sin talla      -> cat_estilos.familia
--        ASSEM-1-CLSC / ASSEM-1-CROC
--
--   SEM  una base por MODELO + la talla          -> cat_unfin.familia_base
--        Unfin: {base}_{talla}         A1CLASSIC_M2W4     cat_strap.familia_base
--        Strap: {base}_{talla_strap}   A1CLASSIC_S_M2
--        (la base del strap ya incluye el "_S")
--
-- Decisiones de Alexis (2026-09-11):
--   * Todas las Baya son ASSEM-1-CROC. La relación traía Baya adulto (10126) y
--     Baya Clog T (207012) como CLSC por error.
--   * "A1BayaKids" se respeta con sus mayúsculas tal como viene del sistema.
--   * Unfin M16/M17 usan sufijo 795/799, no 116/117. Lo confirman la relación
--     y los datos de Inyección; con 116/117 los códigos de esas tallas salían mal.
--   * 12132 Classic Realtree está descontinuado.
--   * El Unfin Classic Realtree APX no tiene familia (ni código) todavía; queda
--     NULL y el módulo lo avisa.
--
-- Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.cat_estilos ADD COLUMN IF NOT EXISTS familia      varchar(40);
ALTER TABLE public.cat_unfin   ADD COLUMN IF NOT EXISTS familia_base varchar(40);
ALTER TABLE public.cat_strap   ADD COLUMN IF NOT EXISTS familia_base varchar(40);

COMMENT ON COLUMN public.cat_estilos.familia IS
  'Product Family de las filas PF (sin talla). Ej. ASSEM-1-CLSC.';
COMMENT ON COLUMN public.cat_unfin.familia_base IS
  'Base de Product Family del Unfin; la fila usa {base}_{talla}. Ej. A1CLASSIC.';
COMMENT ON COLUMN public.cat_strap.familia_base IS
  'Base de Product Family del Strap, ya con _S; la fila usa {base}_{talla_strap}. Ej. A1CLASSIC_S.';

-- PF
UPDATE public.cat_estilos SET familia = 'ASSEM-1-CLSC'
 WHERE codigo IN ('10001', '206867', '206990', '206991', '210099');
UPDATE public.cat_estilos SET familia = 'ASSEM-1-CROC'
 WHERE codigo IN ('10126', '207012', '207013', '207657', '209728');

-- Unfin
UPDATE public.cat_unfin SET familia_base = 'A1CLASSIC'  WHERE codigo IN ('43019', '43020', '43021');
UPDATE public.cat_unfin SET familia_base = 'A1KCLASSIC' WHERE codigo = '43032';
UPDATE public.cat_unfin SET familia_base = 'A1BAYA'     WHERE codigo = '43033';
UPDATE public.cat_unfin SET familia_base = 'A1BayaKids' WHERE codigo IN ('43022', '43034');

-- Strap
UPDATE public.cat_strap SET familia_base = 'A1CLASSIC_S'  WHERE codigo IN ('40003', '40004');
UPDATE public.cat_strap SET familia_base = 'A1KCLASSIC_S' WHERE codigo = '41121';

-- Sufijos de Unfin M16/M17
UPDATE public.cat_tallas_equivalencias SET sufijo_unfin = '795' WHERE talla = 'M16';
UPDATE public.cat_tallas_equivalencias SET sufijo_unfin = '799' WHERE talla = 'M17';

-- Estilo descontinuado
UPDATE public.cat_estilos SET obsoleto = true WHERE codigo = '12132';

COMMIT;
