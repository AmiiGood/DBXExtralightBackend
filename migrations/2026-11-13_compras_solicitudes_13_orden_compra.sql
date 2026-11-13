-- ============================================================================
-- SOLICITUDES DE COMPRA — Etapa 12: la orden de compra con cuatro firmas
--
-- Fase 3 de 4 del flujo con firmas (Alexis, 13-nov-2026). Después de que
-- Compras decide la opción (DECIDIDA):
--
--   1. Quien pidió envía la orden de compra                 → EN_FIRMAS
--   2. Firma el gerente del área o su suplente
--   3. Firma Compras (solo el jefe) y pone el TIPO
--   4. Firma Finanzas y pone la CUENTA y el CENTRO DE COSTOS
--   5. Firma Dirección (Celina o Stefano), la última         → AUTORIZADA
--
-- Reglas:
--   - Firmar = la firma registrada del usuario + su PIN (usuarios_firmas). Cada
--     firma guarda el id de la firma con la que se firmó.
--   - Cualquier rechazo (con motivo) termina la orden y la solicitud
--     (NO_AUTORIZADA). No regresa a nadie.
--   - Si quien pidió es el gerente del área, su firma va al enviar (como PROPIA).
--   - Nadie firma Compras, Finanzas ni Dirección en su propia orden.
--   - Dirección no firma si el monto (sin IVA, en pesos) queda abajo de
--     compras_config.oc_monto_minimo_direccion. En 0 firma siempre.
--   - El presupuesto se descuenta al quedar AUTORIZADA (con la firma de
--     Dirección, o la de Finanzas si Dirección no hace falta), con el FIX más
--     reciente, en el mes de la autorización. Presupuestos cuenta ELEGIDA (las
--     viejas) y AUTORIZADA.
--   - Quiénes firman por Compras, Finanzas y Dirección se configura en
--     Aprobadores (compras_firmantes). El gerente sale de compras_areas.
--
-- Idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Estados nuevos de la solicitud ('NO_AUTORIZADA' no cabe en 12)
-- ---------------------------------------------------------------------------
ALTER TABLE public.compras_solicitudes ALTER COLUMN estado TYPE varchar(20);

ALTER TABLE public.compras_solicitudes DROP CONSTRAINT IF EXISTS compras_solicitudes_estado_valido;
ALTER TABLE public.compras_solicitudes ADD CONSTRAINT compras_solicitudes_estado_valido
  CHECK (estado IN ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'CANCELADA', 'EN_COMPRAS', 'COTIZADA',
                    'ELEGIDA', 'SUGERIDA', 'DECIDIDA', 'EN_FIRMAS', 'AUTORIZADA', 'NO_AUTORIZADA'));

ALTER TABLE public.compras_solicitudes DROP CONSTRAINT IF EXISTS compras_solicitudes_ticket_completo;
ALTER TABLE public.compras_solicitudes ADD CONSTRAINT compras_solicitudes_ticket_completo
  CHECK (estado NOT IN ('EN_COMPRAS', 'COTIZADA', 'ELEGIDA', 'SUGERIDA', 'DECIDIDA',
                        'EN_FIRMAS', 'AUTORIZADA', 'NO_AUTORIZADA') OR osticket_numero IS NOT NULL);

DROP INDEX IF EXISTS public.idx_compras_sol_asignado;
CREATE INDEX IF NOT EXISTS idx_compras_sol_asignado
  ON public.compras_solicitudes (lower(asignado_email))
  WHERE estado IN ('EN_COMPRAS', 'COTIZADA', 'ELEGIDA', 'SUGERIDA', 'DECIDIDA', 'EN_FIRMAS', 'AUTORIZADA');

-- ---------------------------------------------------------------------------
-- Monto mínimo para que firme Dirección (sin IVA, en pesos). 0 = siempre firma
-- ---------------------------------------------------------------------------
ALTER TABLE public.compras_config
  ADD COLUMN IF NOT EXISTS oc_monto_minimo_direccion numeric(14,2) NOT NULL DEFAULT 0
    CHECK (oc_monto_minimo_direccion >= 0);

-- ---------------------------------------------------------------------------
-- Quiénes firman por Compras (el jefe), Finanzas y Dirección
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compras_firmantes (
  papel        varchar(12) NOT NULL CHECK (papel IN ('COMPRAS', 'FINANZAS', 'DIRECCION')),
  usuario_id   integer     NOT NULL REFERENCES public.usuarios(id),
  agregado_por integer     REFERENCES public.usuarios(id),
  agregado_en  timestamp   NOT NULL DEFAULT now(),
  PRIMARY KEY (papel, usuario_id)
);

