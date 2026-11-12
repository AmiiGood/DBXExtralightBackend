-- ============================================================================
-- SOLICITUDES DE COMPRA — Etapa 9: áreas solicitantes sin tema de osTicket
--
-- Desde el 12-nov-2026 en Formatos se captura TODA compra, tenga o no ticket.
-- Hay áreas que compran sin pasar por el osTicket de Compras, así que un área
-- ya no necesita tema.
--
-- Decisiones:
--   - osticket_topic_id deja de ser obligatorio (sigue siendo único entre las
--     que lo tienen).
--   - Un área sin tema sirve para Formatos, Presupuestos y el Tablero, pero no
--     para Solicitudes: sin tema el ticket no tendría a qué cola llegar. Por eso
--     Aprobadores no las ofrece para ligar áreas del DBX (lo cuida el backend).
--   - Las áreas sin tema se agregan, renombran y desactivan desde Formatos →
--     Listas. Las ligadas a osTicket no se tocan desde ahí.
--
-- Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.compras_areas ALTER COLUMN osticket_topic_id DROP NOT NULL;

COMMENT ON COLUMN public.compras_areas.osticket_topic_id IS
  'Tema (ost_help_topic) en la base osticketadm. Decide a qué cola de Compras llega el ticket. NULL = área que solo se usa en Formatos, Presupuestos y Tablero.';

-- Para que "Mantenimiento" y "mantenimiento " no sean dos áreas
CREATE UNIQUE INDEX IF NOT EXISTS uq_compras_areas_nombre_ci ON public.compras_areas (lower(btrim(nombre)));

COMMIT;
