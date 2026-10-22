-- ============================================================================
-- CHECADAS — Esquema
--
-- RH descarga del sistema de Hikvision el reporte "Transacciones" después de
-- cada cambio de turno (por ejemplo, a las 8:20, las checadas de 7:50 a 8:20) y
-- lo sube aquí. El reporte de Hikvision trae ID, nombre, departamento, fecha,
-- hora y lector, pero NO trae el turno: DBX lo asigna al consultar.
--
-- ---------------------------------------------------------------------------
-- EL TURNO NO SE SACA POR RANGO DE HORA
-- ---------------------------------------------------------------------------
-- Con los turnos C 00:00–08:00, A 08:00–16:00 y B 16:00–24:00, una checada de
-- las 07:51 cae en el rango del C, pero es alguien que entra al A. Y quien
-- checa a las 23:45 entra al C del DÍA SIGUIENTE. En el primer archivo de
-- prueba, 276 de 432 checadas eran de antes de las 8:00.
--
-- Por eso la checada se asigna al turno cuyo INICIO está más cerca, y con eso
-- sale también cuántos minutos llegó antes o después. Se calcula al consultar
-- (no se guarda) para que un cambio en `chk_turnos` corrija todo lo cargado.
--
-- Idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Turnos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chk_turnos (
  clave           varchar(5)   PRIMARY KEY,
  nombre          varchar(40)  NOT NULL,
  inicio          time         NOT NULL,
  fin             time         NOT NULL,
  -- Minutos después del inicio que todavía cuentan como "en tolerancia"
  tolerancia_min  smallint     NOT NULL DEFAULT 20,
  orden           smallint     NOT NULL DEFAULT 0
);

INSERT INTO public.chk_turnos (clave, nombre, inicio, fin, tolerancia_min, orden) VALUES
  ('C', 'Turno C', '00:00', '08:00', 20, 1),
  ('A', 'Turno A', '08:00', '16:00', 20, 2),
  ('B', 'Turno B', '16:00', '23:59:59', 20, 3)
ON CONFLICT (clave) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Bitácora de cargas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chk_cargas (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  archivo         varchar(255),
  -- Lo que dice el encabezado del reporte de Hikvision
  periodo_desde   date,
  periodo_hasta   date,
  exportado_en    timestamp,
  filas_leidas    integer      NOT NULL DEFAULT 0,
  filas_nuevas    integer      NOT NULL DEFAULT 0,
  -- Ya estaban cargadas (mismo archivo subido otra vez, o ventanas que se enciman)
  ya_cargadas     integer      NOT NULL DEFAULT 0,
  usuario_id      integer      REFERENCES public.usuarios (id),
  creado_en       timestamp    NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. Checadas, tal como las da Hikvision (limpias)
--
--    Una checada = empleado + fecha + hora + lector. Subir el mismo archivo dos
--    veces, o dos ventanas que se enciman, no duplica nada.
--
--    Se guardan TODAS, también las repetidas de la misma persona (dos o tres
--    pasadas seguidas por el lector): el reporte toma la primera por turno.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chk_transacciones (
  id                 bigserial    PRIMARY KEY,
  empleado_id        varchar(20)  NOT NULL,
  nombre             varchar(160),
  -- El último nivel de "All Departments>PLANEACION>MRP SUPPORT>MANTENIMIENTO"
  departamento       varchar(120),
  -- La ruta completa sin "All Departments>", para cuando haga falta el detalle
  departamento_ruta  varchar(300),
  fecha              date         NOT NULL,
  hora               time         NOT NULL,
  -- El lector tal como viene ("7_Door_1-Cardreader 01")
  punto              varchar(120) NOT NULL DEFAULT '',
  carga_id           uuid         REFERENCES public.chk_cargas (id),
  creado_en          timestamp    NOT NULL DEFAULT now(),
  CONSTRAINT chk_transacciones_unica UNIQUE (empleado_id, fecha, hora, punto)
);

CREATE INDEX IF NOT EXISTS idx_chk_trans_fecha ON public.chk_transacciones (fecha, hora);
CREATE INDEX IF NOT EXISTS idx_chk_trans_empleado ON public.chk_transacciones (empleado_id, fecha);

-- ---------------------------------------------------------------------------
-- 4. Módulos
-- ---------------------------------------------------------------------------
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Reportes de Checadas',
       'Quién checó en cada turno, a tiempo, en tolerancia o con retardo',
       'Clock',
       '/checadas/reportes',
       true,
       28
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/checadas/reportes');

INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Carga de Checadas',
       'Subida del reporte de Transacciones de Hikvision',
       'Upload',
       '/checadas/carga',
       true,
       29
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/checadas/carga');

COMMIT;
