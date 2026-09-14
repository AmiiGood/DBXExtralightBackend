-- ============================================================================
-- REPORTES PROGRAMADOS POR CORREO — Esquema
--
-- Listas de correo reutilizables + programaciones que envían un reporte en PDF
-- cierto día a cierta hora, y bitácora de cada envío.
--
-- Decisión importante: el periodo del reporte se guarda RELATIVO a la fecha de
-- envío ('semana anterior', 'mes anterior'), no como un filtro fijo. Si se
-- guardara fijo, la programación mandaría enero de 2026 todos los lunes para
-- siempre. 'FIJO' existe para el caso raro de querer siempre el mismo corte.
--
-- Idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Listas de correo
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.listas_correo (
  id          serial PRIMARY KEY,
  nombre      varchar(100) NOT NULL UNIQUE,
  descripcion text,
  activo      boolean DEFAULT true,
  creado_por  integer REFERENCES public.usuarios(id),
  creado_en   timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 2. Miembros de cada lista
--    Los destinatarios SOLO salen de aquí: el formulario de envío nunca acepta
--    correos escritos a mano, para que el módulo no se convierta en una vía
--    para mandar información de producción a cualquier lado.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.listas_correo_miembros (
  id        serial PRIMARY KEY,
  lista_id  integer NOT NULL REFERENCES public.listas_correo(id) ON DELETE CASCADE,
  nombre    varchar(150),
  correo    varchar(254) NOT NULL,
  activo    boolean DEFAULT true,
  creado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT listas_correo_miembros_correo_check
    CHECK (position('@' in correo) > 1)
);
CREATE INDEX IF NOT EXISTS idx_lcm_lista ON public.listas_correo_miembros (lista_id);
-- Un correo no se repite dentro de la misma lista, sin importar mayúsculas
CREATE UNIQUE INDEX IF NOT EXISTS idx_lcm_lista_correo
  ON public.listas_correo_miembros (lista_id, lower(correo));

-- ---------------------------------------------------------------------------
-- 3. Programaciones
--    La expresión cron se deriva de frecuencia + día + hora y se guarda para
--    poder depurar qué se le pasó realmente al planificador.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reportes_programados (
  id                serial PRIMARY KEY,
  nombre            varchar(150) NOT NULL,
  reporte           varchar(40)  NOT NULL DEFAULT 'INYECCION',
  formato           varchar(10)  NOT NULL DEFAULT 'PDF',

  -- Qué periodo cubre el reporte, relativo al día del envío
  periodo_relativo  varchar(30)  NOT NULL DEFAULT 'SEMANA_ANTERIOR',
  filtros           jsonb        DEFAULT '{}'::jsonb,

  -- Cuándo se manda
  frecuencia        varchar(10)  NOT NULL DEFAULT 'SEMANAL',
  dia               integer,          -- 0-6 (dom-sáb) semanal; 1-31 mensual
  hora              integer NOT NULL DEFAULT 8,
  minuto            integer NOT NULL DEFAULT 0,
  zona_horaria      varchar(60)  NOT NULL DEFAULT 'America/Mexico_City',
  expresion_cron    varchar(60)  NOT NULL,

  lista_id          integer NOT NULL REFERENCES public.listas_correo(id),
  asunto            varchar(200),
  mensaje           text,

  activo            boolean DEFAULT true,
  ultima_ejecucion  timestamp without time zone,
  creado_por        integer REFERENCES public.usuarios(id),
  creado_en         timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    timestamp without time zone DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT rp_formato_check
    CHECK (formato IN ('PDF','XLSX','AMBOS')),
  CONSTRAINT rp_frecuencia_check
    CHECK (frecuencia IN ('DIARIA','SEMANAL','MENSUAL')),
  CONSTRAINT rp_periodo_check
    CHECK (periodo_relativo IN
      ('SEMANA_ANTERIOR','MES_ANTERIOR','MES_ACTUAL','TRIMESTRE_ANTERIOR',
       'ANIO_ACTUAL','FIJO')),
  CONSTRAINT rp_hora_check   CHECK (hora   BETWEEN 0 AND 23),
  CONSTRAINT rp_minuto_check CHECK (minuto BETWEEN 0 AND 59),
  -- El día es obligatorio salvo en la frecuencia diaria, y su rango depende
  -- de si la programación es semanal o mensual
  CONSTRAINT rp_dia_check CHECK (
    (frecuencia = 'DIARIA'  AND dia IS NULL) OR
    (frecuencia = 'SEMANAL' AND dia BETWEEN 0 AND 6) OR
    (frecuencia = 'MENSUAL' AND dia BETWEEN 1 AND 31)
  )
);
CREATE INDEX IF NOT EXISTS idx_rp_activo ON public.reportes_programados (activo);
CREATE INDEX IF NOT EXISTS idx_rp_lista  ON public.reportes_programados (lista_id);

-- ---------------------------------------------------------------------------
-- 4. Bitácora de envíos
--    programado_id es NULL en los envíos manuales ("Probar ahora").
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reportes_envios (
  id             serial PRIMARY KEY,
  programado_id  integer REFERENCES public.reportes_programados(id) ON DELETE SET NULL,
  disparo        varchar(12) NOT NULL DEFAULT 'PROGRAMADO',
  estado         varchar(12) NOT NULL,
  destinatarios  text[],
  asunto         varchar(200),
  periodo        varchar(60),
  adjuntos       jsonb,
  bytes          integer,
  duracion_ms    integer,
  error          text,
  enviado_por    integer REFERENCES public.usuarios(id),
  creado_en      timestamp without time zone DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT re_estado_check  CHECK (estado  IN ('ENVIADO','ERROR')),
  CONSTRAINT re_disparo_check CHECK (disparo IN ('PROGRAMADO','MANUAL'))
);
CREATE INDEX IF NOT EXISTS idx_re_programado ON public.reportes_envios (programado_id);
CREATE INDEX IF NOT EXISTS idx_re_fecha      ON public.reportes_envios (creado_en DESC);

-- ---------------------------------------------------------------------------
-- 5. Módulo para el sistema de permisos
-- ---------------------------------------------------------------------------
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo)
SELECT 'Envío de Reportes',
       'Listas de correo y programación de reportes automáticos',
       'Mail',
       '/admin/envio-reportes',
       true
WHERE NOT EXISTS (
  SELECT 1 FROM public.modulos WHERE nombre = 'Envío de Reportes'
);

COMMIT;
