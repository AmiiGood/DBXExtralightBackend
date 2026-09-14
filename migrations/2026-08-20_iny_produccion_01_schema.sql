-- ============================================================================
-- PRODUCCIÓN INYECCIÓN — Esquema
-- Sustituye la captura en 'Producción Inyección.xlsx' (hoja Producción) y
-- alimenta las páginas "Inj" e "Inj 2" del Power BI.
--
-- El Excel guarda DOS tipos de renglón y el reporte usa los dos:
--
--   PRODUCCION    fecha × máquina × estación × turno × producto (SKU).
--                 Una misma estación puede correr más de un SKU en el mismo
--                 turno (1,322 casos en el histórico), por eso NO hay llave
--                 única natural.
--
--   SCRAP_MODELO  scrap que no se le puede atribuir a una máquina: solo trae
--                 fecha, modelo, BU y scrap (el rezago). Son 11,199 renglones
--                 al final de la hoja con 346,048 pares = 13% de todo el scrap.
--                 Sin ellos el %Scrap por BU sale mal (ej. Crocs Unfin daría
--                 10.12% en vez de 11.43%).
--
-- Cálculos (verificados contra 336,567 filas del Excel):
--   ciclos             = contador_final - contador_inicial   (100% de los casos)
--   produccion_teorica = ciclos * cavidades                  (98.8% de los casos)
--   produccion         = capturada; normalmente igual a la teórica, pero se
--                        permite override manual porque hay días sin lectura
--                        de contadores donde se captura el total a mano.
--   %Scrap del reporte = SUM(scrap) / SUM(produccion)        (se calcula en la API)
--
-- Reutiliza de la BD existente: turnos, unidades_negocio, modelos,
-- areas_produccion, cat_colores, cat_tallas_equivalencias.
--
-- Idempotente. Correr ANTES del archivo de seed (02_seed).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. modelos: etiqueta de BU tal como la espera el reporte
--    El Excel deriva BU con un VLOOKUP Modelo → hoja 'Estilos'. Aquí la BU
--    vive en el modelo, que es donde realmente pertenece.
--
--    'unidades_negocio' NO se toca: ahí CROCS es una sola unidad (la usa el
--    módulo de scrap). El reporte de inyección necesita Unfin y Strap por
--    separado, y esa separación es la que guarda bu_reporte.
-- ---------------------------------------------------------------------------
ALTER TABLE public.modelos
  ADD COLUMN IF NOT EXISTS bu_reporte varchar(30);

ALTER TABLE public.modelos
  DROP CONSTRAINT IF EXISTS modelos_bu_reporte_check;
ALTER TABLE public.modelos
  ADD CONSTRAINT modelos_bu_reporte_check
  CHECK (bu_reporte IS NULL OR bu_reporte IN
    ('Crocs Unfin','Crocs Strap','Suela','Almohada','Dual Color'));

CREATE INDEX IF NOT EXISTS idx_modelos_bu_reporte ON public.modelos (bu_reporte);

