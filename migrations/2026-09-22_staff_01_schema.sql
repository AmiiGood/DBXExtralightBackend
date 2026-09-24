-- ============================================================================
-- STAFF — Esquema
--
-- Sustituye la presentación semanal 'Staff Meeting Week NN - Alexis.pptx', cuyas
-- gráficas son capturas de pantalla pegadas del Excel
-- '2026 CPC JUNTA DE STAFF WEEK NN.xlsx'. Cuatro temas: facturación, PO
-- abierta, inyección y ensamble; más rotación de plantilla, que el Excel lleva
-- al día y la presentación no grafica.
--
-- El archivo no se parece a ningún otro del proyecto: NO es una lista de
-- renglones, es una MATRIZ HORIZONTAL que crece una columna por semana, con los
-- periodos en los encabezados y las métricas en los renglones. Guardarlo con
-- esa forma obligaría a agregar una columna a la tabla cada lunes, así que se
-- voltea a formato largo: un renglón por periodo × métrica.
--
-- De ahí las tres tablas de serie:
--
--   staff_periodos   el eje de tiempo, ya resuelto. Existe porque el Excel
--                    escribe el mismo periodo de seis maneras distintas
--                    ('WEEK 40', 'Week 40', 40, '40A', '49-1') en dos idiomas,
--                    y las columnas recientes perdieron el año por completo:
--                    de 'NOVIEMBRE' a 'JULY' no hay un solo encabezado que
--                    diga 2026. El parser lo deduce recorriendo la secuencia y
--                    aquí queda asentado de una vez.
--
--   staff_metricas   catálogo de las series (ver 02_seed).
--
--   staff_valores    el dato. Llave (periodo, métrica), para que recargar el
--                    archivo de la semana siguiente actualice en lugar de
--                    duplicar.
--
-- Y una aparte, porque NO es una serie:
--
--   staff_open_po    la cartera de PO abierta es una FOTO al momento del
--                    corte, no un histórico: el Excel la sobreescribe cada
--                    semana y nunca se guardó lo anterior. Se archiva por
--                    semana de corte para poder ver, por fin, cómo se mueve.
--                    Sus columnas son meses de ENTREGA futura y dos etiquetas
--                    que ni siquiera son fechas ('Backlog', 'Uncommited'), así
--                    que no pueden reusar staff_periodos.
--
-- Verificado contra el archivo de la semana 35: 8,686 valores, 319 periodos de
-- 2021 a 2026, y los 50 renglones de PO abierta suman exactamente los totales
-- que trae la hoja (Crocs 1,390,370 y Sole 62,186).
--
-- Idempotente. Correr ANTES del seed (02_seed).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Eje de tiempo
--
--    Semanas y meses conviven en la misma tabla porque el Excel los intercala
--    en el mismo renglón de encabezados y las gráficas de la junta mezclan los
--    dos: los meses cerrados del año más las semanas del mes en curso.
--
--    OJO: el mes NO es la suma de sus semanas en todos los bloques. En
--    facturación sí (son pares facturados), pero en inyección y ensamble el
--    valor es un PROMEDIO DIARIO, y ahí el mes es su propio promedio. Por eso
--    los dos se guardan tal como vienen y nunca se recalcula uno del otro.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_periodos (
  id        serial       PRIMARY KEY,
  -- '2026-S34' / '2026-M07'. Ordena alfabéticamente dentro del año y es la
  -- llave con la que viajan los valores antes de tocar la base.
  codigo    varchar(12)  NOT NULL UNIQUE,
  tipo      varchar(10)  NOT NULL,
  anio      smallint     NOT NULL,
  numero    smallint     NOT NULL,
  etiqueta  varchar(40)  NOT NULL,

  CONSTRAINT staff_periodos_tipo_check
    CHECK (tipo IN ('SEMANA', 'MES')),
  CONSTRAINT staff_periodos_numero_check
    CHECK ((tipo = 'MES' AND numero BETWEEN 1 AND 12)
        OR (tipo = 'SEMANA' AND numero BETWEEN 1 AND 53)),
  CONSTRAINT staff_periodos_unico UNIQUE (tipo, anio, numero)
);

COMMENT ON TABLE public.staff_periodos IS
  'Eje de tiempo de los reportes de STAFF. Semanas y meses; el mes no siempre es la suma de sus semanas.';

CREATE INDEX IF NOT EXISTS idx_staff_periodos_orden
  ON public.staff_periodos (anio, tipo, numero);

-- ---------------------------------------------------------------------------
-- 2. Catálogo de métricas
--
--    `serie` empareja el dato con su meta: 'inv_crocs' y 'inv_crocs_meta'
--    comparten serie CROCS dentro del bloque INVOICE, y así la gráfica sabe
--    qué línea de meta va con qué barra sin una lista de pares a mano.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_metricas (
  codigo   varchar(30)  PRIMARY KEY,
  nombre   varchar(80)  NOT NULL,
  bloque   varchar(20)  NOT NULL,
  serie    varchar(30)  NOT NULL,
  es_meta  boolean      NOT NULL DEFAULT false,
  unidad   varchar(20)  NOT NULL DEFAULT 'PARES',
  orden    smallint     NOT NULL DEFAULT 0,
  activo   boolean      NOT NULL DEFAULT true,

  CONSTRAINT staff_metricas_bloque_check
    CHECK (bloque IN ('INVOICE', 'INYECCION', 'ENSAMBLE', 'ROTACION')),
  CONSTRAINT staff_metricas_unidad_check
    CHECK (unidad IN ('PARES', 'PIEZAS', 'PERSONAS', 'PORCENTAJE'))
);

