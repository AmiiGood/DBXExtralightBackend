-- ============================================================================
-- Compras — Etapa 2: las aprobadas se vuelven ticket en el osTicket de Compras
--
-- Va después de 2026-10-02_compras_solicitudes_01_schema.sql.
--
-- El ticket se crea por la API de osTicket (POST tickets.json con X-API-Key),
-- nunca escribiendo en su base: desde DBX esa base solo se lee.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ HAY CANDADO Y POR QUÉ SE BUSCA ANTES DE REINTENTAR
-- ---------------------------------------------------------------------------
-- El envío se dispara al aprobar y, si falla, lo reintenta un proceso cada
-- pocos minutos. Dos cosas pueden duplicar el ticket en Compras:
--
--   1. Que el disparo de la aprobación y el reintento programado agarren la
--      misma solicitud a la vez. Lo evita `enviando_desde`: quien lo pone
--      primero se queda con ella.
--   2. Que osTicket SÍ cree el ticket pero la respuesta no llegue (red, tiempo
--      de espera). Antes de cada reintento se busca en osTicket un ticket del
--      mismo tema, creado después de la aprobación, cuyo asunto termine con el
--      folio "[SC-000123]". Si existe, se toma ese y no se manda otro.
-- ============================================================================

BEGIN;

-- Quién tiene tomada la solicitud para enviarla. Un candado que se queda puesto
-- (el servidor se cayó a media llamada) se considera vencido a los 10 minutos.
ALTER TABLE public.compras_solicitudes
  ADD COLUMN IF NOT EXISTS enviando_desde timestamp;

-- La etapa 1 exigía el ticket_id para EN_COMPRAS. Lo que devuelve la API es el
-- NÚMERO (AD-005424); el id se busca después en osTicket y, si esa consulta
-- falla, no debe impedir que la solicitud quede en Compras.
ALTER TABLE public.compras_solicitudes
  DROP CONSTRAINT IF EXISTS compras_solicitudes_ticket_completo;
ALTER TABLE public.compras_solicitudes
  ADD CONSTRAINT compras_solicitudes_ticket_completo
    CHECK (estado <> 'EN_COMPRAS' OR osticket_numero IS NOT NULL);

-- El reintento programado solo mira las aprobadas que no han llegado
CREATE INDEX IF NOT EXISTS idx_compras_sol_por_enviar
  ON public.compras_solicitudes (decidido_en)
  WHERE estado = 'APROBADA';

COMMIT;
