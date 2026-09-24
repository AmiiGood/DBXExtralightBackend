-- ============================================================================
-- TI — Réplica local de los tickets de osTicket
--
-- Mismo patrón que Moldes (2026-09-01_moldes_tickets_01_schema.sql): el área
-- atiende por osTicket, que vive en otro servidor (MariaDB sobre XAMPP en la
-- red de planta), y el reporte NUNCA lo consulta en vivo. Los tickets se
-- replican aquí y el reporte solo lee esta tabla.
--
-- La razón no ha cambiado: osTicket es el sistema del que depende toda la
-- planta para levantar tickets. El 2026-09-01 una consulta de prueba lo dejó
-- caído 45 minutos. No es lugar para poner encima la carga de un tablero.
--
-- ---------------------------------------------------------------------------
-- QUÉ TIENE TI QUE MOLDES NO
-- ---------------------------------------------------------------------------
-- Medido sobre los 5,463 tickets del departamento (mayo 2021 a hoy):
--
--   PRIMERA RESPUESTA. 4,999 tickets tienen respuesta de un agente registrada
--   en ost_thread_entry. Es EL indicador de una mesa de ayuda —lo que el
--   usuario siente es cuánto tardaron en contestarle, no cuánto tardaron en
--   cerrar— y el reporte de Moldes no lo usa.
--
--   AGENTE ASIGNADO en el 98.7%. Se guarda el ID y NUNCA el nombre: el reporte
--   mide cómo se reparte la carga, no a las personas. Con el id basta para
--   contar agentes distintos y ver la concentración.
--
-- Y qué NO tiene: el SLA está sin usar. Cero tickets con `duedate` y cero
-- marcados como vencidos, así que no hay forma de medir cumplimiento. Si algún
-- día se configura en osTicket, se agrega aquí.
--
-- Casi no hay reaperturas: 20 de 5,463 (0.4%). En Moldes eran 1,590 y
-- distorsionaban la cola; aquí el problema prácticamente no existe.
--
-- Idempotente. Correr ANTES del seed si lo hubiera.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Tickets replicados
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ti_tickets (
  -- La llave es la de osTicket, para que la sincronización haga UPSERT sin
  -- llevar ninguna tabla de correspondencias.
  ticket_id             integer      PRIMARY KEY,
  numero                varchar(32)  NOT NULL,

  -- El tema se guarda desnormalizado, igual que en Moldes: es un catálogo de
  -- doce filas en osTicket y copiar el texto evita replicar esa tabla.
  -- `tema_corto` quita el prefijo 'IT - ' para que quepa en los ejes.
  tema                  varchar(160) NOT NULL,
  tema_corto            varchar(160) NOT NULL,

  estado                varchar(80)  NOT NULL,
  -- open | closed | archived | deleted, como los agrupa osTicket
  estado_grupo          varchar(20)  NOT NULL,

  -- SOLO el id del agente, nunca su nombre. El reporte enseña cómo se reparte
  -- el trabajo y cuántas personas lo atienden, no quién tarda más.
  agente_id             integer,

  creado                timestamp    NOT NULL,
  cerrado               timestamp,
  reabierto             timestamp,
  -- Primer mensaje de un agente en el hilo (ost_thread_entry, type = 'R')
  primera_respuesta     timestamp,
  -- `updated` de osTicket: la marca que usa la sincronización incremental
  actualizado           timestamp,

  -- Los dos indicadores, calculados aquí y no en cada consulta: así se pueden
  -- indexar y todas las métricas parten exactamente de la misma base. Quedan
  -- NULL mientras no aplique, que es lo correcto — un ticket sin cerrar no
  -- tiene tiempo de resolución todavía.
  horas_resolucion      numeric(12,4)
    GENERATED ALWAYS AS (
      EXTRACT(EPOCH FROM (cerrado - creado)) / 3600.0
    ) STORED,
  horas_primera_respuesta numeric(12,4)
    GENERATED ALWAYS AS (
      EXTRACT(EPOCH FROM (primera_respuesta - creado)) / 3600.0
    ) STORED,

  sincronizado_en       timestamp    NOT NULL DEFAULT now(),

  -- Un cierre anterior a la creación sería dato corrupto. Hoy no hay ninguno;
  -- la restricción está para que si aparece uno se note al sincronizar, en vez
  -- de envenenar las medianas en silencio.
  CONSTRAINT ti_tickets_cierre_valido
    CHECK (cerrado IS NULL OR cerrado >= creado),
  -- La primera respuesta SÍ puede venir antes de tiempo en teoría, pero nunca
  -- antes de que exista el ticket.
  CONSTRAINT ti_tickets_respuesta_valida
    CHECK (primera_respuesta IS NULL OR primera_respuesta >= creado)
);

COMMENT ON TABLE public.ti_tickets IS
  'Réplica de los tickets del departamento IT de osTicket. Solo la escribe el sincronizador.';
COMMENT ON COLUMN public.ti_tickets.agente_id IS
  'Id del agente en osTicket. A propósito sin el nombre: se mide el reparto de la carga, no a las personas.';
COMMENT ON COLUMN public.ti_tickets.horas_primera_respuesta IS
  'Horas hasta el primer mensaje de un agente. Es lo que percibe quien levantó el ticket.';

-- El reporte casi siempre filtra por tema y corta por fecha de creación
CREATE INDEX IF NOT EXISTS idx_ti_tickets_tema_creado
  ON public.ti_tickets (tema, creado);
CREATE INDEX IF NOT EXISTS idx_ti_tickets_creado
  ON public.ti_tickets (creado);
-- Parciales: las métricas de tiempo solo miran tickets que ya tienen el dato
CREATE INDEX IF NOT EXISTS idx_ti_tickets_horas
  ON public.ti_tickets (horas_resolucion)
  WHERE horas_resolucion IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ti_tickets_respuesta
  ON public.ti_tickets (horas_primera_respuesta)
  WHERE horas_primera_respuesta IS NOT NULL;
-- El backlog: pocos tickets (73 hoy) contra 5,463, vale la pena el parcial
CREATE INDEX IF NOT EXISTS idx_ti_tickets_abiertos
  ON public.ti_tickets (creado)
  WHERE estado_grupo = 'open';

-- ---------------------------------------------------------------------------
-- Bitácora de sincronizaciones
--
-- Sirve para dos cosas: saber desde cuándo pedir los cambios la próxima vez, y
-- poder decir en pantalla qué tan fresco está el dato.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ti_sincronizaciones (
  id                serial     PRIMARY KEY,
  iniciada_en       timestamp  NOT NULL DEFAULT now(),
  terminada_en      timestamp,
  exito             boolean,
  -- Hasta qué `updated` de osTicket se alcanzó a traer. La siguiente corrida
  -- arranca de aquí y no del reloj: si el otro servidor va desfasado, usar la
  -- hora local dejaría huecos.
  corte_actualizado timestamp,
  filas_nuevas      integer    NOT NULL DEFAULT 0,
  filas_modificadas integer    NOT NULL DEFAULT 0,
  duracion_ms       integer,
  mensaje           text
);

CREATE INDEX IF NOT EXISTS idx_ti_sinc_iniciada
  ON public.ti_sincronizaciones (iniciada_en DESC);

-- ---------------------------------------------------------------------------
-- Módulo
-- ---------------------------------------------------------------------------
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Reportes de TI',
       'Tiempos de atención y primera respuesta de la mesa de ayuda',
       'Headphones',
       '/ti/reportes',
       true,
       20
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/ti/reportes');

COMMIT;
