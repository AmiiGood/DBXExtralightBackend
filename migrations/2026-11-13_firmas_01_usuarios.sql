-- ============================================================================
-- FIRMAS — cada persona registra su firma una vez y firma con un PIN
--
-- Fase 2 del flujo de Compras con firmas (Alexis, 13-nov-2026), pero la tabla
-- es del DBX, no de Compras: cualquier módulo que necesite firmas la usa.
--
-- Decisiones:
--   - La firma se DIBUJA una vez (en la tablet o con el mouse) desde "Mi firma"
--     y se guarda como PNG en la base (pesa unos KB).
--   - Para firmar algo se confirma con un PIN de 4 a 6 dígitos, aparte de la
--     contraseña (decisión de Alexis). Se guarda solo el hash (bcrypt).
--   - Registrar o cambiar la firma pide la CONTRASEÑA del DBX: así nadie
--     registra una firma con la sesión abierta de otro.
--   - Cambiar la firma no borra la anterior: se desactiva, porque lo que ya se
--     firmó apunta a la firma con la que se firmó.
--   - 5 PIN equivocados seguidos bloquean la firma 15 minutos.
--   - El admin puede quitar una firma (por ejemplo, si olvidaron el PIN); la
--     persona la vuelve a registrar.
--
-- Idempotente.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.usuarios_firmas (
  id                 serial       PRIMARY KEY,
  usuario_id         integer      NOT NULL REFERENCES public.usuarios(id),
  imagen             bytea        NOT NULL,
  pin_hash           varchar(100) NOT NULL,
  activa             boolean      NOT NULL DEFAULT true,
  intentos_fallidos  integer      NOT NULL DEFAULT 0,
  bloqueada_hasta    timestamp,
  creada_en          timestamp    NOT NULL DEFAULT now(),
  desactivada_en     timestamp,
  -- Quién la quitó: la misma persona al cambiarla, o el admin
  desactivada_por    integer      REFERENCES public.usuarios(id)
);

-- Una sola firma activa por persona
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_firmas_activa
  ON public.usuarios_firmas (usuario_id) WHERE activa;

COMMENT ON TABLE public.usuarios_firmas IS
  'Firma dibujada de cada usuario (PNG) y el hash de su PIN para firmar. Las cambiadas quedan inactivas.';

COMMIT;
