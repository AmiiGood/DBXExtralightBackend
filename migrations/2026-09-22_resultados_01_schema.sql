-- ============================================================================
-- RESULTADOS — Esquema
--
-- Sustituye el libro 'DATA-FCMX-AAAA Mes.xlsx', que es el tablero mensual de
-- resultados de la planta: catorce hojas y diez gráficas.
--
-- Catorce hojas, pero solo SIETE hechos. La mitad del libro son re-acomodos:
--
--   'Q.TY (Billed)' y 'USD (Billed)' son 'Fact acumulada' puesta de lado con
--   cinco años en paralelo, más los pivotes que alimentan sus gráficas.
--
--   'TOTAL SCRAP' es la suma exacta de las otras cuatro hojas de scrap. Lo
--   comprobé: 5,828,445 producidas y 810,196 de rechazo en 2026, al kilo. Un
--   total que se puede sumar no se guarda; guardarlo solo abre la puerta a que
--   un día no cuadre con sus partes.
--
-- Por eso aquí hay UNA tabla de valores y no catorce. Todo el libro cabe en
-- (año, mes, unidad de negocio, métrica) porque todo es mensual y casi todo
-- está cortado por unidad de negocio.
--
-- Dos convenciones que evitan tener columnas que aceptan nulos en la llave:
--
--   mes = 0   el dato es del año completo, no de un mes. Lo usan el estado de
--             resultados y la foto de carga de PO.
--
--   bu = 'PLANTA'  el dato no se abre por unidad de negocio: energía, plantilla
--             y compound se miden para toda la planta.
--
-- Lo que NO se guarda, porque se recalcula: todos los porcentajes y razones
-- del libro (% scrap, % uso de capacidad, % de horas extra, tiempo de ciclo,
-- €/KWh, KWh por par, precio por par, y los % del estado de resultados). Se
-- verificó que cada uno sale de los absolutos; guardarlos sería guardar la
-- misma verdad dos veces.
--
-- Verificado contra 'DATA-FCMX-2026 Agosto.xlsx': 2,135 valores, 2020 a 2026.
--
-- Idempotente. Correr ANTES del seed (02_seed).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Unidades de negocio
--
--    El mismo negocio se llama distinto en cada hoja y cambió con los años:
--    'Crocs(pairs)' en 2020, 'Crocs (pairs)' en 2023, 'Crocs' en 'Margin'. Los
--    alias se resuelven en el parser y aquí solo viven los códigos.
--
--    Dos equivalencias que el libro únicamente revela en las FÓRMULAS de la
--    hoja 'Margin':
--      Foam Design = Technical product
--      Footwear    = Sole + Dual Color
--    La segunda no se puede deshacer, así que FOOTWEAR se queda como unidad
--    propia y solo aparece en el estado de resultados.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.res_unidades_negocio (
  codigo   varchar(20)  PRIMARY KEY,
  nombre   varchar(60)  NOT NULL,
  -- Para leyendas y ejes: lo que se cuenta en esta unidad de negocio
  medida   varchar(20)  NOT NULL DEFAULT 'PARES',
  orden    smallint     NOT NULL DEFAULT 0,
  activo   boolean      NOT NULL DEFAULT true
);

COMMENT ON TABLE public.res_unidades_negocio IS
  'Unidades de negocio del reporte de Resultados. PLANTA = el dato no se abre por BU.';

-- ---------------------------------------------------------------------------
-- 2. Catálogo de métricas
--
--    `agregacion` dice cómo se sube de mes a año, y no es un detalle: sumar
--    una plantilla de 12 meses daría 9,000 empleados. SUMA para lo que se
--    acumula, PROMEDIO para lo que es un nivel (plantilla, capacidad
--    instalada) y ULTIMO para lo que es una foto.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.res_metricas (
  codigo      varchar(30)  PRIMARY KEY,
  nombre      varchar(80)  NOT NULL,
  bloque      varchar(20)  NOT NULL,
  unidad      varchar(20)  NOT NULL,
  agregacion  varchar(10)  NOT NULL DEFAULT 'SUMA',
  -- Signo con el que entra al estado de resultados en cascada: +1 aporta,
  -- -1 resta, 0 es un subtotal que no se acumula (se dibuja como escalón).
  signo       smallint     NOT NULL DEFAULT 0,
  orden       smallint     NOT NULL DEFAULT 0,
  activo      boolean      NOT NULL DEFAULT true,

  CONSTRAINT res_metricas_bloque_check
    CHECK (bloque IN ('FACTURACION', 'CAPACIDAD', 'PERSONAL', 'ENERGIA',
                      'COMPOUND', 'SCRAP', 'MARGEN', 'CARGA')),
  CONSTRAINT res_metricas_agregacion_check
    CHECK (agregacion IN ('SUMA', 'PROMEDIO', 'ULTIMO')),
  CONSTRAINT res_metricas_signo_check
    CHECK (signo IN (-1, 0, 1))
);

