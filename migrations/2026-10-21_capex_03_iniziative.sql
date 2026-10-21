-- ============================================================================
-- CAPEX — Hoja 'nuove iniziative'
--
-- El plan de inversión por iniciativa y su curva de gasto 2026–2030. Sale del
-- mismo libro que el resto del reporte, así que se lee en la misma vuelta.
--
-- Sus códigos (26-MEX-01 … 26-MEX-10) NO son los mismos proyectos que los de
-- 'Capex update': son otra numeración con el mismo formato. No se cruzan.
--
-- Los montos del libro vienen en miles de euros y aquí se guardan en euros.
--
-- Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.capex_archivo
  ADD COLUMN IF NOT EXISTS hoja_iniziative varchar(100) NOT NULL DEFAULT 'nuove iniziative';

CREATE TABLE IF NOT EXISTS public.capex_iniziative (
  id              bigserial     PRIMARY KEY,
  fila            integer       NOT NULL,
  codigo          varchar(40),
  descripcion     text,
  owner           varchar(120),
  planta          varchar(60),
  -- 'SI' / 'NO' de "Studi previsti"
  estudios        varchar(10),
  -- { "2026": 800000, "2027": 1500000, ... } en euros
  anios           jsonb         NOT NULL DEFAULT '{}'::jsonb,
  total           numeric(14,2) NOT NULL DEFAULT 0,
  archivo_origen  varchar(200)  NOT NULL,
  carga_id        uuid,
  creado_en       timestamp     NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.capex_iniziative IS
  'Hoja nuove iniziative: curva de gasto por iniciativa y año, en euros. Sus códigos no son los de capex_proyectos.';

COMMIT;
