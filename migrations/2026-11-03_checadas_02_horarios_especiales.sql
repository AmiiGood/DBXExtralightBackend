-- ============================================================================
-- CHECADAS — Horarios especiales por persona
--
-- No todos entran a los turnos de planta (C 00:00, A 08:00, B 16:00). RH lleva
-- un libro, "horarios compuesto y admon", con quien tiene otro horario:
--
--   ADMINISTRATIVO          8:30 a 18:00                 (74 personas)
--   COMPUESTOS MATUTINO     7:00 a 19:00                 (5)
--   COMPUESTOS NOCTURNO     19:00 a 7:00                 (3)
--   COMPUESTOS ROL A / B    rola entre las dos de arriba (9)
--
-- Sin esto, un administrativo que entra a las 8:15 salía "en tolerancia" del
-- turno A, cuando en realidad llegó 15 minutos antes de su hora.
--
-- Cómo se usa: a quien está en `chk_horarios` se le compara SOLO contra sus
-- turnos (con la misma regla de siempre: el inicio más cercano, así el que rola
-- cae solo en el día o en la noche). A los demás, contra los turnos generales.
--
-- El libro se sube en "Carga de Checadas" y cada carga reemplaza la lista: quien
-- ya no viene regresa a los turnos generales.
--
-- Idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Turnos especiales
--
--    `especial`: solo se asigna a quien lo tiene en `chk_horarios`. La
--    tolerancia es la misma de planta (20 min); se cambia aquí si RH lo pide.
--    Si al cargar el libro aparece un horario que no está, se da de alta solo.
-- ---------------------------------------------------------------------------
ALTER TABLE public.chk_turnos
  ADD COLUMN IF NOT EXISTS especial boolean NOT NULL DEFAULT false;

-- 'CMP-D' cabe en varchar(5); los creados al cargar se llaman 'E1', 'E2'...
INSERT INTO public.chk_turnos (clave, nombre, inicio, fin, tolerancia_min, orden, especial) VALUES
  ('ADM',   'Administrativo',   '08:30', '18:00', 20, 10, true),
  ('CMP-D', 'Compuestos día',   '07:00', '19:00', 20, 11, true),
  ('CMP-N', 'Compuestos noche', '19:00', '07:00', 20, 12, true)
ON CONFLICT (clave) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Cargas del libro de horarios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chk_horarios_cargas (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  archivo     varchar(255),
  personas    integer       NOT NULL DEFAULT 0,
  usuario_id  integer       REFERENCES public.usuarios (id),
  creado_en   timestamp     NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. Quién tiene horario especial y contra qué turnos se le compara
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chk_horarios (
  empleado_id    varchar(20)   PRIMARY KEY,
  nombre         varchar(160),
  area           varchar(120),
  perfil         varchar(80),
  -- Tal como viene en el libro: "7:00 am a 7:00 pm o 7:00 pm a 7:00 am"
  horario_texto  varchar(120),
  turnos         text[]        NOT NULL,
  carga_id       uuid          REFERENCES public.chk_horarios_cargas (id),
  actualizado_en timestamp     NOT NULL DEFAULT now(),
  CONSTRAINT chk_horarios_con_turno CHECK (cardinality(turnos) > 0)
);

COMMIT;
