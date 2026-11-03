-- ============================================================================
-- SOLICITUDES DE COMPRA — Etapa 4: cotizaciones por el DBX
--
-- Hoy, cuando una solicitud ya es ticket, el agente de Compras busca
-- proveedores y manda el comparativo por correo (una tabla con precio, total,
-- entrega y crédito de cada proveedor, ver el ticket AD-005426); el solicitante
-- contesta cuál quiere. Ahora eso pasa en el DBX:
--
--   EN_COMPRAS  el ticket existe; lo ve el agente que lo tiene ASIGNADO en
--               osTicket (se lee de osticketadm, así una reasignación se
--               refleja sola)
--   COTIZADA    el agente mandó las opciones; espera a que el solicitante elija
--   ELEGIDA     el solicitante eligió una; queda registrado el monto
--
-- Si ninguna opción le sirve, el solicitante pide otras: la cotización enviada
-- queda DESCARTADA (con su motivo) y la solicitud regresa a EN_COMPRAS.
--
-- Permisos del módulo "Cotizaciones de Compras" (/compras/cotizaciones):
--   puede_leer    ver los tickets que el usuario tiene asignados en osTicket
--                 (se cruza por correo: el del DBX con el del agente)
--   puede_crear   capturar y mandar opciones
--   puede_editar  ver y cotizar TODOS (el jefe de Compras)
--
-- También acomoda los temas nuevos de osticketadm (21-oct-2026).
--
-- Idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Temas de osticketadm
--
--    El 21 de octubre se crearon 41, 42, 43 y 44. El 15 juntaba Inyección,
--    Ensamble y Planeación; queda solo para Planeación (decisión de Alexis,
--    2-nov-2026) y las áreas del DBX que cargaban ahí se pasan a su tema
--    nuevo. Las que no se reconocen se quedan en el 15: revisar en
--    "Aprobadores de Compras". Los gerentes de las áreas nuevas se asignan ahí.
-- ---------------------------------------------------------------------------
UPDATE public.compras_areas SET nombre = 'Planeación', actualizado_en = now()
 WHERE osticket_topic_id = 15 AND nombre <> 'Planeación';

INSERT INTO public.compras_areas (nombre, osticket_topic_id) VALUES
  ('Inyección Suela y Almacén', 41),
  ('Inyección Crocs',           42),
  ('Producción Ensamble',       43),
  ('HSE',                       44)
ON CONFLICT (osticket_topic_id) DO NOTHING;

UPDATE public.areas a
   SET compras_area_id = ca.id
  FROM public.compras_areas ca,
       public.compras_areas viejo
 WHERE viejo.osticket_topic_id = 15
   AND a.compras_area_id = viejo.id
   AND ca.osticket_topic_id = CASE
         WHEN translate(lower(a.nombre), 'áéíóú', 'aeiou') LIKE '%crocs%'  THEN 42
         WHEN translate(lower(a.nombre), 'áéíóú', 'aeiou') LIKE '%suela%'  THEN 41
         WHEN translate(lower(a.nombre), 'áéíóú', 'aeiou') LIKE '%ensamble%' THEN 43
         WHEN translate(lower(a.nombre), 'áéíóú', 'aeiou') ~ '(^|\W)hse(\W|$)' THEN 44
       END;

-- ---------------------------------------------------------------------------
-- 2. Estados nuevos y lo que se registra al elegir
-- ---------------------------------------------------------------------------
ALTER TABLE public.compras_solicitudes DROP CONSTRAINT IF EXISTS compras_solicitudes_estado_valido;
ALTER TABLE public.compras_solicitudes ADD CONSTRAINT compras_solicitudes_estado_valido
  CHECK (estado IN ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'CANCELADA', 'EN_COMPRAS', 'COTIZADA', 'ELEGIDA'));

ALTER TABLE public.compras_solicitudes DROP CONSTRAINT IF EXISTS compras_solicitudes_ticket_completo;
ALTER TABLE public.compras_solicitudes ADD CONSTRAINT compras_solicitudes_ticket_completo
  CHECK (estado NOT IN ('EN_COMPRAS', 'COTIZADA', 'ELEGIDA') OR osticket_numero IS NOT NULL);

-- Quién tiene el ticket en osTicket, tal como se leyó la última vez
ALTER TABLE public.compras_solicitudes
  ADD COLUMN IF NOT EXISTS asignado_staff_id   integer,
  ADD COLUMN IF NOT EXISTS asignado_nombre     varchar(120),
  ADD COLUMN IF NOT EXISTS asignado_email      varchar(160),
  ADD COLUMN IF NOT EXISTS osticket_estado     varchar(20),
  ADD COLUMN IF NOT EXISTS asignado_leido_en   timestamp,
  ADD COLUMN IF NOT EXISTS opcion_elegida_id   integer,
  ADD COLUMN IF NOT EXISTS monto_elegido       numeric(14,2),
  ADD COLUMN IF NOT EXISTS moneda_elegida      varchar(3),
  ADD COLUMN IF NOT EXISTS elegido_en          timestamp,
  ADD COLUMN IF NOT EXISTS elegido_por         integer REFERENCES public.usuarios(id);

CREATE INDEX IF NOT EXISTS idx_compras_sol_asignado
  ON public.compras_solicitudes (lower(asignado_email))
  WHERE estado IN ('EN_COMPRAS', 'COTIZADA', 'ELEGIDA');

