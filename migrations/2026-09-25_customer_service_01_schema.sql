-- ============================================================================
-- CUSTOMER SERVICE — Esquema
--
-- Tercer patrón de origen del proyecto. Los otros dos son:
--   carga manual por pantalla   STAFF, Resultados, Compuestos, Inyección
--   réplica de base externa     Moldes, TI (osTicket)
--
-- Este es distinto: los archivos VIVEN en una carpeta de red y el área los
-- actualiza ahí cada semana. Nadie los va a subir a mano, así que el sistema
-- vigila la carpeta y se entera solo.
--
-- Dos archivos, en \\172.16.101.124\AREAS\Customer Service\Metricos Clientes:
--
--   KPI Customer Service AAAA.xlsx   tres hojas de estructura IDÉNTICA (OTS,
--                                    SC, OTIF), un renglón por año × semana ×
--                                    unidad de negocio. Por eso van en UNA
--                                    tabla con columna `indicador` y no en tres.
--
--   Muestras AAAA.xlsx               hoja 'Timeline Samples', un renglón por
--                                    muestra solicitada.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ EL NOMBRE DEL ARCHIVO ES CONFIGURABLE Y NO UNA CONSTANTE
-- ---------------------------------------------------------------------------
-- Porque lleva el año dentro y cambia cada enero. En la carpeta ya conviven
-- 'KPI Customer Service 2025.xlsx' y 'KPI Customer Service 2026.xlsx'. Si el
-- nombre viviera en el código o en el .env, cada año habría que desplegar; así
-- se edita desde la pantalla y ya.
--
-- ---------------------------------------------------------------------------
-- LO QUE NO SE GUARDA
-- ---------------------------------------------------------------------------
-- Las hojas 'GRAFICA' y 'Grafica' de los dos libros son tablas dinámicas
-- derivadas del detalle. Se verificó que el detalle las reproduce exacto
-- (1,128 pares totales, 562 en tiempo y 566 con retraso, y cada unidad de
-- negocio cuadra), así que guardarlas sería guardar la misma verdad dos veces.
-- Además la del libro está desactualizada: dice 4 "en proceso" donde el detalle
-- tiene 5, porque nadie la refrescó.
--
-- Tampoco se guardan las columnas calculadas (% ponderado = valor × peso) ni
-- los porcentajes de resumen: se recalculan al consultar.
--
-- Idempotente. Correr ANTES del seed (02_seed).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Qué archivos se vigilan, dónde están y cómo se encontraron la última vez
--
--    `huella` es un SHA-256 del contenido. La vigilancia compara eso y no la
--    fecha del archivo: abrir un Excel y cerrarlo sin guardar ya le mueve la
--    fecha, y releer un libro que no cambió es trabajo tirado.
--
--    `ultimo_error` guarda el último fallo de lectura. Importa más de lo que
--    parece: si el servidor pierde el permiso al recurso compartido, o alguien
--    renombra el archivo en enero, el reporte se queda con el dato viejo y NADIE
--    se entera. Aquí queda escrito y la pantalla lo enseña.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cs_archivos (
  clave           varchar(20)  PRIMARY KEY,
  nombre          varchar(80)  NOT NULL,

  -- Se guarda como UNC y NO como unidad mapeada: la letra (F:) solo existe
  -- dentro de la sesión de Windows de quien la mapeó. Un servicio no la ve.
  carpeta         varchar(400) NOT NULL,
  archivo         varchar(200) NOT NULL,

  activo          boolean      NOT NULL DEFAULT true,

  -- Estado de la última lectura
  huella          varchar(64),
  tamano_bytes    bigint,
  modificado_en   timestamp,
  leido_en        timestamp,
  filas           integer,
  ultimo_error    text,
  error_en        timestamp,

  actualizado_en  timestamp    NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cs_archivos IS
  'Archivos de Customer Service que se vigilan en la carpeta de red. La ruta y el nombre se editan desde la pantalla.';
COMMENT ON COLUMN public.cs_archivos.huella IS
  'SHA-256 del contenido. Se relee solo si cambia; la fecha del archivo se mueve aunque no se guarde nada.';
COMMENT ON COLUMN public.cs_archivos.carpeta IS
  'Ruta UNC. Nunca una unidad mapeada: la letra no existe fuera de la sesión de quien la montó.';

-- ---------------------------------------------------------------------------
-- 2. Los tres indicadores semanales
--
--    OTS, SC y OTIF comparten exactamente las mismas columnas en el libro, así
--    que van en una sola tabla. Separarlas en tres sería repetir el esquema por
--    triplicado y obligar a un UNION en cada consulta.
--
--    El libro trae las 53 semanas del año precargadas aunque no hayan pasado:
--    OTIF tiene 548 renglones con valor de 633. Una semana sin valor se guarda
--    igual, con `valor_bu` en NULL — así el reporte distingue "semana que no ha
--    llegado" de "semana que nadie capturó", que no es lo mismo.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cs_kpi (
  indicador      varchar(10)  NOT NULL,
  anio           smallint     NOT NULL,
  semana         smallint     NOT NULL,
  bu             varchar(30)  NOT NULL,

  -- Mes y trimestre vienen del libro y se guardan tal cual en vez de deducirse
  -- de la fecha: el año comercial del área no siempre empata con el calendario.
  mes            varchar(10),
  trimestre      smallint,
  fecha          date,

  meta           numeric(6,4),
  -- El indicador de la semana completa (se repite en las tres unidades)
  valor_general  numeric(9,6),
  -- El de esta unidad de negocio
  valor_bu       numeric(9,6),
  -- Cuánto pesa esta unidad en el total de la semana
  ponderacion    numeric(6,4),

  archivo_origen varchar(200),
  carga_id       uuid,
  actualizado_en timestamp    NOT NULL DEFAULT now(),

  PRIMARY KEY (indicador, anio, semana, bu),
  CONSTRAINT cs_kpi_indicador_check CHECK (indicador IN ('OTS', 'SC', 'OTIF')),
  -- Desde 0: el libro usa la semana 0 para el arranque del año (1 de enero),
  -- y en la hoja SC esos renglones traen valor.
  CONSTRAINT cs_kpi_semana_check    CHECK (semana BETWEEN 0 AND 53),
  CONSTRAINT cs_kpi_anio_check      CHECK (anio BETWEEN 2000 AND 2100)
);

