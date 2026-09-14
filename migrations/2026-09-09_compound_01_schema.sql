-- ============================================================================
-- COMPOUND — Esquema
--
-- Sustituye la captura en 'Compound/Producción Diaria 2025 rev01.xlsx' y
-- 'Compound/Powder recovery.xlsx', y las dos páginas del .pbix Compound.
--
-- Son DOS hechos distintos, por eso van en dos tablas y no en una:
--
--   comp_produccion   un renglón por FECHA × LÍNEA × TURNO. Trae la producción
--                     en kg y el tiempo muerto DESGLOSADO EN SIETE CAUSAS. Ese
--                     desglose es lo que el Power BI nunca graficó: solo
--                     mostraba la suma. En el histórico (ene-2025 a jul-2026)
--                     tres causas explican el 89% del paro — cambio de color
--                     39.9%, programado 29.1% y mantenimiento 20.1%.
--
--   comp_recuperacion un renglón por FECHA × BU con producción, consumo de
--                     polvo y purga recuperada. Es otro archivo, otra
--                     granularidad (BU, no línea) y otro rango de fechas
--                     (arranca en 2023), así que no se puede mezclar.
--
-- Cálculos (verificados contra las 1,926 filas del Excel):
--   tiempo_muerto  = AM + CC + LH + TMM + PLAN + FT + FP
--                    La columna del Excel difiere en 46.5 h de 3,594 (1.3%),
--                    por errores de captura sueltos. Aquí se guarda la suma
--                    de las causas, que es la que cuadra con el desglose.
--   %tiempo muerto = SUM(tiempo_muerto) / SUM(turno_horas)   = 20.28% global
--   %scrap         = SUM(kg_perdidos) / SUM(produccion_kg)   =  5.45% global
--   %cumplimiento  = produccion_kg / meta_turno_kg           (no está topado:
--                    528 de 1,324 turnos pasan de 100%, el máximo es 129.8%)
--   %reciclado     = SUM(consumo_polvo_kg) / SUM(produccion_kg)
--
-- Idempotente. Correr ANTES del seed (02_seed).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Catálogo de causas de tiempo muerto
--
--    Se guarda el CÓDIGO en comp_produccion y el nombre vive aquí, porque de
--    las siete siglas solo tres están confirmadas: CC, TMM y PLAN aparecen
--    descritas en la columna OBSERVACIONES del Excel ("3 cambios de color",
--    "10 hrs línea 2 por revisión de mantenimiento", "5 hrs por programación").
--    Las otras cuatro son una lectura razonable pero SIN CONFIRMAR por planta;
--    van marcadas y se corrigen con un UPDATE de una línea, sin tocar datos.
--
--    `planeado` separa el paro que se decidió de antemano del que se sufrió:
--    mezclarlos hace ver mal al área por horas que alguien más programó.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.comp_causas_paro (
  codigo       varchar(10)  PRIMARY KEY,
  nombre       varchar(80)  NOT NULL,
  descripcion  text,
  planeado     boolean      NOT NULL DEFAULT false,
  confirmada   boolean      NOT NULL DEFAULT false,
  orden        smallint     NOT NULL DEFAULT 0,
  activo       boolean      NOT NULL DEFAULT true
);

COMMENT ON TABLE public.comp_causas_paro IS
  'Causas de tiempo muerto de Compound. confirmada=false: nombre supuesto, falta que planta lo valide.';

-- ---------------------------------------------------------------------------
-- 2. Producción diaria por línea y turno
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.comp_produccion (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),

  fecha            date         NOT NULL,
  linea            varchar(20)  NOT NULL,
  -- A o B. Queda NULL a propósito en los 464 renglones del histórico que no
  -- lo traen (213 vacíos y 251 con espacio duro), en vez de inventarlo.
  turno            varchar(5),
  supervisor       varchar(80),

  produccion_kg    numeric(12,2) NOT NULL DEFAULT 0,
  turno_horas      numeric(6,2)  NOT NULL DEFAULT 0,

  -- Las siete causas, cada una en su columna: es como viene el Excel y
  -- permite sumarlas sin desnormalizar a renglón por causa.
  paro_am          numeric(6,2) NOT NULL DEFAULT 0,
  paro_cc          numeric(6,2) NOT NULL DEFAULT 0,
  paro_lh          numeric(6,2) NOT NULL DEFAULT 0,
  paro_tmm         numeric(6,2) NOT NULL DEFAULT 0,
  paro_plan        numeric(6,2) NOT NULL DEFAULT 0,
  paro_ft          numeric(6,2) NOT NULL DEFAULT 0,
  paro_fp          numeric(6,2) NOT NULL DEFAULT 0,

  -- Suma de las siete. Generada para que ninguna consulta pueda olvidar una
  -- causa y para poder indexarla.
  tiempo_muerto    numeric(8,2)
    GENERATED ALWAYS AS (
      paro_am + paro_cc + paro_lh + paro_tmm + paro_plan + paro_ft + paro_fp
    ) STORED,

  -- Horas realmente corriendo. Puede dar negativo si alguien capturó más paro
  -- que turno; se deja pasar y el reporte lo marca, en vez de rechazar la fila.
  horas_operacion  numeric(8,2)
    GENERATED ALWAYS AS (
      turno_horas
        - (paro_am + paro_cc + paro_lh + paro_tmm + paro_plan + paro_ft + paro_fp)
    ) STORED,

  meta_kg_hora     numeric(8,2),
  meta_turno_kg    numeric(12,2),
  kg_perdidos      numeric(12,2) NOT NULL DEFAULT 0,

  observaciones    text,

  -- De dónde salió el renglón, igual que en Inyección: así una recarga del
  -- Excel puede reemplazar solo lo importado y nunca lo capturado a mano.
  origen           varchar(20)  NOT NULL DEFAULT 'IMPORTACION',
  carga_id         uuid,
  creado_en        timestamp    NOT NULL DEFAULT now(),

  CONSTRAINT comp_produccion_origen_check
    CHECK (origen IN ('IMPORTACION', 'CAPTURA')),
  CONSTRAINT comp_produccion_kg_check
    CHECK (produccion_kg >= 0 AND kg_perdidos >= 0),
  CONSTRAINT comp_produccion_turno_check
    CHECK (turno IS NULL OR turno IN ('A', 'B'))
);

