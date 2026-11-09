-- ============================================================================
-- SOLICITUDES DE COMPRA — Etapa 5: presupuesto por área
--
-- Cada área de Compras (las de "Aprobadores", una por tema de osticketadm) tiene
-- un presupuesto por mes; el anual es la suma de sus 12 meses. Cuando quien
-- pidió elige una opción, ese monto se descuenta del presupuesto de su área.
--
-- Reglas (decisiones de Alexis, 9-nov-2026):
--   - Se captura un monto POR MES. El anual es la suma.
--   - Lo que no se gasta en un mes PASA al siguiente, dentro del mismo año:
--     el disponible de un mes es lo presupuestado hasta ese mes menos lo
--     ejercido hasta ese mes.
--   - Si la opción rebasa lo disponible, se AVISA y se deja elegir: el saldo
--     queda en negativo y se avisa al gerente del área.
--   - Se descuenta SIN IVA y EN PESOS. Si la cotización trae IVA se le quita
--     (tasa en compras_config.iva_tasa); si viene en dólares se convierte con
--     el FIX de Banxico más reciente al momento de elegir (tipos_cambio).
--   - Cuenta en el mes en que se elige (hora de México).
--
-- Lo descontado se guarda en la solicitud al elegir (no se recalcula): si
-- después cambia el tipo de cambio o la tasa, lo ya ejercido no se mueve.
--
-- Idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Presupuesto por área, año y mes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compras_presupuestos (
  compras_area_id  integer        NOT NULL REFERENCES public.compras_areas(id),
  anio             smallint       NOT NULL CHECK (anio BETWEEN 2020 AND 2100),
  mes              smallint       NOT NULL CHECK (mes BETWEEN 1 AND 12),
  monto            numeric(14,2)  NOT NULL DEFAULT 0 CHECK (monto >= 0),
  actualizado_por  integer        REFERENCES public.usuarios(id),
  actualizado_en   timestamp      NOT NULL DEFAULT now(),
  PRIMARY KEY (compras_area_id, anio, mes)
);

-- ---------------------------------------------------------------------------
-- 2. Lo que descontó cada solicitud al elegir
-- ---------------------------------------------------------------------------
ALTER TABLE public.compras_solicitudes
  -- En pesos y sin IVA. NULL si se eligió en dólares sin tipo de cambio disponible
  ADD COLUMN IF NOT EXISTS monto_presupuesto        numeric(14,2),
  -- El FIX usado (NULL si la opción era en pesos)
  ADD COLUMN IF NOT EXISTS tipo_cambio_presupuesto  numeric(12,6),
  ADD COLUMN IF NOT EXISTS presupuesto_anio         smallint,
  ADD COLUMN IF NOT EXISTS presupuesto_mes          smallint;

CREATE INDEX IF NOT EXISTS idx_compras_sol_presupuesto
  ON public.compras_solicitudes (compras_area_id, presupuesto_anio, presupuesto_mes)
  WHERE estado = 'ELEGIDA';

-- Tasa de IVA que se le quita a las cotizaciones que lo traen incluido
ALTER TABLE public.compras_config
  ADD COLUMN IF NOT EXISTS iva_tasa numeric(5,4) NOT NULL DEFAULT 0.16;

-- ---------------------------------------------------------------------------
-- 3. Aviso al gerente cuando una elección deja el presupuesto en negativo
-- ---------------------------------------------------------------------------
ALTER TABLE public.compras_correos DROP CONSTRAINT IF EXISTS compras_correos_tipo_valido;
ALTER TABLE public.compras_correos ADD CONSTRAINT compras_correos_tipo_valido
  CHECK (tipo IN ('NUEVA', 'RECORDATORIO', 'RECHAZADA', 'APROBADA', 'EN_COMPRAS', 'PRUEBA',
                  'COTIZADA', 'ELEGIDA', 'OTRAS_OPCIONES', 'SOBREGIRO'));

-- ---------------------------------------------------------------------------
-- 4. Módulo
--    leer   = ver el presupuesto, lo ejercido y lo disponible de cada área
--    editar = capturar los montos
-- ---------------------------------------------------------------------------
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Presupuestos de Compras',
       'Presupuesto mensual de cada área, lo ejercido por las compras elegidas y lo que queda',
       'PiggyBank',
       '/compras/presupuestos',
       true,
       27
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/compras/presupuestos');

COMMIT;