COMMENT ON COLUMN public.cs_kpi.valor_bu IS
  'NULL = la semana no tiene captura todavía. El libro precarga las 53 semanas del año.';

CREATE INDEX IF NOT EXISTS idx_cs_kpi_ind_anio ON public.cs_kpi (indicador, anio, semana);
CREATE INDEX IF NOT EXISTS idx_cs_kpi_fecha    ON public.cs_kpi (fecha) WHERE fecha IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Muestras, una fila por solicitud
--
--    A diferencia del KPI, aquí NO hay llave natural: el 'SAMPLES ID' se repite
--    entre renglones (varias solicitudes del mismo proyecto). Por eso la carga
--    reemplaza completo lo que vino de ese archivo, en vez de hacer upsert.
--    `archivo_origen` es lo que permite que convivan varios años sin pisarse.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cs_muestras (
  id              bigserial    PRIMARY KEY,

  area            varchar(60),
  -- A.R. / D.R. Son dos conjuntos que el libro nunca mezcla en sus gráficas,
  -- así que aquí se guarda y el reporte lo ofrece como filtro.
  periodo         varchar(20),
  bu              varchar(40),
  tipo            varchar(60),
  familia         varchar(60),
  cliente         varchar(120),
  muestra_id      varchar(120),

  inicio          date,
  fin             date,
  -- Días que tardó y días que debía tardar. Vienen calculados del libro y se
  -- guardan tal cual: el área los ajusta a mano en algunos renglones y
  -- recalcularlos desde las fechas cambiaría su número.
  dias_proceso    numeric(8,2),
  dias_objetivo   numeric(8,2),

  sku             varchar(120),
  descripcion     text,
  cantidad        numeric(12,2),
  pares           numeric(12,2),
  en_tiempo       numeric(12,2),
  con_retraso     numeric(12,2),

  estado          varchar(60),
  entrega         varchar(60),
  comentarios     text,

  archivo_origen  varchar(200) NOT NULL,
  carga_id        uuid,
  creado_en       timestamp    NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cs_muestras IS
  'Detalle de Timeline Samples. Se reemplaza completo por archivo de origen: no hay llave natural.';
COMMENT ON COLUMN public.cs_muestras.dias_proceso IS
  'Del libro, no recalculado desde las fechas: el área ajusta algunos a mano.';

CREATE INDEX IF NOT EXISTS idx_cs_muestras_inicio  ON public.cs_muestras (inicio);
CREATE INDEX IF NOT EXISTS idx_cs_muestras_bu      ON public.cs_muestras (bu, familia);
CREATE INDEX IF NOT EXISTS idx_cs_muestras_archivo ON public.cs_muestras (archivo_origen);

-- ---------------------------------------------------------------------------
-- 4. Bitácora de sincronizaciones
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cs_sincronizaciones (
  id             uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  clave          varchar(20),
  archivo        varchar(200),
  iniciada_en    timestamp  NOT NULL DEFAULT now(),
  terminada_en   timestamp,
  exito          boolean,
  -- false cuando el archivo no había cambiado y no se leyó nada
  hubo_cambio    boolean    NOT NULL DEFAULT false,
  filas_leidas   integer    NOT NULL DEFAULT 0,
  filas_cargadas integer    NOT NULL DEFAULT 0,
  duracion_ms    integer,
  mensaje        text,
  usuario_id     integer    REFERENCES public.usuarios (id)
);

CREATE INDEX IF NOT EXISTS idx_cs_sinc_iniciada ON public.cs_sincronizaciones (iniciada_en DESC);

-- ---------------------------------------------------------------------------
-- 5. Módulos
-- ---------------------------------------------------------------------------
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Reportes de Customer Service',
       'OTS, OTIF, satisfacción del cliente y tiempos de muestras',
       'Handshake',
       '/customer-service/reportes',
       true,
       21
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/customer-service/reportes');

-- La configuración de los archivos va aparte del reporte: una cosa es verlo y
-- otra cambiar de dónde sale el dato.
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Archivos de Customer Service',
       'Qué archivos de la carpeta de red se vigilan',
       'FolderCog',
       '/customer-service/archivos',
       true,
       22
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/customer-service/archivos');

COMMIT;
