-- ============================================================================
-- SOLICITUDES DE COMPRA — Etapa 15: órdenes en lote con renglones por proveedor
--
-- Decisión de Alexis (20-nov-2026), viendo cómo cotiza Compras de verdad:
--   - Una cotización cubre VARIOS tickets (p. ej. 5 tickets, 10 partidas) y un
--     mismo ticket puede tener VARIOS proveedores ganadores (las computadoras de
--     uno, los escáneres de otro).
--   - El agente de Compras registra la cotización ganadora de varios tickets a
--     la vez: escoge los tickets, sube la cotización y el comparativo una sola
--     vez y PEGA DESDE EXCEL la tabla de ganadores (ticket, cantidad,
--     descripción, proveedor, precio unitario, motivo).
--   - Por dentro se crea UNA ORDEN POR TICKET con sus renglones: cada ticket
--     descuenta de su área, entra a Formatos por su monto y se puede rechazar
--     sin tumbar a los demás. El monto de la orden es la suma de sus renglones
--     (sin IVA). Si hay varios proveedores, la orden dice "Varios: …".
--   - Quien firma puede firmar varias órdenes juntas con un solo PIN (si van en
--     el mismo paso). Compras y Finanzas ponen el mismo tipo / cuenta y CC a
--     todas las que firman juntas.
--
-- Idempotente.
-- ============================================================================

BEGIN;

-- El registro en lote: agrupa las órdenes que salieron de la misma cotización
CREATE TABLE IF NOT EXISTS public.compras_orden_envios (
  id          serial      PRIMARY KEY,
  moneda      varchar(3)  NOT NULL DEFAULT 'MXN' CHECK (moneda IN ('MXN', 'USD')),
  comentario  text,
  creado_por  integer     NOT NULL REFERENCES public.usuarios(id),
  creado_en   timestamp   NOT NULL DEFAULT now()
);

ALTER TABLE public.compras_ordenes
  ADD COLUMN IF NOT EXISTS envio_id integer REFERENCES public.compras_orden_envios(id);
CREATE INDEX IF NOT EXISTS idx_compras_ordenes_envio ON public.compras_ordenes (envio_id);

-- Los renglones de la orden: lo que se compra, a quién y a qué precio (sin IVA)
CREATE TABLE IF NOT EXISTS public.compras_orden_lineas (
  id               serial        PRIMARY KEY,
  orden_id         integer       NOT NULL REFERENCES public.compras_ordenes(id) ON DELETE CASCADE,
  orden            smallint      NOT NULL DEFAULT 0,
  cantidad         numeric(12,3) NOT NULL CHECK (cantidad > 0),
  unidad           varchar(20),
  descripcion      text          NOT NULL,
  proveedor        varchar(200)  NOT NULL,
  precio_unitario  numeric(14,4) NOT NULL CHECK (precio_unitario >= 0),
  importe          numeric(14,2) NOT NULL CHECK (importe >= 0),
  motivo           text
);
CREATE INDEX IF NOT EXISTS idx_compras_orden_lineas_orden ON public.compras_orden_lineas (orden_id);

COMMIT;
