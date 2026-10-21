-- ============================================================================
-- AIMS — Esquema
--
-- Indicadores de AIMS (Asset Integrity Management System): doce KPIs
-- mensuales, cada uno en su hoja del libro 'KPIs AIMS revN <fecha>.xlsx'.
--
-- Mismo patrón que CAPEX: el libro vive en una carpeta de red, se guarda como
-- un archivo nuevo en cada revisión y se toma el de la rev más alta. Al crear
-- esto el área todavía no decidía en qué carpeta lo va a dejar, así que la
-- carpeta nace vacía y la lectura apagada; se configura desde la pantalla.
--
-- ---------------------------------------------------------------------------
-- QUÉ SE GUARDA Y QUÉ NO
-- ---------------------------------------------------------------------------
-- Se guarda la ficha de cada KPI (definición, cálculo, meta, fuente) y su valor
-- por mes. NO se guardan las tablas dinámicas del libro: su "Total general"
-- suma los porcentajes de los meses (464% en KPI-11). El acumulado del año se
-- calcula al consultar, según `agregado`.
--
-- Solo entran los meses que el área marcó "OK" en la columna A de cada hoja,
-- que es lo mismo que filtra la gráfica del libro. Ver utils/aimsExcelParser.
--
-- Idempotente. Correr ANTES del seed (02_seed).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. El libro que se vigila
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aims_archivo (
  clave           varchar(20)  PRIMARY KEY,
  nombre          varchar(80)  NOT NULL,
  -- UNC, nunca la unidad mapeada. Vacía hasta que el área decida dónde va.
  carpeta         varchar(400) NOT NULL DEFAULT '',
  -- Principio del nombre; se lee el de la rev más alta
  patron          varchar(200) NOT NULL,
  activo          boolean      NOT NULL DEFAULT false,

  archivo         varchar(200),
  revision        integer,
  huella          varchar(64),
  tamano_bytes    bigint,
  modificado_en   timestamp,
  leido_en        timestamp,
  kpis            integer,
  avisos          text,
  ultimo_error    text,
  error_en        timestamp,
  actualizado_en  timestamp    NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. La ficha de cada indicador
--
--    `meta` va en la misma unidad que el valor: fracción para '%' (0.85) y
--    minutos para 'min'. `sentido` dice si cumplir es estar arriba (MAYOR) o
--    abajo (MENOR) de la meta: MTTR e indisponibilidad son MENOR.
--
--    `agregado` dice cómo se junta el año:
--      PROMEDIO   promedio de los meses
--      RAZON      Σ numerador / Σ denominador (horas, máquinas)
--      PONDERADO  promedio pesado por número de OT (MTTR, MTBF)
--      ULTIMO     el último mes, porque el indicador ya es acumulado (plan AIMS)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aims_kpis (
  codigo          varchar(20)  PRIMARY KEY,
  orden           smallint     NOT NULL,
  nombre          varchar(150),
  definicion      text,
  calculo         text,
  meta_texto      varchar(40),
  meta            numeric(14,6),
  sentido         varchar(5)   NOT NULL DEFAULT 'MAYOR',
  unidad          varchar(5)   NOT NULL DEFAULT '%',
  fuente          varchar(200),
  agregado        varchar(10)  NOT NULL DEFAULT 'PROMEDIO',
  -- Lo que trae la hoja aparte de la tabla (lista de cursos de KPI-04)
  extra           jsonb,
  archivo_origen  varchar(200) NOT NULL,
  carga_id        uuid,
  CONSTRAINT aims_kpis_sentido_check CHECK (sentido IN ('MAYOR', 'MENOR')),
  CONSTRAINT aims_kpis_agregado_check CHECK (agregado IN ('PROMEDIO', 'RAZON', 'PONDERADO', 'ULTIMO'))
);

-- ---------------------------------------------------------------------------
-- 3. El valor de cada indicador por mes
--
--    `valor` NULL = el mes está cerrado pero no trae dato (los legales de
--    julio a septiembre, "pendiente al cierre"). No es un cero.
--    `detalle` guarda lo que explica el número: máquinas que faltaron en el
--    plan de mantenimiento, uso por BU, puntos cerrados, y una `nota` corta.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aims_valores (
  codigo          varchar(20)  NOT NULL REFERENCES public.aims_kpis (codigo) ON DELETE CASCADE,
  anio            smallint     NOT NULL,
  mes             smallint     NOT NULL,
  valor           numeric(14,6),
  numerador       numeric(14,4),
  denominador     numeric(14,4),
  peso            numeric(14,4),
  detalle         jsonb,
  PRIMARY KEY (codigo, anio, mes),
  CONSTRAINT aims_valores_mes_check CHECK (mes BETWEEN 1 AND 12)
);

-- ---------------------------------------------------------------------------
-- 4. Bitácora
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aims_sincronizaciones (
  id             uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  archivo        varchar(200),
  revision       integer,
  iniciada_en    timestamp  NOT NULL DEFAULT now(),
  terminada_en   timestamp,
  exito          boolean,
  hubo_cambio    boolean    NOT NULL DEFAULT false,
  kpis           integer,
  meses          integer,
  duracion_ms    integer,
  mensaje        text,
  usuario_id     integer    REFERENCES public.usuarios (id)
);

CREATE INDEX IF NOT EXISTS idx_aims_sinc_iniciada ON public.aims_sincronizaciones (iniciada_en DESC);

-- ---------------------------------------------------------------------------
-- 5. Módulos
-- ---------------------------------------------------------------------------
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Reportes de AIMS',
       'Los doce indicadores de AIMS mes a mes contra su meta',
       'ShieldCheck',
       '/aims/reportes',
       true,
       26
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/aims/reportes');

INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Archivo de AIMS',
       'De qué carpeta sale el libro de indicadores de AIMS',
       'FolderCog',
       '/aims/archivo',
       true,
       27
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/aims/archivo');

COMMIT;
