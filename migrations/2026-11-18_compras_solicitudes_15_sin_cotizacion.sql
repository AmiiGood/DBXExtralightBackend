-- ============================================================================
-- SOLICITUDES DE COMPRA — Etapa 14: la cotización sale del DBX
--
-- Decisión de Alexis (18-nov-2026): cada agente de Compras cotiza a su manera
-- (osTicket, correo, Copilot) y hacerlo todo en el sistema no era eficiente ni
-- escalable. El flujo queda:
--
--   1. Quien pide la solicitud → el gerente la aprueba → se crea el ticket (EN_COMPRAS)
--   2. Compras cotiza FUERA del DBX
--   3. El agente de Compras del ticket da de alta la ORDEN DE COMPRA: proveedor,
--      monto SIN IVA, moneda y el archivo de la cotización (obligatorio) → EN_FIRMAS
--   4. Firman gerente → Compras (tipo) → Finanzas (cuenta y CC) → Dirección → AUTORIZADA
--
-- Reglas nuevas:
--   - Todos los montos son sin IVA (incluye_iva queda siempre en false).
--   - Quien pidió NO ve proveedor, montos ni el presupuesto del área: solo en
--     qué firma va su orden. El gerente sí los ve.
--   - Dar de alta la orden pide "crear" en el módulo Órdenes de compra (los
--     agentes, para sus tickets); "editar" ve todas y da de alta cualquiera
--     (el jefe de Compras).
--   - Las solicitudes que estaban a medio cotizar en el DBX (COTIZADA, SUGERIDA,
--     DECIDIDA) regresan a EN_COMPRAS para que Compras dé de alta su orden. Su
--     cotización se descarta pero no se borra. Las ELEGIDA (antes del 13-nov)
--     se quedan como están.
--   - El módulo Cotizaciones de Compras se desactiva (sale del menú).
--
-- Idempotente.
-- ============================================================================

BEGIN;

-- Sin IVA: ya no se pregunta
ALTER TABLE public.compras_ordenes ALTER COLUMN incluye_iva SET DEFAULT false;

-- La cotización del proveedor (y lo que Compras quiera adjuntar), obligatoria al dar de alta
CREATE TABLE IF NOT EXISTS public.compras_orden_archivos (
  id               serial       PRIMARY KEY,
  orden_id         integer      NOT NULL REFERENCES public.compras_ordenes(id) ON DELETE CASCADE,
  nombre_original  varchar(255) NOT NULL,
  ruta             varchar(500) NOT NULL,
  tipo_mime        varchar(120) NOT NULL,
  tamano_bytes     integer      NOT NULL,
  subido_por       integer      REFERENCES public.usuarios(id),
  subido_en        timestamp    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_compras_orden_archivos_orden ON public.compras_orden_archivos (orden_id);

-- Lo que estaba a medio cotizar regresa a Compras
WITH movidas AS (
  UPDATE public.compras_solicitudes
     SET estado = 'EN_COMPRAS'
   WHERE estado IN ('COTIZADA', 'SUGERIDA', 'DECIDIDA')
  RETURNING id
)
INSERT INTO public.compras_solicitud_eventos (solicitud_id, tipo, detalle)
SELECT id, 'SIN_COTIZACION', 'La cotización salió del DBX: Compras da de alta la orden de compra con su cotización'
  FROM movidas;

UPDATE public.compras_cotizaciones c
   SET estado = 'DESCARTADA', descartada_en = now(),
       motivo_descarte = 'La cotización salió del DBX (18-nov-2026)'
  FROM public.compras_solicitudes s
 WHERE s.id = c.solicitud_id AND s.estado = 'EN_COMPRAS' AND c.estado IN ('BORRADOR', 'ENVIADA');

-- El módulo de cotizaciones sale del menú
UPDATE public.modulos SET activo = false WHERE ruta = '/compras/cotizaciones';

UPDATE public.modulos
   SET descripcion = 'Dar de alta las órdenes de compra con su cotización (Compras), firmarlas (gerente, Compras, Finanzas y Dirección) y su seguimiento'
 WHERE ruta = '/compras/ordenes';

COMMIT;
