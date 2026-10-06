-- ============================================================================
-- Compras — Etapa 3: avisos por correo, recordatorios y reporte de tiempos
--
-- Va después de 2026-10-02_compras_solicitudes_02_envio_osticket.sql.
--
-- Correos que salen (todos a usuarios.email, por correo.service.js):
--
--   NUEVA         al gerente y al suplente, en cuanto llega una solicitud
--   RECORDATORIO  resumen a cada aprobador con pendientes, en las horas y días
--                 configurados (L–V 9:00 y 16:00 por omisión). UNO por persona
--                 aunque apruebe varias áreas: Daniel Mendez aprueba tres y
--                 recibe todo junto, como pide la propuesta. Sin pendientes no
--                 se manda nada.
--   RECHAZADA     a quien pidió, con el motivo
--   EN_COMPRAS    a quien pidió, con el número de ticket de Compras
--   APROBADA      a quien pidió, SOLO si no hay conexión con osTicket (si la
--                 hay, el aviso útil es el de EN_COMPRAS, que trae el número)
--
-- La configuración vive en la base y se edita en "Aprobadores de Compras": la
-- propuesta dice que las horas se pueden ajustar, y eso no debe pedir desplegar.
-- ============================================================================

BEGIN;

-- Una sola fila
CREATE TABLE IF NOT EXISTS public.compras_config (
  id                  smallint   PRIMARY KEY DEFAULT 1,
  -- Apaga todos los correos del módulo (no las solicitudes)
  avisos_activos      boolean    NOT NULL DEFAULT true,
  -- El aviso al aprobador en cuanto llega cada solicitud
  aviso_inmediato     boolean    NOT NULL DEFAULT true,
  -- 'HH:MM' en hora de planta
  recordatorio_horas  text[]     NOT NULL DEFAULT '{09:00,16:00}',
  -- 0 = domingo … 6 = sábado
  recordatorio_dias   smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',
  actualizado_en      timestamp  NOT NULL DEFAULT now(),
  actualizado_por     integer    REFERENCES public.usuarios(id),

  CONSTRAINT compras_config_una_fila CHECK (id = 1)
);

INSERT INTO public.compras_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Bitácora de correos: para responder "no me llegó" sin adivinar
CREATE TABLE IF NOT EXISTS public.compras_correos (
  id            serial      PRIMARY KEY,
  tipo          varchar(15) NOT NULL,
  solicitud_id  integer     REFERENCES public.compras_solicitudes(id) ON DELETE SET NULL,
  usuario_id    integer     REFERENCES public.usuarios(id),
  para          text        NOT NULL,
  asunto        text        NOT NULL,
  ok            boolean     NOT NULL,
  error         text,
  -- smtp / ethereal: con Ethereal o Mailpit el correo no llega a buzones reales
  modo          varchar(80),
  enviado_en    timestamp   NOT NULL DEFAULT now(),

  CONSTRAINT compras_correos_tipo_valido
    CHECK (tipo IN ('NUEVA', 'RECORDATORIO', 'RECHAZADA', 'APROBADA', 'EN_COMPRAS', 'PRUEBA'))
);

CREATE INDEX IF NOT EXISTS idx_compras_correos_enviado
  ON public.compras_correos (enviado_en DESC);

-- ---------------------------------------------------------------------------
-- Módulo del reporte
-- ---------------------------------------------------------------------------
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Reportes de Compras',
       'Cuánto tarda cada área en aprobar y cuántas solicitudes se rechazan',
       'Timer',
       '/compras/reportes',
       true,
       25
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/compras/reportes');

COMMIT;
