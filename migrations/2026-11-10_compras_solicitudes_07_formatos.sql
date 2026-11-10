-- ============================================================================
-- SOLICITUDES DE COMPRA — Etapa 6: captura del formato en papel
--
-- Mientras el flujo con firmas no esté en el sistema, cada compra se autoriza
-- con el "Formato de autorización y registro de compras" en papel. Aquí se
-- captura cada formato para tener reportes desde ya.
--
-- Flujo nuevo (propuesta del 10-nov-2026): solicita → gerente o suplente
-- autoriza → Compras autoriza y cotiza → quien pidió sugiere → Compras escoge,
-- le pone área y tipo → Dirección (Celina o Stefano) autoriza → Finanzas
-- autoriza y pone cuenta y centro de costos.
--
-- Decisiones:
--   - Quien firmó se guarda como TEXTO (el nombre escrito en el formato): no
--     todos los que firman tienen usuario en el DBX.
--   - Tipo, cuenta y centro de costos son texto libre mientras Compras y
--     Finanzas mandan sus listas; la pantalla sugiere lo ya capturado.
--   - Un formato se puede capturar a medias (falta una firma) y completar
--     después. Está completo cuando tiene las cuatro autorizaciones.
--   - Un formato por ticket.
--
-- Idempotente.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.compras_formatos (
  id                   serial         PRIMARY KEY,
  -- Número de ticket de osTicket tal como viene en el formato (p. ej. "AD-123456")
  ticket               varchar(32),
  fecha                date           NOT NULL,
  -- Área solicitante (las áreas de Compras, una por tema de osticketadm)
  compras_area_id      integer        NOT NULL REFERENCES public.compras_areas(id),
  requerimiento        text           NOT NULL,
  monto                numeric(14,2)  CHECK (monto IS NULL OR monto >= 0),
  moneda               char(3)        NOT NULL DEFAULT 'MXN' CHECK (moneda IN ('MXN', 'USD')),

  -- Autorización del gerente de área (o su suplente)
  autorizo_gerente     varchar(120),
  -- Clasificación (tipo) y autorización de Compras. El área de la compra es la
  -- del solicitante (decisión de Alexis, 10-nov-2026): no se captura otra vez
  clasif_tipo          varchar(120),
  autorizo_compras     varchar(120),
  -- Clasificación y autorización de Finanzas
  cuenta               varchar(60),
  centro_costos        varchar(60),
  autorizo_finanzas    varchar(120),
  -- Autorización de Dirección / Gerencia de Operaciones
  autorizo_direccion   varchar(120),

  observaciones        text,

  capturado_por        integer        REFERENCES public.usuarios(id),
  capturado_en         timestamp      NOT NULL DEFAULT now(),
  actualizado_por      integer        REFERENCES public.usuarios(id),
  actualizado_en       timestamp      NOT NULL DEFAULT now()
);

-- Un formato por ticket (sin importar mayúsculas ni espacios)
CREATE UNIQUE INDEX IF NOT EXISTS uq_compras_formatos_ticket
  ON public.compras_formatos (upper(btrim(ticket)))
  WHERE ticket IS NOT NULL AND btrim(ticket) <> '';

CREATE INDEX IF NOT EXISTS idx_compras_formatos_fecha ON public.compras_formatos (fecha);
CREATE INDEX IF NOT EXISTS idx_compras_formatos_area  ON public.compras_formatos (compras_area_id, fecha);

-- ---------------------------------------------------------------------------
-- Módulo
--   leer     = ver el reporte y exportarlo
--   crear    = capturar formatos
--   editar   = corregir cualquier formato (quien capturó corrige los suyos con crear)
--   eliminar = borrar formatos
-- ---------------------------------------------------------------------------
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Formatos de Compras',
       'Captura del formato de autorización y registro de compras en papel y su reporte',
       'ClipboardPenLine',
       '/compras/formatos',
       true,
       28
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/compras/formatos');

COMMIT;
