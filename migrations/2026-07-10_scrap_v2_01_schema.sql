-- ============================================================================
-- SCRAP V2 — Esquema
-- Nuevo flujo de captura de defectos:
--   Área  →  Unidad de Negocio  →  (Modelo | Proceso Crocs)  →  Defecto  →  Pares
--
-- Unidades: SUELA, ALMOHADA, DUAL COLOR (usan Modelo) y CROCS (usa Proceso:
-- ENSAMBLE / DIGITAL_PRINTING). El grupo de defecto depende de esa elección:
--   SUELA/ALMOHADA/DUAL COLOR → GENERAL
--   CROCS + ENSAMBLE          → ENSAMBLE
--   CROCS + DIGITAL_PRINTING  → DIGITAL_PRINTING
--
-- Idempotente. Correr ANTES del archivo de seed (02_seed).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Catálogo: Unidades de negocio
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.unidades_negocio (
  id        serial PRIMARY KEY,
  nombre    varchar(50) NOT NULL UNIQUE,
  activo    boolean DEFAULT true,
  creado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 2. Catálogo: Grupos de defecto (GENERAL / ENSAMBLE / DIGITAL_PRINTING)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grupos_defecto (
  id          serial PRIMARY KEY,
  nombre      varchar(50) NOT NULL UNIQUE,
  descripcion text
);

-- ---------------------------------------------------------------------------
-- 3. Catálogo: Modelos (por unidad de negocio; solo SUELA/ALMOHADA/DUAL COLOR)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.modelos (
  id                serial PRIMARY KEY,
  unidad_negocio_id integer NOT NULL REFERENCES public.unidades_negocio(id),
  nombre            varchar(150) NOT NULL,
  activo            boolean DEFAULT true,
  creado_en         timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT modelos_unidad_nombre_key UNIQUE (unidad_negocio_id, nombre)
);
CREATE INDEX IF NOT EXISTS idx_modelos_unidad        ON public.modelos (unidad_negocio_id);
-- Búsqueda tipo autocompletar case-insensitive por prefijo
CREATE INDEX IF NOT EXISTS idx_modelos_nombre_lower  ON public.modelos (lower(nombre));

-- ---------------------------------------------------------------------------
-- 4. tipos_defectos: agrupar por grupo_defecto
--    El mismo nombre de defecto puede existir en más de un grupo (ej. QUEMADO
--    en ENSAMBLE y DIGITAL_PRINTING), por eso la unicidad pasa a (nombre, grupo).
--    Las filas legadas quedan con grupo_defecto_id = NULL (historial).
-- ---------------------------------------------------------------------------
ALTER TABLE public.tipos_defectos
  ADD COLUMN IF NOT EXISTS grupo_defecto_id integer REFERENCES public.grupos_defecto(id);

ALTER TABLE public.tipos_defectos
  DROP CONSTRAINT IF EXISTS tipos_defectos_nombre_key;

ALTER TABLE public.tipos_defectos
  DROP CONSTRAINT IF EXISTS tipos_defectos_nombre_grupo_key;
ALTER TABLE public.tipos_defectos
  ADD CONSTRAINT tipos_defectos_nombre_grupo_key UNIQUE (nombre, grupo_defecto_id);

-- ---------------------------------------------------------------------------
-- 5. registros_defectos: nuevas columnas de clasificación
--    Nullable → NO se toca el historial (queda "sin clasificar").
-- ---------------------------------------------------------------------------
ALTER TABLE public.registros_defectos
  ADD COLUMN IF NOT EXISTS unidad_negocio_id integer REFERENCES public.unidades_negocio(id),
  ADD COLUMN IF NOT EXISTS modelo_id         integer REFERENCES public.modelos(id),
  ADD COLUMN IF NOT EXISTS proceso_crocs     varchar(20);

-- proceso_crocs solo admite los dos valores válidos (o NULL)
ALTER TABLE public.registros_defectos
  DROP CONSTRAINT IF EXISTS registros_defectos_proceso_crocs_check;
ALTER TABLE public.registros_defectos
  ADD CONSTRAINT registros_defectos_proceso_crocs_check
  CHECK (proceso_crocs IS NULL OR proceso_crocs IN ('ENSAMBLE','DIGITAL_PRINTING'));

-- Coherencia: un registro clasificado lleva modelo XOR proceso_crocs
-- (la regla "CROCS⇒proceso / otras⇒modelo" la valida además la API).
-- Los registros legados (unidad_negocio_id NULL) quedan exentos.
ALTER TABLE public.registros_defectos
  DROP CONSTRAINT IF EXISTS registros_defectos_clasificacion_check;
ALTER TABLE public.registros_defectos
  ADD CONSTRAINT registros_defectos_clasificacion_check
  CHECK (
    unidad_negocio_id IS NULL
    OR (proceso_crocs IS NOT NULL AND modelo_id IS NULL)
    OR (proceso_crocs IS NULL     AND modelo_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_registros_unidad ON public.registros_defectos (unidad_negocio_id);
CREATE INDEX IF NOT EXISTS idx_registros_modelo ON public.registros_defectos (modelo_id);

-- ---------------------------------------------------------------------------
-- 6. Áreas: agregar Inyección y Retrabajo; desactivar Digital Printing como área
--    (Digital Printing pasa a ser Proceso Crocs, no área.)
-- ---------------------------------------------------------------------------
INSERT INTO public.areas_produccion (nombre, descripcion, activo) VALUES
  ('Inyección', 'Área de inyección', true),
  ('Retrabajo', 'Área de retrabajo', true)
ON CONFLICT (nombre) DO NOTHING;

UPDATE public.areas_produccion SET activo = false WHERE nombre = 'Digital Printing';

COMMIT;
