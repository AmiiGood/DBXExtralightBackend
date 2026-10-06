-- ============================================================================
-- Compras — Aprobación de solicitudes antes de generar el ticket
--
-- Propuesta: DBX Extralight\Propuestas\Propuesta - Aprobacion de solicitudes
-- de Compras.docx (septiembre 2026).
--
-- Hoy cualquiera levanta un ticket en el osTicket de Compras y Compras lo
-- recibe de inmediato. Con esto la solicitud se captura primero en DBX, la
-- aprueba o rechaza el gerente del área que la pide, y solo las aprobadas se
-- convierten en ticket.
--
-- ---------------------------------------------------------------------------
-- EL osTicket DE COMPRAS NO ES EL DE MOLDES Y TI
-- ---------------------------------------------------------------------------
-- Vive en el mismo MariaDB (172.16.101.107) pero en otra base: `osticketadm`,
-- web en /osticketadm/upload/. Departamento Compras = id 4, números AD-######.
-- Tiene un TEMA por área solicitante, y son exactamente las 12 áreas de la
-- propuesta. El tema es lo que decide a dónde llega el ticket, por eso cada
-- área de este catálogo guarda su `osticket_topic_id`.
--
-- Medido el 2026-10-02 sobre la base de Compras:
--   - ~1,170 tickets en 2026, unos 30 por semana.
--   - Prioridad: 5,406 de 5,408 tickets son Normal (el default). Nadie la
--     elige en la práctica, así que la solicitud NO la pide.
--   - Adjuntos: 509 imágenes, 107 Excel, 47 PDF. Por eso se aceptan los tres
--     tipos y no solo imágenes.
--
-- ---------------------------------------------------------------------------
-- QUIÉN APRUEBA
-- ---------------------------------------------------------------------------
-- No es un rol: es el gerente (o el suplente) registrado en compras_areas.
-- Un gerente también pide cosas y hace su trabajo normal en DBX con el rol que
-- ya tiene; y Daniel Mendez, por ejemplo, aprueba tres áreas. Cambiar de
-- gerente es editar un renglón.
--
-- La autorización se revisa contra el gerente/suplente ACTUAL del área, no el
-- que estaba al crear la solicitud: si cambian al gerente, el nuevo hereda lo
-- pendiente.
--
-- El área de la solicitud sale del USUARIO (decisión de Alexis): cada área de
-- DBX (`areas`) apunta a un área de Compras. Varias áreas de DBX pueden caer en
-- la misma (Ensamble -> Inyección/Ensamble/Planeación).
--
-- Idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Áreas que solicitan, con su tema de osTicket y quién aprueba
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compras_areas (
  id                 serial       PRIMARY KEY,
  nombre             varchar(120) NOT NULL UNIQUE,
  -- ost_help_topic.topic_id en la base `osticketadm`
  osticket_topic_id  integer      NOT NULL UNIQUE,
  -- Sin gerente el área no puede pedir: la pantalla lo avisa en vez de dejar
  -- solicitudes que nadie va a ver.
  gerente_id         integer      REFERENCES public.usuarios(id),
  suplente_id        integer      REFERENCES public.usuarios(id),
  activo             boolean      NOT NULL DEFAULT true,
  actualizado_en     timestamp    NOT NULL DEFAULT now(),
  actualizado_por    integer      REFERENCES public.usuarios(id),

  CONSTRAINT compras_areas_suplente_distinto
    CHECK (suplente_id IS NULL OR suplente_id <> gerente_id)
);

COMMENT ON TABLE public.compras_areas IS
  'Áreas que piden a Compras. Cada una es un tema del osTicket de Compras y tiene un gerente que aprueba.';
COMMENT ON COLUMN public.compras_areas.osticket_topic_id IS
  'Tema (ost_help_topic) en la base osticketadm. Decide a qué cola de Compras llega el ticket.';

-- Área de DBX -> área de Compras
ALTER TABLE public.areas
  ADD COLUMN IF NOT EXISTS compras_area_id integer REFERENCES public.compras_areas(id);

COMMENT ON COLUMN public.areas.compras_area_id IS
  'Área de Compras a la que se cargan las solicitudes de los usuarios de esta área.';

-- ---------------------------------------------------------------------------
-- Solicitudes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compras_solicitudes (
  id                 serial       PRIMARY KEY,
  folio              varchar(16)  GENERATED ALWAYS AS ('SC-' || lpad(id::text, 6, '0')) STORED,

  solicitante_id     integer      NOT NULL REFERENCES public.usuarios(id),
  -- Se fija al crear: si después cambian al usuario de área, la solicitud se
  -- queda en el área desde la que se pidió.
  compras_area_id    integer      NOT NULL REFERENCES public.compras_areas(id),

  asunto             varchar(200) NOT NULL,
  detalle            text         NOT NULL,

  -- PENDIENTE   espera al gerente
  -- APROBADA    autorizada, todavía sin ticket
  -- RECHAZADA   con motivo
  -- CANCELADA   la retiró quien la pidió, antes de que se decidiera
  -- EN_COMPRAS  ya existe el ticket en osTicket
  estado             varchar(12)  NOT NULL DEFAULT 'PENDIENTE',

  creado_en          timestamp    NOT NULL DEFAULT now(),

  decidido_por       integer      REFERENCES public.usuarios(id),
  decidido_en        timestamp,
  -- Obligatorio al rechazar, opcional al aprobar
  comentario         text,

  -- Llenado por la conexión con osTicket (etapa 2)
  osticket_ticket_id integer,
  osticket_numero    varchar(32),
  enviado_en         timestamp,
  intentos_envio     integer      NOT NULL DEFAULT 0,
  ultimo_error_envio text,

  CONSTRAINT compras_solicitudes_estado_valido
    CHECK (estado IN ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'CANCELADA', 'EN_COMPRAS')),
  CONSTRAINT compras_solicitudes_rechazo_con_motivo
    CHECK (estado <> 'RECHAZADA' OR length(btrim(coalesce(comentario, ''))) > 0),
  CONSTRAINT compras_solicitudes_decision_completa
    CHECK (estado IN ('PENDIENTE', 'CANCELADA') OR (decidido_por IS NOT NULL AND decidido_en IS NOT NULL)),
  CONSTRAINT compras_solicitudes_ticket_completo
    CHECK (estado <> 'EN_COMPRAS' OR osticket_ticket_id IS NOT NULL)
);

