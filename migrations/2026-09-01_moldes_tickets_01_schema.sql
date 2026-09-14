-- ============================================================================
-- MOLDES — Réplica local de los tickets de osTicket
--
-- El área de Moldes atiende sus servicios por osTicket, una mesa de ayuda que
-- vive en otro servidor (MariaDB sobre XAMPP, en la red de planta). El reporte
-- necesita esos tickets, pero NO puede consultarlos en vivo:
--
--   * Cada consulta del reporte recorre entre 66 mil y 109 mil tickets. Medido
--     contra el servidor real tardaba entre 1 y 14 segundos, según qué tanto
--     estuviera ocupado atendiendo a la planta.
--   * osTicket solo tiene índices sueltos en topic_id, created y closed. No hay
--     forma de acomodarlos para este reporte sin tocar su base, que es de un
--     sistema de terceros en producción.
--   * Es el sistema del que depende toda la planta para levantar tickets. No es
--     lugar para poner encima la carga de un tablero de dirección.
--
-- Por eso los tickets se replican aquí y el reporte solo lee esta tabla. La
-- sincronización es incremental y corre cada 15 minutos; osTicket recibe una
-- consulta liviana en vez de siete pesadas por cada visita al reporte.
--
-- Idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Tickets replicados
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.moldes_tickets (
  -- La llave es la de osTicket, no una nueva: así la sincronización puede
  -- hacer UPSERT sin llevar ninguna tabla de correspondencias.
  ticket_id        integer      PRIMARY KEY,
  numero           varchar(32)  NOT NULL,

  -- Tema y departamento se guardan desnormalizados a propósito. Son catálogos
  -- que viven en osTicket; copiar el texto evita replicar también esas tablas
  -- y deja el reporte legible sin joins.
  tema             varchar(160) NOT NULL,
  tema_corto       varchar(160) NOT NULL,
  departamento     varchar(80)  NOT NULL,

  estado           varchar(80)  NOT NULL,
  -- open | closed | archived | deleted, como los agrupa osTicket
  estado_grupo     varchar(20)  NOT NULL,

  creado           timestamp    NOT NULL,
  cerrado          timestamp,
  reabierto        timestamp,
  -- `updated` de osTicket: es la marca que usa la sincronización incremental
  actualizado      timestamp,

  -- El indicador del área. Se calcula aquí y no en cada consulta para poder
  -- indexarlo y para que todas las métricas usen exactamente la misma base.
  -- Queda NULL mientras el ticket siga abierto, que es lo correcto: un ticket
  -- sin cerrar no tiene tiempo de resolución todavía.
  horas_resolucion numeric(12,4)
    GENERATED ALWAYS AS (
      EXTRACT(EPOCH FROM (cerrado - creado)) / 3600.0
    ) STORED,

  sincronizado_en  timestamp    NOT NULL DEFAULT now(),

  -- Un cierre anterior a la creación sería dato corrupto. Hoy no hay ninguno
  -- (se verificó sobre los 66 mil tickets de cambio de molde); la restricción
  -- está para que si algún día aparece uno, se note al sincronizar en vez de
  -- envenenar los promedios en silencio.
  CONSTRAINT moldes_tickets_cierre_valido
    CHECK (cerrado IS NULL OR cerrado >= creado)
);

COMMENT ON TABLE public.moldes_tickets IS
  'Réplica de los tickets de Moldes de osTicket. Solo la escribe el sincronizador.';
COMMENT ON COLUMN public.moldes_tickets.horas_resolucion IS
  'Horas entre creación y cierre. NULL mientras el ticket siga abierto.';

-- El reporte casi siempre filtra por tema y corta por fecha de creación
CREATE INDEX IF NOT EXISTS idx_moldes_tickets_tema_creado
  ON public.moldes_tickets (tema, creado);
CREATE INDEX IF NOT EXISTS idx_moldes_tickets_creado
  ON public.moldes_tickets (creado);
-- Parcial: las métricas de tiempo solo miran tickets cerrados
CREATE INDEX IF NOT EXISTS idx_moldes_tickets_horas
  ON public.moldes_tickets (horas_resolucion)
  WHERE horas_resolucion IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Bitácora de sincronizaciones
--
-- Sirve para dos cosas: saber desde cuándo pedir los cambios la próxima vez, y
-- poder decirle al usuario en pantalla qué tan fresco está el dato.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.moldes_sincronizaciones (
  id               serial       PRIMARY KEY,
  iniciada_en      timestamp    NOT NULL DEFAULT now(),
  terminada_en     timestamp,
  exito            boolean,
  -- Hasta qué `updated` de osTicket se alcanzó a traer. La siguiente corrida
  -- arranca de aquí, no de la hora del reloj: si el servidor de osTicket va
  -- desfasado respecto a este, usar la hora local dejaría huecos.
  corte_actualizado timestamp,
  filas_nuevas     integer      NOT NULL DEFAULT 0,
  filas_modificadas integer     NOT NULL DEFAULT 0,
  duracion_ms      integer,
  mensaje          text
);

CREATE INDEX IF NOT EXISTS idx_moldes_sinc_iniciada
  ON public.moldes_sincronizaciones (iniciada_en DESC);

-- ---------------------------------------------------------------------------
-- Módulo
-- ---------------------------------------------------------------------------
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo)
SELECT 'Reportes de Moldes',
       'Tiempos de atención del área de Moldes',
       'Boxes',
       '/moldes/reportes',
       true
WHERE NOT EXISTS (
  SELECT 1 FROM public.modulos WHERE nombre = 'Reportes de Moldes'
);

COMMIT;
