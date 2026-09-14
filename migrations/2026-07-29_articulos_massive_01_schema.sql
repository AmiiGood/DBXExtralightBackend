-- ============================================================================
-- CARGA MASIVA DE ARTÍCULOS (Articles Massive Load) — Esquema
-- Catálogos para generar el archivo "ARTICLES MASSIVE LOAD" (hoja Articles):
--   cat_colores              código de color → nombre (une con productos_crocs.color)
--   cat_estilos              estilos PF con nombre limpio y corrida de tallas
--   cat_unfin / cat_strap    modelos SEM seleccionables por el usuario
--   cat_tallas_equivalencias talla Crocs → sufijos numéricos unfin/strap,
--                            talla del strap, display y QTY por caja
--
-- Idempotente. Correr ANTES del archivo de seed (02_seed).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Catálogo: Colores (código como texto: conserva ceros a la izquierda '001')
--    Sin FK dura desde productos_crocs: el Avery puede traer colores nuevos
--    antes de que existan aquí; el módulo avisa y permite darlos de alta.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cat_colores (
  codigo    varchar(10) PRIMARY KEY,
  nombre    varchar(100) NOT NULL,
  activo    boolean DEFAULT true,
  creado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 2. Catálogo: Estilos PF (sección "PRODUCTO TERMINADO" del catálogo Crocs)
--    nombre = nombre limpio para Description/Product Group/GroupDescription
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cat_estilos (
  codigo         varchar(20) PRIMARY KEY,
  nombre         varchar(100) NOT NULL,
  corrida_tallas varchar(50),
  obsoleto       boolean DEFAULT false,
  activo         boolean DEFAULT true,
  creado_en      timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 3. Catálogos: Unfin y Strap (el usuario elige cuál aplica en cada bloque;
--    no hay relación fija PF→Unfin→Strap). codigo permite NULL porque hay
--    modelos aún sin código asignado (ej. Unfin Classic Realtree APX).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cat_unfin (
  id        serial PRIMARY KEY,
  codigo    varchar(20) UNIQUE,
  nombre    varchar(100) NOT NULL UNIQUE,
  nota      text,
  obsoleto  boolean DEFAULT false,
  activo    boolean DEFAULT true,
  creado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.cat_strap (
  id        serial PRIMARY KEY,
  codigo    varchar(20) UNIQUE,
  nombre    varchar(100) NOT NULL UNIQUE,
  nota      text,
  obsoleto  boolean DEFAULT false,
  activo    boolean DEFAULT true,
  creado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 4. Catálogo: Equivalencias de tallas
--    talla          = SIZE del PF/Unfin (M2W4, C7, J1, ...)
--    talla_display  = como aparece en Description (M2/W4)
--    sufijo_unfin   = talla equivalente en el código Unfin (102, 107, 121...)
--    talla_strap    = SIZE de la fila Strap (M2 en adulto; C7/J1 en kids)
--    sufijo_strap   = talla equivalente en el código Strap (032 adulto, 107 kids)
--    qty_pares      = QTY P/BOX de PF y Unfin (12 adulto / 24 kids)
--    qty_strap      = QTY P/BOX del Strap (24 adulto / 48 kids)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cat_tallas_equivalencias (
  talla         varchar(10) PRIMARY KEY,
  talla_display varchar(15) NOT NULL,
  sufijo_unfin  varchar(5)  NOT NULL,
  talla_strap   varchar(10) NOT NULL,
  sufijo_strap  varchar(5)  NOT NULL,
  qty_pares     integer     NOT NULL,
  qty_strap     integer     NOT NULL,
  es_kids       boolean     NOT NULL DEFAULT false,
  orden         integer     NOT NULL DEFAULT 0,
  activo        boolean     DEFAULT true
);

-- ---------------------------------------------------------------------------
-- 5. Registro del módulo para el sistema de permisos
-- ---------------------------------------------------------------------------
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo)
SELECT 'Carga Masiva de Artículos',
       'Generación del archivo Articles Massive Load para alta de artículos',
       'FileSpreadsheet',
       '/produccion/carga-articulos',
       true
WHERE NOT EXISTS (
  SELECT 1 FROM public.modulos WHERE nombre = 'Carga Masiva de Artículos'
);

COMMIT;