COMMENT ON TABLE public.compras_solicitudes IS
  'Solicitudes de compra que esperan la aprobación del gerente antes de volverse ticket en el osTicket de Compras.';

CREATE INDEX IF NOT EXISTS idx_compras_sol_solicitante
  ON public.compras_solicitudes (solicitante_id, creado_en DESC);
-- La bandeja del gerente: pocas pendientes contra todo el histórico
CREATE INDEX IF NOT EXISTS idx_compras_sol_pendientes
  ON public.compras_solicitudes (compras_area_id, creado_en)
  WHERE estado = 'PENDIENTE';
CREATE INDEX IF NOT EXISTS idx_compras_sol_area_creado
  ON public.compras_solicitudes (compras_area_id, creado_en DESC);

-- ---------------------------------------------------------------------------
-- Archivos adjuntos
--
-- El archivo va a disco (COMPRAS_ARCHIVOS_DIR) y aquí solo sus datos. En la BD
-- inflarían el respaldo: hoy se adjunta ~1 GB al año en Compras.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compras_solicitud_archivos (
  id               serial       PRIMARY KEY,
  solicitud_id     integer      NOT NULL REFERENCES public.compras_solicitudes(id) ON DELETE CASCADE,
  nombre_original  varchar(255) NOT NULL,
  -- Relativo a COMPRAS_ARCHIVOS_DIR; nunca el nombre que mandó el usuario
  ruta             varchar(255) NOT NULL UNIQUE,
  tipo_mime        varchar(120) NOT NULL,
  tamano_bytes     integer      NOT NULL,
  creado_en        timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compras_archivos_solicitud
  ON public.compras_solicitud_archivos (solicitud_id);

-- ---------------------------------------------------------------------------
-- Bitácora: quién hizo qué y cuándo
--
-- Es el "registro" que promete la propuesta y la base para medir cuánto tarda
-- cada área en aprobar. También guarda los intentos de envío a osTicket.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compras_solicitud_eventos (
  id            serial      PRIMARY KEY,
  solicitud_id  integer     NOT NULL REFERENCES public.compras_solicitudes(id) ON DELETE CASCADE,
  -- CREADA | APROBADA | RECHAZADA | CANCELADA | ENVIADA | ERROR_ENVIO
  tipo          varchar(20) NOT NULL,
  usuario_id    integer     REFERENCES public.usuarios(id),
  -- Si decidió el gerente o el suplente: el día que haya preguntas, se sabe
  -- quién estaba cubriendo.
  como          varchar(10),
  detalle       text,
  creado_en     timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compras_eventos_solicitud
  ON public.compras_solicitud_eventos (solicitud_id, creado_en);

-- ---------------------------------------------------------------------------
-- Catálogo: los 12 temas activos del departamento Compras en osticketadm.
--
-- SIN gerentes: los de la propuesta no son los reales (Alexis, 2026-10-02).
-- Se asignan desde la pantalla, empezando por TI como piloto.
-- ---------------------------------------------------------------------------
INSERT INTO public.compras_areas (nombre, osticket_topic_id) VALUES
  ('Mantenimiento',                      12),
  ('Ingeniería',                         13),
  ('Facilities',                         14),
  ('Inyección, Ensamble y Planeación',   15),
  ('Compuesto',                          16),
  ('Recursos Humanos',                   17),
  ('Sistemas (TI)',                      18),
  ('Dirección y Finanzas',               19),
  ('Almacén y Embarques',                20),
  ('Otros',                              21),
  ('Calidad',                            39),
  ('Moldes',                             40)
ON CONFLICT (osticket_topic_id) DO NOTHING;

-- Las áreas de DBX que tienen equivalente obvio. Las demás se asignan en la
-- pantalla; solo se llenan las que estén vacías para no pisar un ajuste a mano.
UPDATE public.areas a
   SET compras_area_id = ca.id
  FROM public.compras_areas ca
 WHERE a.compras_area_id IS NULL
   AND (   (a.nombre = 'TI'       AND ca.osticket_topic_id = 18)
        OR (a.nombre = 'Calidad'  AND ca.osticket_topic_id = 39)
        OR (a.nombre = 'Ensamble' AND ca.osticket_topic_id = 15));

-- ---------------------------------------------------------------------------
-- Módulos
--
-- Uno para pedir (y, si eres gerente o suplente, aprobar: la bandeja sale por
-- dato, no por permiso) y otro para configurar quién aprueba.
-- ---------------------------------------------------------------------------
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Solicitudes de Compra',
       'Pedir a Compras y aprobar las solicitudes de tu área',
       'ShoppingCart',
       '/compras/solicitudes',
       true,
       23
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/compras/solicitudes');

INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Aprobadores de Compras',
       'Gerente y suplente que aprueban las solicitudes de cada área',
       'UserCheck',
       '/compras/aprobadores',
       true,
       24
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/compras/aprobadores');

COMMIT;
