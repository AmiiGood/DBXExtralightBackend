-- ============================================================================
-- CAPEX — Esquema
--
-- Mismo patrón que Customer Service: el libro vive en una carpeta de red y el
-- servidor lo vigila. Dos diferencias:
--
--   1. El nombre cambia con cada revisión ('... Rev 04.xlsx', 'Rev 05', ...).
--      No se configura el archivo sino el PRINCIPIO del nombre, y se toma la
--      Rev más alta que haya en la carpeta. Nadie tiene que tocar la pantalla
--      cuando sale una revisión nueva.
--
--   2. El avance de cada proyecto no está escrito, está PINTADO: verde es
--      terminado, amarillo en proceso. Se guarda el estado de cada etapa leído
--      del color, aunque el reporte hoy solo usa uno: Firmas FOAM en verde,
--      que es el final del proceso interno. Lo que sigue (Firmas ITALIA) ya no
--      entra al reporte, y el área aclaró que el resto del avance no está al
--      día, así que no se enseña.
--
-- Solo se lee el bloque "CAPEX 2026" de la hoja 'Capex update 2025-2026' y
-- se omiten los renglones ocultos (el área oculta lo que ya no quiere ver).
-- Hoja y bloque son configurables: el año siguiente se cambian en la pantalla.
--
-- Idempotente. Correr ANTES del seed (02_seed).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Qué se vigila y cómo se encontró la última vez
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.capex_archivo (
  clave           varchar(20)  PRIMARY KEY,
  nombre          varchar(80)  NOT NULL,

  -- UNC, nunca la unidad mapeada (F:): la letra solo existe en la sesión de
  -- quien la montó.
  carpeta         varchar(400) NOT NULL,
  -- Principio del nombre. Se toma el que tenga la Rev más alta.
  patron          varchar(200) NOT NULL,
  hoja            varchar(100) NOT NULL,
  bloque          varchar(60)  NOT NULL,
  activo          boolean      NOT NULL DEFAULT true,

  -- El archivo que se eligió en la última lectura y su revisión
  archivo         varchar(200),
  revision        integer,

  huella          varchar(64),
  tamano_bytes    bigint,
  modificado_en   timestamp,
  leido_en        timestamp,
  filas           integer,
  aprobados       integer,
  avisos          text,
  ultimo_error    text,
  error_en        timestamp,
  actualizado_en  timestamp    NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.capex_archivo.patron IS
  'Principio del nombre del libro. Se lee el que tenga la Rev más alta en la carpeta.';
COMMENT ON COLUMN public.capex_archivo.huella IS
  'SHA-256 del contenido. Se relee solo si cambia o si aparece una Rev nueva.';

-- ---------------------------------------------------------------------------
-- 2. Los proyectos del bloque
--
--    Sin llave natural: el código se repite (26-MEX-05 'Wood audit' son seis
--    renglones, uno por sub-proyecto, cada uno con su avance). Por eso la carga
--    reemplaza la tabla completa, como cs_muestras.
--
--    `etapas` guarda el estado de cada columna de avance leído del color:
--      { "firmas_foam": { "estado": "VERDE", "texto": null }, ... }
--    con estado VERDE | AMARILLO | GRIS | SIN | OTRO. `aprobado_foam` es la
--    de Firmas FOAM sacada aparte, que es por la que filtra el reporte.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.capex_proyectos (
  id                      bigserial     PRIMARY KEY,
  fila                    integer       NOT NULL,
  codigo                  varchar(40),
  descripcion             text,
  dueno                   varchar(120),
  notas                   text,

  -- "Da gastar en 2026 (€)". NULL cuando el libro trae texto ('HSE', 'OPEX'),
  -- que se guarda en monto_texto.
  monto                   numeric(14,2),
  monto_texto             varchar(60),
  monto_relacion_tecnica  numeric(14,2),
  monto_final             numeric(14,2),

  gasto_q1                numeric(14,2),
  gasto_q2                numeric(14,2),
  gasto_q3                numeric(14,2),
  gasto_q4                numeric(14,2),
  -- Las notas de cada trimestre ('Año 2027'), en orden Q1..Q4
  notas_gasto             jsonb,
  total_gastado           numeric(14,2),

  etapas                  jsonb         NOT NULL DEFAULT '{}'::jsonb,
  aprobado_foam           boolean       NOT NULL DEFAULT false,

  bloque                  varchar(60)   NOT NULL,
  archivo_origen          varchar(200)  NOT NULL,
  carga_id                uuid,
  creado_en               timestamp     NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.capex_proyectos.etapas IS
  'Estado de cada etapa leído del COLOR de la celda: VERDE, AMARILLO, GRIS, SIN u OTRO.';
COMMENT ON COLUMN public.capex_proyectos.aprobado_foam IS
  'Firmas FOAM en verde: terminó el proceso interno. Es el filtro del reporte.';

CREATE INDEX IF NOT EXISTS idx_capex_proyectos_foam ON public.capex_proyectos (aprobado_foam);

-- ---------------------------------------------------------------------------
-- 3. Bitácora
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.capex_sincronizaciones (
  id             uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  archivo        varchar(200),
  revision       integer,
  iniciada_en    timestamp  NOT NULL DEFAULT now(),
  terminada_en   timestamp,
  exito          boolean,
  hubo_cambio    boolean    NOT NULL DEFAULT false,
  filas_cargadas integer    NOT NULL DEFAULT 0,
  aprobados      integer,
  duracion_ms    integer,
  mensaje        text,
  usuario_id     integer    REFERENCES public.usuarios (id)
);

CREATE INDEX IF NOT EXISTS idx_capex_sinc_iniciada ON public.capex_sincronizaciones (iniciada_en DESC);

-- ---------------------------------------------------------------------------
-- 4. Módulos
-- ---------------------------------------------------------------------------
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Reportes de CAPEX',
       'Proyectos CAPEX 2026 con firmas FOAM: monto y gasto por trimestre',
       'TrendingUp',
       '/capex/reportes',
       true,
       24
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/capex/reportes');

INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Archivo de CAPEX',
       'De qué carpeta y qué bloque del libro sale el reporte de CAPEX',
       'FolderCog',
       '/capex/archivo',
       true,
       25
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/capex/archivo');

COMMIT;
