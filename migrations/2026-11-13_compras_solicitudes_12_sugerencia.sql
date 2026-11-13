-- ============================================================================
-- SOLICITUDES DE COMPRA — Etapa 11: el solicitante sugiere, Compras decide
--
-- Flujo nuevo (Alexis, 13-nov-2026), fase 1 de 4 del flujo con firmas:
--   COTIZADA  → el solicitante da su SUGERENCIA TÉCNICA (una opción y por qué)
--               o pide otras opciones (como antes)
--   SUGERIDA  → Compras DECIDE (la sugerencia no obliga; si escoge otra opción
--               tiene que decir por qué). Compras también puede decidir sin
--               esperar la sugerencia; queda registrado.
--   DECIDIDA  → sigue la orden de compra (fase 3).
--
-- Decisiones:
--   - ELEGIDA se queda para las solicitudes viejas (las eligió el solicitante y
--     ya descontaron presupuesto). Las nuevas no pasan por ahí.
--   - Decidir NO descuenta presupuesto: se descuenta cuando la orden de compra
--     queda autorizada (fase 3). Lo decidido usa las mismas columnas que la
--     elección (opcion_elegida_id, monto_elegido, moneda_elegida, elegido_en,
--     elegido_por), ahora con quien decidió en Compras.
--   - La sugerencia se guarda aparte (opcion_sugerida_id, sugerencia).
--
-- Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.compras_solicitudes DROP CONSTRAINT IF EXISTS compras_solicitudes_estado_valido;
ALTER TABLE public.compras_solicitudes ADD CONSTRAINT compras_solicitudes_estado_valido
  CHECK (estado IN ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'CANCELADA', 'EN_COMPRAS', 'COTIZADA',
                    'ELEGIDA', 'SUGERIDA', 'DECIDIDA'));

ALTER TABLE public.compras_solicitudes DROP CONSTRAINT IF EXISTS compras_solicitudes_ticket_completo;
ALTER TABLE public.compras_solicitudes ADD CONSTRAINT compras_solicitudes_ticket_completo
  CHECK (estado NOT IN ('EN_COMPRAS', 'COTIZADA', 'ELEGIDA', 'SUGERIDA', 'DECIDIDA') OR osticket_numero IS NOT NULL);

-- La sugerencia técnica del solicitante
ALTER TABLE public.compras_solicitudes
  ADD COLUMN IF NOT EXISTS opcion_sugerida_id integer REFERENCES public.compras_cotizacion_opciones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sugerencia         text,
  ADD COLUMN IF NOT EXISTS sugerido_en        timestamp,
  -- Por qué decidió Compras (obligatorio si no es la sugerida)
  ADD COLUMN IF NOT EXISTS decision_nota      text;

DROP INDEX IF EXISTS public.idx_compras_sol_asignado;
CREATE INDEX IF NOT EXISTS idx_compras_sol_asignado
  ON public.compras_solicitudes (lower(asignado_email))
  WHERE estado IN ('EN_COMPRAS', 'COTIZADA', 'ELEGIDA', 'SUGERIDA', 'DECIDIDA');

-- Correos nuevos: SUGERIDA (a Compras) y DECIDIDA (a quien pidió)
ALTER TABLE public.compras_correos DROP CONSTRAINT IF EXISTS compras_correos_tipo_valido;
ALTER TABLE public.compras_correos ADD CONSTRAINT compras_correos_tipo_valido
  CHECK (tipo IN ('NUEVA', 'RECORDATORIO', 'RECHAZADA', 'APROBADA', 'EN_COMPRAS', 'PRUEBA',
                  'COTIZADA', 'ELEGIDA', 'OTRAS_OPCIONES', 'SOBREGIRO', 'SUGERIDA', 'DECIDIDA'));

COMMIT;