-- ---------------------------------------------------------------------------
-- La orden de compra: una por solicitud
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compras_ordenes (
  id                     serial        PRIMARY KEY,
  solicitud_id           integer       NOT NULL UNIQUE REFERENCES public.compras_solicitudes(id),
  estado                 varchar(12)   NOT NULL DEFAULT 'EN_FIRMAS'
                                       CHECK (estado IN ('EN_FIRMAS', 'AUTORIZADA', 'RECHAZADA')),
  -- A quién le toca firmar; null cuando ya terminó (autorizada o rechazada)
  paso                   varchar(12)   CHECK (paso IN ('GERENTE', 'COMPRAS', 'FINANZAS', 'DIRECCION')),

  -- Lo que se va a comprar, tal como quedó al enviarla
  opcion_id              integer       REFERENCES public.compras_cotizacion_opciones(id) ON DELETE SET NULL,
  proveedor              varchar(200)  NOT NULL,
  monto                  numeric(14,2) NOT NULL CHECK (monto >= 0),
  moneda                 varchar(3)    NOT NULL CHECK (moneda IN ('MXN', 'USD')),
  incluye_iva            boolean       NOT NULL,
  comentario             text,

  -- Lo que pone Compras (tipo) y Finanzas (cuenta y centro de costos)
  clasif_tipo            varchar(120),
  cuenta                 varchar(60),
  centro_costos          varchar(60),

  -- Se decide al firmar Finanzas: ¿hace falta Dirección?
  requiere_direccion     boolean,
  monto_minimo_direccion numeric(14,2),
  monto_mxn_sin_iva      numeric(14,2),

  enviada_por            integer       NOT NULL REFERENCES public.usuarios(id),
  enviada_en             timestamp     NOT NULL DEFAULT now(),
  terminada_en           timestamp,
  rechazada_por          integer       REFERENCES public.usuarios(id),
  rechazada_paso         varchar(12),
  motivo_rechazo         text,

  CONSTRAINT compras_ordenes_paso_coherente
    CHECK ((estado = 'EN_FIRMAS') = (paso IS NOT NULL)),
  CONSTRAINT compras_ordenes_rechazo_con_motivo
    CHECK (estado <> 'RECHAZADA' OR length(btrim(coalesce(motivo_rechazo, ''))) > 0)
);

CREATE INDEX IF NOT EXISTS idx_compras_ordenes_paso ON public.compras_ordenes (paso) WHERE estado = 'EN_FIRMAS';

-- Las firmas: una por paso
CREATE TABLE IF NOT EXISTS public.compras_orden_firmas (
  id          serial      PRIMARY KEY,
  orden_id    integer     NOT NULL REFERENCES public.compras_ordenes(id) ON DELETE CASCADE,
  paso        varchar(12) NOT NULL CHECK (paso IN ('GERENTE', 'COMPRAS', 'FINANZAS', 'DIRECCION')),
  usuario_id  integer     NOT NULL REFERENCES public.usuarios(id),
  -- La firma con la que se firmó (aunque después la cambie, esta se queda)
  firma_id    integer     NOT NULL REFERENCES public.usuarios_firmas(id),
  -- GERENTE, SUPLENTE o PROPIA (el gerente la pidió); en los demás, el papel
  como        varchar(12) NOT NULL,
  comentario  text,
  firmado_en  timestamp   NOT NULL DEFAULT now(),
  UNIQUE (orden_id, paso)
);

CREATE INDEX IF NOT EXISTS idx_compras_orden_firmas_usuario ON public.compras_orden_firmas (usuario_id);

-- ---------------------------------------------------------------------------
-- Correos nuevos
-- ---------------------------------------------------------------------------
ALTER TABLE public.compras_correos DROP CONSTRAINT IF EXISTS compras_correos_tipo_valido;
ALTER TABLE public.compras_correos ADD CONSTRAINT compras_correos_tipo_valido
  CHECK (tipo IN ('NUEVA', 'RECORDATORIO', 'RECHAZADA', 'APROBADA', 'EN_COMPRAS', 'PRUEBA',
                  'COTIZADA', 'ELEGIDA', 'OTRAS_OPCIONES', 'SOBREGIRO', 'SUGERIDA', 'DECIDIDA',
                  'OC_POR_FIRMAR', 'OC_AUTORIZADA', 'OC_RECHAZADA'));

-- ---------------------------------------------------------------------------
-- Módulo
--   Firmar NO depende del módulo: le toca a quien es gerente del área o está en
--   la lista de firmantes (le llega el correo y sale en Inicio). El módulo pone
--   la entrada en el menú; con editar se ven todas las órdenes.
-- ---------------------------------------------------------------------------
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Órdenes de compra',
       'Firmar las órdenes de compra (gerente, Compras, Finanzas y Dirección) y su seguimiento',
       'FileSignature',
       '/compras/ordenes',
       true,
       27
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/compras/ordenes');

COMMIT;
