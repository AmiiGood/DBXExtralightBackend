-- ============================================================================
-- ARCHIVOS DE SHAREPOINT — Esquema
--
-- Cuarto patrón de origen del proyecto, hermano del de Customer Service:
--
--   carga manual por pantalla   STAFF, Resultados, Compound, Inyección
--   réplica de base externa     Moldes, TI (osTicket)
--   carpeta de red vigilada     Customer Service
--   SharePoint vigilado         ESTE: Compound e Inyección, por ahora
--
-- Los libros de Compound e Inyección viven en SharePoint de Finproject y había
-- que bajarlos y subirlos a mano por la pantalla de carga. Aquí el servidor los
-- consulta por Microsoft Graph y, si cambiaron, se los pasa al MISMO importador
-- que usa la pantalla. No hay un segundo camino de importación: las reglas de
-- reemplazo (solo el rango de fechas del archivo, solo lo que vino de una
-- importación previa) son exactamente las de la carga manual.
--
-- Es genérico a propósito: cada renglón dice a qué importador va su archivo,
-- así que sumar STAFF o Resultados es dar de alta su importador en el servicio
-- y un renglón aquí, no otra tabla.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ NO SE DESCARGA EL ARCHIVO EN CADA VUELTA
-- ---------------------------------------------------------------------------
-- SharePoint publica un hash del contenido (quickXorHash) en los metadatos del
-- archivo. Se compara eso, así que una vuelta sin cambios cuesta una consulta
-- de metadatos y no bajar los ~28 MB del libro de Inyección.
--
-- Idempotente. Correr ANTES del seed (02_seed).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Qué archivos se vigilan y cómo se encontraron la última vez
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sp_archivos (
  clave           varchar(30)  PRIMARY KEY,
  nombre          varchar(80)  NOT NULL,

  -- A qué importador se le pasa el archivo. Lo valida el servicio y no un
  -- CHECK, para que sumar uno nuevo no pida migración.
  importador      varchar(30)  NOT NULL,

  -- La carpeta tal como se copia de la barra del navegador, p. ej.
  -- https://finprojectspa.sharepoint.com/sites/FCMX/Shared Documents/Compound
  -- El servicio saca de ahí el sitio, la biblioteca y la ruta.
  ubicacion       varchar(800) NOT NULL DEFAULT '',
  archivo         varchar(200) NOT NULL,

  -- Nace apagado: sin la app registrada en Azure no hay con qué entrar.
  activo          boolean      NOT NULL DEFAULT false,

  -- Estado de la última lectura
  huella          varchar(100),
  tamano_bytes    bigint,
  modificado_en   timestamp,
  modificado_por  varchar(120),
  leido_en        timestamp,
  filas           integer,
  resumen         text,
  ultimo_error    text,
  error_en        timestamp,

  -- La huella del contenido con el que falló el importador. Mientras el
  -- archivo siga igual no se vuelve a intentar: reintentar es bajar otra vez
  -- 28 MB para llegar al mismo error, cada vuelta, todo el día.
  huella_error    varchar(100),

  actualizado_en  timestamp    NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sp_archivos IS
  'Archivos de SharePoint que se vigilan por Microsoft Graph y se pasan al importador de su reporte.';
COMMENT ON COLUMN public.sp_archivos.ubicacion IS
  'URL de la carpeta como se copia del navegador. Puede ser la vista de la biblioteca (Forms/AllItems.aspx?id=...).';
COMMENT ON COLUMN public.sp_archivos.huella IS
  'quickXorHash que publica SharePoint (o cTag si no viene). Se baja el archivo solo si cambia.';
COMMENT ON COLUMN public.sp_archivos.huella_error IS
  'Huella del contenido que hizo fallar al importador. No se reintenta hasta que el archivo cambie.';

-- ---------------------------------------------------------------------------
-- 2. Bitácora de revisiones
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sp_sincronizaciones (
  id             uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  clave          varchar(30),
  archivo        varchar(200),
  iniciada_en    timestamp  NOT NULL DEFAULT now(),
  terminada_en   timestamp,
  exito          boolean,
  -- false cuando el archivo no había cambiado y no se bajó nada
  hubo_cambio    boolean    NOT NULL DEFAULT false,
  filas_cargadas integer    NOT NULL DEFAULT 0,
  duracion_ms    integer,
  mensaje        text,
  usuario_id     integer    REFERENCES public.usuarios (id)
);

CREATE INDEX IF NOT EXISTS idx_sp_sinc_iniciada ON public.sp_sincronizaciones (iniciada_en DESC);

-- ---------------------------------------------------------------------------
-- 3. Módulo
--
--    Uno solo para todas las áreas: lo que se configura aquí es de dónde sale
--    el dato, y eso lo administra quien administra el sistema, no cada área.
-- ---------------------------------------------------------------------------
INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Archivos de SharePoint',
       'Qué archivos de SharePoint se leen solos y a qué reporte van',
       'Cloud',
       '/admin/sharepoint',
       true,
       23
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/admin/sharepoint');

COMMIT;