-- ---------------------------------------------------------------------------
-- 2. Catálogo: Máquinas de inyección
--    unidad_negocio_id es la BU habitual (informativa): varias máquinas corren
--    más de una BU, la BU real del registro sale siempre del modelo.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.iny_maquinas (
  id                serial PRIMARY KEY,
  codigo            varchar(20) NOT NULL UNIQUE,
  nombre            varchar(100),
  unidad_negocio_id integer REFERENCES public.unidades_negocio(id),
  orden             integer DEFAULT 0,
  activo            boolean DEFAULT true,
  creado_en         timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 3. Catálogo: Estaciones por máquina
--    codigo normalizado a 'NN-A' / 'NN-B'. El histórico trae tres formas de
--    escribir lo mismo ('07-A', 'S7-A', '7A'); el importador las normaliza y
--    guarda el texto original en iny_produccion.estacion_origen.
--
--    cavidades_default: sugerencia para el formulario. NO es fijo — en el 88%
--    de las estaciones el histórico tiene más de un valor (molde con cavidad
--    tapada, etc.), por eso cavidades se sigue capturando.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.iny_estaciones (
  id                serial PRIMARY KEY,
  maquina_id        integer NOT NULL REFERENCES public.iny_maquinas(id) ON DELETE CASCADE,
  codigo            varchar(10) NOT NULL,
  cavidades_default numeric(4,1),
  orden             integer DEFAULT 0,
  activo            boolean DEFAULT true,
  creado_en         timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT iny_estaciones_maquina_codigo_key UNIQUE (maquina_id, codigo)
);
CREATE INDEX IF NOT EXISTS idx_iny_estaciones_maquina ON public.iny_estaciones (maquina_id);

-- ---------------------------------------------------------------------------
-- 4. Catálogo: Productos semiterminados de inyección
--    NO es productos_crocs: ese es producto terminado del Avery y tiene 0% de
--    coincidencia con lo que produce inyección (medido sobre 3,545 SKUs).
--
--    Para Crocs el SKU se arma igual que en Carga Masiva de Artículos:
--        [prefijo]-[código unfin/strap]-[color]-[sufijo talla]
--    'variante' guarda el sufijo del color que la columna Color del Excel no
--    registra (ej. SKU ...-001B2-... con Color '001' y descripción "Blk2").
--
--    Para Suela / Almohada / Dual Color no existe catálogo todavía: esas filas
--    se siembran desde el histórico con origen = 'HISTORICO'.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.iny_productos (
  id            serial PRIMARY KEY,
  sku           varchar(60) NOT NULL UNIQUE,
  descripcion   varchar(200),
  modelo_id     integer REFERENCES public.modelos(id),
  -- 60 y no 20: en Suela/Almohada esta columna del Excel trae la descripción
  -- del material, no un código (el más largo mide 41 caracteres).
  color_codigo  varchar(60),
  variante      varchar(20),
  talla         varchar(20),
  bu_reporte    varchar(30),
  origen        varchar(20) NOT NULL DEFAULT 'HISTORICO',
  activo        boolean DEFAULT true,
  creado_en     timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT iny_productos_origen_check
    CHECK (origen IN ('HISTORICO','GENERADO','MANUAL')),
  CONSTRAINT iny_productos_bu_check
    CHECK (bu_reporte IS NULL OR bu_reporte IN
      ('Crocs Unfin','Crocs Strap','Suela','Almohada','Dual Color'))
);
CREATE INDEX IF NOT EXISTS idx_iny_productos_modelo ON public.iny_productos (modelo_id);
CREATE INDEX IF NOT EXISTS idx_iny_productos_bu     ON public.iny_productos (bu_reporte);
-- Autocompletar por SKU o descripción, case-insensitive
CREATE INDEX IF NOT EXISTS idx_iny_productos_sku_lower  ON public.iny_productos (lower(sku));
CREATE INDEX IF NOT EXISTS idx_iny_productos_desc_lower ON public.iny_productos (lower(descripcion));

-- ---------------------------------------------------------------------------
-- 5. Bitácora de cargas de Excel (mismo patrón que qr_cargas_excel)
--    Sirve para la migración del histórico y para cargas posteriores.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.iny_cargas (
  id                     serial PRIMARY KEY,
  nombre_archivo         varchar(255) NOT NULL,
  total_registros        integer DEFAULT 0,
  registros_nuevos       integer DEFAULT 0,
  registros_omitidos     integer DEFAULT 0,
  registros_error        integer DEFAULT 0,
  detalle                jsonb,
  cargado_por            integer NOT NULL REFERENCES public.usuarios(id),
  creado_en              timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 6. Registros de producción
--    bigserial: el histórico son ~336k filas y crece ~630/día (~230k/año).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.iny_produccion (
  id                 bigserial PRIMARY KEY,
  uuid               uuid DEFAULT uuid_generate_v4() UNIQUE,

  tipo               varchar(20) NOT NULL DEFAULT 'PRODUCCION',

  fecha              date    NOT NULL,
  -- turno y máquina son NULL en los renglones de tipo SCRAP_MODELO
  turno_id           integer          REFERENCES public.turnos(id),
  maquina_id         integer          REFERENCES public.iny_maquinas(id),
  estacion_id        integer          REFERENCES public.iny_estaciones(id),
  producto_id        integer          REFERENCES public.iny_productos(id),
  -- modelo directo: en SCRAP_MODELO es el único clasificador que hay
  modelo_id          integer          REFERENCES public.modelos(id),

  -- BU congelada al momento de capturar, igual que hacía el VLOOKUP del Excel.
  -- Va en el renglón (y no solo en el producto o el modelo) porque es LA
  -- dimensión del reporte y los renglones de scrap no traen producto.
  bu_reporte         varchar(30),

  cavidades          numeric(4,1)  NOT NULL,
  -- numeric y no integer: el histórico trae 2 filas con contador fraccionario
  -- (10.5 y 4.5). Se conservan tal cual en vez de redondearlas en silencio.
  contador_inicial   numeric(10,2),
  contador_final     numeric(10,2),

  -- ciclos y producción teórica se derivan; producción es la que manda
  ciclos             numeric(10,2) GENERATED ALWAYS AS
                       (contador_final - contador_inicial) STORED,
  produccion_teorica numeric(12,2) GENERATED ALWAYS AS
                       ((contador_final - contador_inicial) * cavidades) STORED,
  produccion         numeric(12,2) NOT NULL DEFAULT 0,
  scrap              numeric(12,2) NOT NULL DEFAULT 0,

  observaciones      text,

  -- Trazabilidad del origen
  origen             varchar(20) NOT NULL DEFAULT 'FORMULARIO',
  carga_id           integer REFERENCES public.iny_cargas(id),
  estacion_origen    varchar(20),   -- texto tal cual venía en el Excel

  -- Auditoría (mismo patrón que registros_defectos)
  registrado_por     integer NOT NULL REFERENCES public.usuarios(id),
  fecha_registro     timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  editado            boolean DEFAULT false,
  editado_en         timestamp without time zone,
  editado_por        integer REFERENCES public.usuarios(id),
  creado_en          timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     timestamp without time zone DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT iny_produccion_origen_check
    CHECK (origen IN ('FORMULARIO','IMPORTACION')),
  CONSTRAINT iny_produccion_tipo_check
    CHECK (tipo IN ('PRODUCCION','SCRAP_MODELO')),
  -- Un renglón de producción sí necesita máquina y turno; uno de scrap por
  -- modelo no los tiene y nunca trae producción.
  CONSTRAINT iny_produccion_tipo_campos_check
    CHECK (
      (tipo = 'PRODUCCION'   AND maquina_id IS NOT NULL AND turno_id IS NOT NULL)
      OR
      (tipo = 'SCRAP_MODELO' AND maquina_id IS NULL AND produccion = 0)
    ),
  CONSTRAINT iny_produccion_bu_check
    CHECK (bu_reporte IS NULL OR bu_reporte IN
      ('Crocs Unfin','Crocs Strap','Suela','Almohada','Dual Color')),
  CONSTRAINT iny_produccion_cavidades_check  CHECK (cavidades >= 0),
  CONSTRAINT iny_produccion_produccion_check CHECK (produccion >= 0),
  -- El scrap de producción nunca es negativo, pero el de rezago sí: son
  -- ajustes que corrigen capturas anteriores (1,405 renglones en el histórico,
  -- -5,982.5 pares en total).
  CONSTRAINT iny_produccion_scrap_check
    CHECK (tipo = 'SCRAP_MODELO' OR scrap >= 0),
  -- El contador no puede ir para atrás; ambos NULL se permite (días sin lectura)
  CONSTRAINT iny_produccion_contadores_check
    CHECK (contador_inicial IS NULL OR contador_final IS NULL
           OR contador_final >= contador_inicial)
);

-- Sin UNIQUE natural a propósito: una estación corre varios SKU por turno y el
-- histórico repite (fecha,máquina,estación,turno,SKU) 1,322 veces. El posible
-- duplicado se avisa desde la API, no se bloquea en la BD.
CREATE INDEX IF NOT EXISTS idx_iny_prod_fecha      ON public.iny_produccion (fecha);
CREATE INDEX IF NOT EXISTS idx_iny_prod_bu_fecha   ON public.iny_produccion (bu_reporte, fecha);
CREATE INDEX IF NOT EXISTS idx_iny_prod_modelo     ON public.iny_produccion (modelo_id);
CREATE INDEX IF NOT EXISTS idx_iny_prod_tipo       ON public.iny_produccion (tipo);
CREATE INDEX IF NOT EXISTS idx_iny_prod_maq_fecha  ON public.iny_produccion (maquina_id, fecha);
CREATE INDEX IF NOT EXISTS idx_iny_prod_producto   ON public.iny_produccion (producto_id);
CREATE INDEX IF NOT EXISTS idx_iny_prod_turno      ON public.iny_produccion (turno_id);
CREATE INDEX IF NOT EXISTS idx_iny_prod_carga      ON public.iny_produccion (carga_id);
CREATE INDEX IF NOT EXISTS idx_iny_prod_usuario    ON public.iny_produccion (registrado_por);
-- Para la captura por máquina/turno/día (el formulario abre por esta llave)
CREATE INDEX IF NOT EXISTS idx_iny_prod_captura
  ON public.iny_produccion (fecha, maquina_id, turno_id);

-- ---------------------------------------------------------------------------
-- 7. Vista para los reportes (equivale a la tabla 'Prod y Scrap Inj' del PBI)
--    OJO: 'semana' usa numeración ISO. Falta confirmar que coincida con la
--    que hoy muestra el Power BI antes de dar por buenos los slicers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_iny_produccion AS
SELECT
  p.id,
  p.tipo,
  p.fecha,
  EXTRACT(YEAR  FROM p.fecha)::int  AS anio,
  EXTRACT(MONTH FROM p.fecha)::int  AS mes_num,
  TO_CHAR(p.fecha, 'TMMonth')       AS mes,
  EXTRACT(WEEK  FROM p.fecha)::int  AS semana,
  t.nombre                          AS turno,
  m.codigo                          AS maquina,
  e.codigo                          AS estacion,
  pr.sku,
  pr.descripcion,
  COALESCE(mo.nombre, mop.nombre)   AS modelo,
  COALESCE(p.bu_reporte, pr.bu_reporte, mo.bu_reporte, mop.bu_reporte) AS bu,
  p.cavidades,
  p.ciclos,
  p.produccion,
  p.scrap
FROM public.iny_produccion p
LEFT JOIN public.turnos          t   ON t.id  = p.turno_id
LEFT JOIN public.iny_maquinas    m   ON m.id  = p.maquina_id
LEFT JOIN public.iny_estaciones  e   ON e.id  = p.estacion_id
LEFT JOIN public.iny_productos   pr  ON pr.id = p.producto_id
LEFT JOIN public.modelos         mo  ON mo.id = p.modelo_id
LEFT JOIN public.modelos         mop ON mop.id = pr.modelo_id;

-- ---------------------------------------------------------------------------
-- 8. Registro de los módulos para el sistema de permisos
-- ---------------------------------------------------------------------------
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo)
SELECT 'Producción Inyección',
       'Captura de producción y scrap por máquina, estación y turno',
       'Factory',
       '/produccion/inyeccion',
       true
WHERE NOT EXISTS (
  SELECT 1 FROM public.modulos WHERE nombre = 'Producción Inyección'
);

INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo)
SELECT 'Reportes de Producción',
       'Dashboards de producción y scrap (Inyección)',
       'BarChart3',
       '/produccion/reportes',
       true
WHERE NOT EXISTS (
  SELECT 1 FROM public.modulos WHERE nombre = 'Reportes de Producción'
);

COMMIT;
