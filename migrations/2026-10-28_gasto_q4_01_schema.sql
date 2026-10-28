-- ============================================================================
-- GASTO Q4 — Esquema
--
-- Cada área entregó lo que necesita gastar de octubre a diciembre para seguir
-- operando, "solo lo indispensable", en el libro "Budget Acumulado 2026"
-- (hoja Q42026: Departamento, Concepto, octubre, noviembre, diciembre).
--
-- Se carga UNA vez. Si hubiera que corregir algo se vuelve a subir y reemplaza
-- lo anterior; `gq4_cargas` queda como bitácora de quién subió qué.
--
-- El tipo de gasto (fijo, variable, de una sola vez) NO se guarda: sale de los
-- montos al consultar, así una corrección al archivo lo recalcula sola.
--
-- Montos en pesos. La vista en dólares usa `tipos_cambio` (FIX de Banxico).
--
-- Idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Áreas
--
--    El libro escribe la misma área de varias formas entre hojas ("logistica"
--    y "Logística", "S.Patrimonial" y "Patrimonial", "Almacen" y "WH"). Los
--    alias se comparan sin acentos, mayúsculas, puntos ni espacios.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gq4_areas (
  clave   varchar(30)  PRIMARY KEY,
  nombre  varchar(80)  NOT NULL,
  alias   text[]       NOT NULL DEFAULT '{}',
  orden   smallint     NOT NULL DEFAULT 0
);

INSERT INTO public.gq4_areas (clave, nombre, alias, orden) VALUES
  ('rh',            'RH',                    '{rh,recursoshumanos}',                      1),
  ('ti',            'TI',                    '{ti,it,sistemas}',                          2),
  ('almacen',       'Almacén',               '{almacen,wh,warehouse}',                    3),
  ('logistica',     'Logística',             '{logistica}',                               4),
  ('patrimonial',   'Seguridad Patrimonial', '{spatrimonial,patrimonial,seguridadpatrimonial}', 5),
  ('inyeccion',     'Inyección Crocs',       '{inyeccioncrocs,inycrocs,inyeccion}',       6),
  ('hse',           'HSE',                   '{hse}',                                     7),
  ('ensamble',      'Ensamble',              '{ensamble}',                                8),
  ('mantenimiento', 'Mantenimiento',         '{mantenimiento}',                           9),
  ('moldes',        'Moldes',                '{moldes}',                                 10),
  ('facilities',    'Facilities',            '{facilities}',                             11),
  ('compuestos',    'Compuestos',            '{compuestos,compound}',                    12)
ON CONFLICT (clave) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Cargas (bitácora; solo la última es la vigente)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gq4_cargas (
  id          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  archivo     varchar(255),
  hoja        varchar(80),
  anio        smallint       NOT NULL,
  conceptos   integer        NOT NULL DEFAULT 0,
  total       numeric(16,2)  NOT NULL DEFAULT 0,
  usuario_id  integer        REFERENCES public.usuarios (id),
  creado_en   timestamp      NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. Conceptos, uno por renglón de la hoja
--
--    `renglon` es el número de renglón en Excel: con eso quien arma el libro
--    encuentra el concepto. Un mismo nombre puede repetirse en un área
--    (Inyección trae cinco "Control de proceso" con montos distintos).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gq4_conceptos (
  id          serial         PRIMARY KEY,
  carga_id    uuid           NOT NULL REFERENCES public.gq4_cargas (id) ON DELETE CASCADE,
  area_clave  varchar(30)    NOT NULL REFERENCES public.gq4_areas (clave),
  concepto    varchar(300)   NOT NULL,
  renglon     integer        NOT NULL,
  octubre     numeric(14,2)  NOT NULL DEFAULT 0,
  noviembre   numeric(14,2)  NOT NULL DEFAULT 0,
  diciembre   numeric(14,2)  NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_gq4_conceptos_carga ON public.gq4_conceptos (carga_id, area_clave);

-- ---------------------------------------------------------------------------
-- 4. Tipos de cambio
--
--    Genérica a propósito: hoy solo la usa Gasto Q4, pero cualquier reporte en
--    dólares la puede leer. SF43718 = pesos por dólar, FIX (el que publica el
--    DOF). Se guarda tal como lo da Banxico, uno por día hábil.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tipos_cambio (
  serie        varchar(20)    NOT NULL,
  fecha        date           NOT NULL,
  valor        numeric(12,6)  NOT NULL,
  obtenido_en  timestamp      NOT NULL DEFAULT now(),
  PRIMARY KEY (serie, fecha)
);

-- ---------------------------------------------------------------------------
-- 5. Módulos
-- ---------------------------------------------------------------------------
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Reportes de Gasto Q4',
       'Lo que cada área necesita gastar de octubre a diciembre, en pesos o en dólares',
       'Wallet',
       '/gasto-q4/reportes',
       true,
       30
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/gasto-q4/reportes');

INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Carga de Gasto Q4',
       'Subida del libro Budget Acumulado (hoja Q42026)',
       'Upload',
       '/gasto-q4/carga',
       true,
       31
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/gasto-q4/carga');

COMMIT;