COMMENT ON TABLE public.comp_produccion IS
  'Producción diaria de Compound por línea y turno, con el tiempo muerto abierto por causa.';
COMMENT ON COLUMN public.comp_produccion.horas_operacion IS
  'turno_horas menos el paro. Negativo = captura inconsistente, el reporte lo señala.';

-- No hay llave única natural: el mismo día, línea y turno puede aparecer más
-- de una vez cuando se corrige o se parte el registro. Se indexa para filtrar.
CREATE INDEX IF NOT EXISTS idx_comp_prod_fecha        ON public.comp_produccion (fecha);
CREATE INDEX IF NOT EXISTS idx_comp_prod_linea_fecha  ON public.comp_produccion (linea, fecha);
CREATE INDEX IF NOT EXISTS idx_comp_prod_turno        ON public.comp_produccion (turno) WHERE turno IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comp_prod_supervisor   ON public.comp_produccion (supervisor) WHERE supervisor IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comp_prod_carga        ON public.comp_produccion (carga_id) WHERE carga_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Recuperación de polvo, por BU
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.comp_recuperacion (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),

  fecha             date          NOT NULL,
  bu                varchar(40)   NOT NULL,

  produccion_kg     numeric(14,4) NOT NULL DEFAULT 0,
  consumo_polvo_kg  numeric(14,4) NOT NULL DEFAULT 0,
  purga_kg          numeric(14,4) NOT NULL DEFAULT 0,
  -- La meta viene en el propio renglón del Excel (0.05 = 5%) y no siempre está
  -- puesta; se guarda tal cual para poder graficar la línea de meta histórica.
  meta              numeric(6,4),

  origen            varchar(20)   NOT NULL DEFAULT 'IMPORTACION',
  carga_id          uuid,
  creado_en         timestamp     NOT NULL DEFAULT now(),

  CONSTRAINT comp_recuperacion_origen_check
    CHECK (origen IN ('IMPORTACION', 'CAPTURA')),
  CONSTRAINT comp_recuperacion_kg_check
    CHECK (produccion_kg >= 0 AND consumo_polvo_kg >= 0 AND purga_kg >= 0)
);

COMMENT ON TABLE public.comp_recuperacion IS
  'Consumo de polvo y purga recuperada por BU. Origen: Powder recovery.xlsx.';

CREATE INDEX IF NOT EXISTS idx_comp_recup_fecha    ON public.comp_recuperacion (fecha);
CREATE INDEX IF NOT EXISTS idx_comp_recup_bu_fecha ON public.comp_recuperacion (bu, fecha);

-- ---------------------------------------------------------------------------
-- 4. Bitácora de cargas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.comp_cargas (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  archivo        varchar(255),
  hoja           varchar(60),
  destino        varchar(30) NOT NULL,
  filas_leidas   integer     NOT NULL DEFAULT 0,
  filas_cargadas integer     NOT NULL DEFAULT 0,
  fecha_min      date,
  fecha_max      date,
  usuario_id     integer     REFERENCES public.usuarios (id),
  creado_en      timestamp   NOT NULL DEFAULT now(),

  CONSTRAINT comp_cargas_destino_check
    CHECK (destino IN ('PRODUCCION', 'RECUPERACION'))
);

CREATE INDEX IF NOT EXISTS idx_comp_cargas_creado ON public.comp_cargas (creado_en DESC);

-- ---------------------------------------------------------------------------
-- 5. Módulo
-- ---------------------------------------------------------------------------
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo)
SELECT 'Reportes de Compound',
       'Producción, tiempo muerto por causa y recuperación de polvo',
       'FlaskConical',
       '/compound/reportes',
       true
WHERE NOT EXISTS (
  SELECT 1 FROM public.modulos WHERE nombre = 'Reportes de Compound'
);

COMMIT;