COMMENT ON COLUMN public.staff_metricas.serie IS
  'Une el dato con su meta: inv_crocs e inv_crocs_meta comparten serie CROCS.';

-- ---------------------------------------------------------------------------
-- 3. Valores
--
--    El Excel vuelve a traer TODO el histórico cada semana, así que la carga
--    actualiza en vez de borrar por rango: nada se pierde si un archivo llega
--    recortado. La contra es que un valor borrado del Excel se queda aquí;
--    se asume a propósito, porque perder historia es peor.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_valores (
  periodo_id     integer      NOT NULL REFERENCES public.staff_periodos (id) ON DELETE CASCADE,
  metrica_codigo varchar(30)  NOT NULL REFERENCES public.staff_metricas (codigo),

  -- 4 decimales: los renglones de rotación son porcentajes guardados como
  -- fracción (0.0414 = 4.14%) y redondearlos los aplastaría a cero.
  valor          numeric(16,4) NOT NULL,

  origen         varchar(20)  NOT NULL DEFAULT 'IMPORTACION',
  carga_id       uuid,
  actualizado_en timestamp    NOT NULL DEFAULT now(),

  PRIMARY KEY (periodo_id, metrica_codigo),
  CONSTRAINT staff_valores_origen_check
    CHECK (origen IN ('IMPORTACION', 'CAPTURA'))
);

CREATE INDEX IF NOT EXISTS idx_staff_valores_metrica ON public.staff_valores (metrica_codigo);
CREATE INDEX IF NOT EXISTS idx_staff_valores_carga   ON public.staff_valores (carga_id) WHERE carga_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. PO abierta, archivada por semana de corte
--
--    `entrega` es texto y no una fecha porque las columnas del Excel son
--    'Backlog' (lo vencido), los meses de entrega comprometidos y 'Uncommited'
--    (lo que aún no tiene mes). `orden` conserva la posición original para que
--    la gráfica no tenga que adivinar dónde va Backlog.
--
--    La semana de corte sale del NOMBRE del archivo ('... WEEK 35.xlsx'): por
--    dentro no hay nada que diga a qué semana corresponde la foto.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_open_po (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),

  corte_anio     smallint      NOT NULL,
  corte_semana   smallint      NOT NULL,

  bu             varchar(30)   NOT NULL,
  entrega        varchar(20)   NOT NULL,
  orden          smallint      NOT NULL DEFAULT 0,
  es_meta        boolean       NOT NULL DEFAULT false,
  cantidad       numeric(14,2) NOT NULL DEFAULT 0,

  carga_id       uuid,
  creado_en      timestamp     NOT NULL DEFAULT now(),

  CONSTRAINT staff_open_po_semana_check CHECK (corte_semana BETWEEN 1 AND 53),
  CONSTRAINT staff_open_po_unico UNIQUE (corte_anio, corte_semana, bu, entrega, es_meta)
);

COMMENT ON TABLE public.staff_open_po IS
  'Foto semanal de la PO abierta por BU y mes de entrega. El Excel la sobreescribe; aquí se archiva.';

CREATE INDEX IF NOT EXISTS idx_staff_open_po_corte ON public.staff_open_po (corte_anio DESC, corte_semana DESC);

-- ---------------------------------------------------------------------------
-- 5. Bitácora de cargas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_cargas (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  archivo        varchar(255),
  filas_leidas   integer     NOT NULL DEFAULT 0,
  filas_cargadas integer     NOT NULL DEFAULT 0,
  open_po_filas  integer     NOT NULL DEFAULT 0,
  periodo_min    varchar(12),
  periodo_max    varchar(12),
  corte_anio     smallint,
  corte_semana   smallint,
  usuario_id     integer     REFERENCES public.usuarios (id),
  creado_en      timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_cargas_creado ON public.staff_cargas (creado_en DESC);

-- ---------------------------------------------------------------------------
-- 6. Módulos
--
--    El reporte y su carga van separados, igual que en Compuestos y en Carga
--    de Producción: así se concede por un lado ver la junta y por otro
--    reemplazar sus datos.
-- ---------------------------------------------------------------------------
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Reportes de STAFF',
       'Facturación, PO abierta, inyección, ensamble y rotación de plantilla',
       'Users',
       '/staff/reportes',
       true,
       16
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/staff/reportes');

INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Carga de STAFF',
       'Sube el Excel semanal de la junta de STAFF',
       'Upload',
       '/staff/carga',
       true,
       17
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/staff/carga');

COMMIT;