COMMENT ON COLUMN public.res_metricas.agregacion IS
  'Cómo se sube de mes a año. PROMEDIO para niveles (plantilla): sumarlos no significa nada.';

-- ---------------------------------------------------------------------------
-- 3. Valores
--
--    El Excel vuelve a traer TODO el histórico cada mes, así que la carga hace
--    UPSERT en lugar de borrar por rango: un archivo recortado no puede perder
--    historia. Lo que el archivo ya no mencione se queda como está.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.res_valores (
  anio            smallint     NOT NULL,
  -- 1..12, o 0 cuando el dato es del año completo
  mes             smallint     NOT NULL,
  bu              varchar(20)  NOT NULL REFERENCES public.res_unidades_negocio (codigo),
  metrica_codigo  varchar(30)  NOT NULL REFERENCES public.res_metricas (codigo),

  -- 4 decimales y 20 dígitos: aquí conviven toneladas con dos decimales,
  -- porcentajes de rotación como fracción (0.05) e importes de ocho cifras
  -- del estado de resultados.
  valor           numeric(20,4) NOT NULL,

  origen          varchar(20)  NOT NULL DEFAULT 'IMPORTACION',
  carga_id        uuid,
  actualizado_en  timestamp    NOT NULL DEFAULT now(),

  PRIMARY KEY (anio, mes, bu, metrica_codigo),
  CONSTRAINT res_valores_anio_check CHECK (anio BETWEEN 2000 AND 2100),
  CONSTRAINT res_valores_mes_check  CHECK (mes BETWEEN 0 AND 12),
  CONSTRAINT res_valores_origen_check
    CHECK (origen IN ('IMPORTACION', 'CAPTURA'))
);

COMMENT ON COLUMN public.res_valores.mes IS
  '1..12, o 0 cuando el dato es anual (estado de resultados, foto de carga de PO).';

CREATE INDEX IF NOT EXISTS idx_res_valores_metrica ON public.res_valores (metrica_codigo, anio);
CREATE INDEX IF NOT EXISTS idx_res_valores_anio    ON public.res_valores (anio, mes);
CREATE INDEX IF NOT EXISTS idx_res_valores_carga   ON public.res_valores (carga_id) WHERE carga_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Bitácora de cargas
--
--    `corte_mes` es el mes que cierra el archivo, sacado de su nombre
--    ('DATA-FCMX-2026 Agosto.xlsx'). Importa porque es lo único que fecha la
--    foto de carga de PO y el bloque del estado de resultados que viene sin
--    año escrito en la hoja.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.res_cargas (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  archivo        varchar(255),
  filas_leidas   integer     NOT NULL DEFAULT 0,
  filas_cargadas integer     NOT NULL DEFAULT 0,
  anio_min       smallint,
  anio_max       smallint,
  corte_anio     smallint,
  corte_mes      smallint,
  semana_carga   smallint,
  hojas          text,
  usuario_id     integer     REFERENCES public.usuarios (id),
  creado_en      timestamp   NOT NULL DEFAULT now(),

  CONSTRAINT res_cargas_corte_mes_check CHECK (corte_mes IS NULL OR corte_mes BETWEEN 1 AND 12)
);

CREATE INDEX IF NOT EXISTS idx_res_cargas_creado ON public.res_cargas (creado_en DESC);

-- ---------------------------------------------------------------------------
-- 5. Módulos
-- ---------------------------------------------------------------------------
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Reportes de Resultados',
       'Facturación, capacidad, scrap, personal, energía, compound y estado de resultados',
       'Target',
       '/resultados/reportes',
       true,
       18
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/resultados/reportes');

INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Carga de Resultados',
       'Sube el Excel mensual DATA-FCMX',
       'Upload',
       '/resultados/carga',
       true,
       19
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/resultados/carga');

COMMIT;