-- ---------------------------------------------------------------------------
-- 3. Cotizaciones
--
--    Una solicitud tiene a lo más un BORRADOR (lo que el agente va armando) y
--    una ENVIADA vigente. Si el solicitante pide otras opciones, la enviada
--    pasa a DESCARTADA y se arma otra.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compras_cotizaciones (
  id                 serial       PRIMARY KEY,
  solicitud_id       integer      NOT NULL REFERENCES public.compras_solicitudes(id) ON DELETE CASCADE,
  estado             varchar(10)  NOT NULL DEFAULT 'BORRADOR',
  mensaje            text,
  -- Los precios incluyen IVA o no; el comparativo de hoy va sin IVA
  incluye_iva        boolean      NOT NULL DEFAULT false,
  creada_por         integer      REFERENCES public.usuarios(id),
  creada_en          timestamp    NOT NULL DEFAULT now(),
  actualizada_en     timestamp    NOT NULL DEFAULT now(),
  enviada_por        integer      REFERENCES public.usuarios(id),
  enviada_en         timestamp,
  descartada_en      timestamp,
  motivo_descarte    text,
  CONSTRAINT compras_cotizaciones_estado_valido CHECK (estado IN ('BORRADOR', 'ENVIADA', 'DESCARTADA'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_compras_cotizacion_borrador
  ON public.compras_cotizaciones (solicitud_id) WHERE estado = 'BORRADOR';
CREATE UNIQUE INDEX IF NOT EXISTS uq_compras_cotizacion_enviada
  ON public.compras_cotizaciones (solicitud_id) WHERE estado = 'ENVIADA';

-- Archivos de la cotización: la foto de lo que ofrece cada proveedor y el PDF
-- de su cotización. Van a la misma carpeta que los adjuntos de la solicitud.
CREATE TABLE IF NOT EXISTS public.compras_cotizacion_archivos (
  id               serial       PRIMARY KEY,
  cotizacion_id    integer      NOT NULL REFERENCES public.compras_cotizaciones(id) ON DELETE CASCADE,
  nombre_original  varchar(255) NOT NULL,
  ruta             varchar(255) NOT NULL UNIQUE,
  tipo_mime        varchar(120) NOT NULL,
  tamano_bytes     integer      NOT NULL,
  creado_en        timestamp    NOT NULL DEFAULT now()
);

-- Lo que se pide: descripción, cantidad y unidad. La cantidad puede faltar
-- mientras es borrador; para enviar se exige.
CREATE TABLE IF NOT EXISTS public.compras_cotizacion_partidas (
  id             serial         PRIMARY KEY,
  cotizacion_id  integer        NOT NULL REFERENCES public.compras_cotizaciones(id) ON DELETE CASCADE,
  orden          smallint       NOT NULL DEFAULT 0,
  descripcion    varchar(300)   NOT NULL,
  cantidad       numeric(12,3)  CHECK (cantidad IS NULL OR cantidad > 0),
  unidad         varchar(20)    NOT NULL DEFAULT 'PZS'
);

-- Cada proveedor que se cotizó
CREATE TABLE IF NOT EXISTS public.compras_cotizacion_opciones (
  id              serial        PRIMARY KEY,
  cotizacion_id   integer       NOT NULL REFERENCES public.compras_cotizaciones(id) ON DELETE CASCADE,
  orden           smallint      NOT NULL DEFAULT 0,
  proveedor       varchar(160)  NOT NULL,
  moneda          varchar(3)    NOT NULL DEFAULT 'MXN' CHECK (moneda IN ('MXN', 'USD')),
  tiempo_entrega  varchar(80),
  credito         varchar(80),
  observaciones   text,
  archivo_id      integer       REFERENCES public.compras_cotizacion_archivos(id) ON DELETE SET NULL
);

-- El precio de cada proveedor por partida. Sin renglón (o precio nulo) = ese
-- proveedor no cotizó esa partida.
CREATE TABLE IF NOT EXISTS public.compras_cotizacion_precios (
  opcion_id        integer        NOT NULL REFERENCES public.compras_cotizacion_opciones(id) ON DELETE CASCADE,
  partida_id       integer        NOT NULL REFERENCES public.compras_cotizacion_partidas(id) ON DELETE CASCADE,
  precio_unitario  numeric(14,4)  CHECK (precio_unitario IS NULL OR precio_unitario >= 0),
  descripcion      text,
  imagen_id        integer        REFERENCES public.compras_cotizacion_archivos(id) ON DELETE SET NULL,
  PRIMARY KEY (opcion_id, partida_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compras_solicitudes_opcion_elegida_fk') THEN
    ALTER TABLE public.compras_solicitudes
      ADD CONSTRAINT compras_solicitudes_opcion_elegida_fk
      FOREIGN KEY (opcion_elegida_id) REFERENCES public.compras_cotizacion_opciones(id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Correos nuevos
-- ---------------------------------------------------------------------------
ALTER TABLE public.compras_correos DROP CONSTRAINT IF EXISTS compras_correos_tipo_valido;
ALTER TABLE public.compras_correos ADD CONSTRAINT compras_correos_tipo_valido
  CHECK (tipo IN ('NUEVA', 'RECORDATORIO', 'RECHAZADA', 'APROBADA', 'EN_COMPRAS', 'PRUEBA',
                  'COTIZADA', 'ELEGIDA', 'OTRAS_OPCIONES'));

-- ---------------------------------------------------------------------------
-- 5. Módulo
-- ---------------------------------------------------------------------------
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Cotizaciones de Compras',
       'Las solicitudes que tienes asignadas en Compras: captura las opciones de proveedores y mándalas a quien pidió',
       'Scale',
       '/compras/cotizaciones',
       true,
       26
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/compras/cotizaciones');

COMMIT;
