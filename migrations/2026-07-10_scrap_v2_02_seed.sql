-- ============================================================================
-- SCRAP V2 — Seed (generado desde 'SECUENCIA DE CAPTURA SCRAP V2.xlsx')
-- Correr DESPUES de 2026-07-10_scrap_v2_01_schema.sql. Idempotente.
-- ============================================================================

BEGIN;

-- Unidades de negocio
INSERT INTO public.unidades_negocio (nombre) VALUES
  ('SUELA'), ('ALMOHADA'), ('DUAL COLOR'), ('CROCS')
ON CONFLICT (nombre) DO NOTHING;

-- Grupos de defecto
INSERT INTO public.grupos_defecto (nombre, descripcion) VALUES
  ('GENERAL',          'Defectos de Suela / Almohada / Dual Color'),
  ('ENSAMBLE',         'Defectos de Crocs - Ensamble'),
  ('DIGITAL_PRINTING', 'Defectos de Crocs - Digital Printing')
ON CONFLICT (nombre) DO NOTHING;


-- Modelos: SUELA
INSERT INTO public.modelos (unidad_negocio_id, nombre)
SELECT (SELECT id FROM public.unidades_negocio WHERE nombre='SUELA'), v.nombre
FROM (VALUES
  ('BALTIMORE'),
  ('BUBBLE'),
  ('BURNET'),
  ('CALIFORNIA'),
  ('CAMINANDO'),
  ('CATALEYA'),
  ('CEREZA'),
  ('CLARET'),
  ('DRUMOND'),
  ('ELBOW'),
  ('EMER'),
  ('EPPING'),
  ('FERGUSON'),
  ('FRONTLINE'),
  ('GINEBRA'),
  ('GIULLIA'),
  ('GRIMS'),
  ('GUDO'),
  ('HENRY'),
  ('INSOLE STAND SANDAL'),
  ('JESSICA'),
  ('JONES'),
  ('KRATOS'),
  ('KRATOS TACON'),
  ('LOOM'),
  ('LORETTA'),
  ('MEEKER'),
  ('MISE'),
  ('MODERN'),
  ('MOWER'),
  ('MOWER DONNA'),
  ('NIZA CABALLERO'),
  ('NIZA DAMA'),
  ('ORLANDO'),
  ('OUTSOLE STAND SANDAL'),
  ('PAYSON'),
  ('PAYSON DONNA'),
  ('PORTOFINO'),
  ('RICHFIELD'),
  ('ROADES'),
  ('ROADES TOP LIFT'),
  ('SEFFY'),
  ('SERENA'),
  ('SOFTSENSE SPORT'),
  ('SPARKLE'),
  ('SPOKANE'),
  ('SPORTIFE'),
  ('STAND GRIP'),
  ('STAND LIGHT'),
  ('STEFFY'),
  ('STEFFY TACON'),
  ('SUPERFLEX'),
  ('TACOMA'),
  ('TACOMA TACON'),
  ('TISHA'),
  ('TRENTINO'),
  ('VERMILLION'),
  ('VERMONT'),
  ('VERONA')
) AS v(nombre)
ON CONFLICT (unidad_negocio_id, nombre) DO NOTHING;


-- Modelos: DUAL COLOR
INSERT INTO public.modelos (unidad_negocio_id, nombre)
SELECT (SELECT id FROM public.unidades_negocio WHERE nombre='DUAL COLOR'), v.nombre
FROM (VALUES
  ('BLOOMFIELD'),
  ('HUMBOLT'),
  ('HURON'),
  ('NORWALK'),
  ('TRENTINO')
) AS v(nombre)
ON CONFLICT (unidad_negocio_id, nombre) DO NOTHING;


-- Modelos: ALMOHADA
INSERT INTO public.modelos (unidad_negocio_id, nombre)
SELECT (SELECT id FROM public.unidades_negocio WHERE nombre='ALMOHADA'), v.nombre
FROM (VALUES
  ('680'),
  ('12"'),
  ('26"'),
  ('780 26'),
  ('AHS FREEFLOW'),
  ('BUFFGROG 2020 SERIES A NECK'),
  ('BULLFROG 2020 SERIES A FILTER'),
  ('BULLFROG 2020 SERIES A MAIN'),
  ('BULLFROG 2020 SERIES A NECK'),
  ('BULLFROG 2022 SERIES A MAIN'),
  ('BULLFROG 2022 SERIES A NECK'),
  ('BULLFROG SERIES M'),
  ('CANCUN'),
  ('CARRIER'),
  ('CASCADE'),
  ('CELEBRITY'),
  ('CHEVRON'),
  ('CONTOUR LOUNGE'),
  ('COSTCO'),
  ('DIMENSION'),
  ('DYNASTY CLUB'),
  ('DYNASTY LOUNGE'),
  ('DYNASTY NECK'),
  ('DYNASTY WRAP'),
  ('DYSNASTY CLUB'),
  ('FREEFLOW'),
  ('GENERIC'),
  ('HIGHLIFE'),
  ('HIGHLIFE 2022'),
  ('HOME'),
  ('HOT SPOT'),
  ('HOT SPOT 2020'),
  ('HTSS COSTCO'),
  ('INFINITY MINI PLAIN'),
  ('INSERT CHEVRON'),
  ('INSERT WRAP'),
  ('J 345'),
  ('J200'),
  ('J200 2017'),
  ('J300 035'),
  ('J300 036'),
  ('J300 2014'),
  ('J300 INNER'),
  ('J300 OUTER'),
  ('J345'),
  ('J400 2006'),
  ('J400 2009'),
  ('J400 2017'),
  ('J500'),
  ('JACK OVAL'),
  ('JACUZZI 2011'),
  ('KREFT 27.5"'),
  ('KREFT 27.5" TRAIL'),
  ('KREFT 29" PRO'),
  ('KREFT 29" TRAIL'),
  ('KREFT 29" XC'),
  ('KREFT PRO 29"'),
  ('KREFT TRAIL 29"'),
  ('KREFT XC 27.5"'),
  ('KREFT XC 29"'),
  ('LA SPAS LOUNGE'),
  ('LA SPAS NECK'),
  ('LIMELIGHT'),
  ('LIMELIGHT 2018'),
  ('LOUNGE FCI'),
  ('LOUNGE ISLAND INNER'),
  ('LOUNGE ISLAND NON LOGO'),
  ('LOUNGE ISLAND OUTER'),
  ('LS LOUNGE'),
  ('MAAX LOUNGE'),
  ('MAAX NECK'),
  ('MAAX VEEP'),
  ('MAAX VITA ADJUSTABLE'),
  ('MAAX VITA COLLAR'),
  ('MAAX VITA LOUNGE'),
  ('MARQUIS CELEBRITY'),
  ('MARQUIS CROWN'),
  ('MARQUIS INNER'),
  ('MARQUIS OUTER'),
  ('MASTER SPAS CHEVRON'),
  ('MAXX VITA LOUNGE'),
  ('MISSION ICON'),
  ('MISSION RONIN'),
  ('MISSION SENTRY'),
  ('NECK ISLAND NO LOGO'),
  ('NEW DIMENSION'),
  ('SD 680'),
  ('SD 780'),
  ('SD 780 2007'),
  ('SD 780 2017'),
  ('SD 780 BLEND NON ADJUSTABLE'),
  ('SD 880 2019'),
  ('SD 880 LOWER'),
  ('SD 880 UPPER'),
  ('SD 980'),
  ('SOLANA'),
  ('SOUTH SEAS LOUNGE'),
  ('SOUTH SEAS NECK'),
  ('SPEAKER'),
  ('VACANZA'),
  ('VECTOR INNER'),
  ('VECTOR OUTER'),
  ('VIKING BATWING'),
  ('WATERFALL ISLAND'),
  ('WIND RIVER'),
  ('WRAP FCI'),
  ('WRAP SUNDANCE')
) AS v(nombre)
ON CONFLICT (unidad_negocio_id, nombre) DO NOTHING;


-- Defectos: GENERAL (Suela/Almohada/Dual Color)
INSERT INTO public.tipos_defectos (nombre, grupo_defecto_id, activo)
SELECT v.nombre, (SELECT id FROM public.grupos_defecto WHERE nombre='GENERAL'), true
FROM (VALUES
  ('BURBUJA'),
  ('CONTAMINADO'),
  ('FALTA DE PIN'),
  ('GOLPE DE MOLDE'),
  ('HOYO'),
  ('LINEA DE CIERRE'),
  ('LONGITUD'),
  ('MARCA DE MOLDE'),
  ('MARMOL'),
  ('MORDIDO'),
  ('PARES O PZAS FALTANTES'),
  ('PIN DESPEGADO'),
  ('PREPACK EQUIVOCADO'),
  ('PUNTO DE INYECCIÓN'),
  ('PUNTOS CAMBIADOS'),
  ('QUEMADA'),
  ('RAFAGA'),
  ('REBABA'),
  ('RESEQUEDAD'),
  ('SARRO'),
  ('TALLAS REVUELTAS'),
  ('TAMAÑO'),
  ('TAPON BASURA'),
  ('TONO'),
  ('TROZADO')
) AS v(nombre)
ON CONFLICT (nombre, grupo_defecto_id) DO NOTHING;


-- Defectos: ENSAMBLE (Crocs)
INSERT INTO public.tipos_defectos (nombre, grupo_defecto_id, activo)
SELECT v.nombre, (SELECT id FROM public.grupos_defecto WHERE nombre='ENSAMBLE'), true
FROM (VALUES
  ('GANCHO EQUIVOCADO'),
  ('HANGTAG EQUIVOCADO'),
  ('JASPEADO'),
  ('MAL DE MEDIDA'),
  ('MANCHAS OPACAS'),
  ('MOLDES REVUELTOS'),
  ('PREPACK EQUIVOCADO'),
  ('PUNTO DE INYECCION'),
  ('QUEMADO'),
  ('RAYADO'),
  ('REBABA EN CUADROS'),
  ('REBABA EN EMPEINE'),
  ('REBABA EN LATERAL'),
  ('REBABA EN LETRAS'),
  ('REBABA EN ORIFICIOS'),
  ('REBABA EN STRAP'),
  ('REBABA EN TALON'),
  ('RESIDUO DE CINTA'),
  ('ROTA EN CUADRO'),
  ('SIN HANGTAG'),
  ('SIN STRAP'),
  ('STRAP IMPAR "TM"'),
  ('STRAP SAFADO'),
  ('STRAP SUCIO'),
  ('SUCIO'),
  ('TALLAS REVUELTAS'),
  ('TALON JALADO'),
  ('TAPON BASURA'),
  ('TONO DE SUELA'),
  ('TONO STRAP'),
  ('VOLUMEN'),
  ('CONTAMINADO')
) AS v(nombre)
ON CONFLICT (nombre, grupo_defecto_id) DO NOTHING;


-- Defectos: DIGITAL_PRINTING (Crocs)
INSERT INTO public.tipos_defectos (nombre, grupo_defecto_id, activo)
SELECT v.nombre, (SELECT id FROM public.grupos_defecto WHERE nombre='DIGITAL_PRINTING'), true
FROM (VALUES
  ('BURBUJAS EN FILM'),
  ('EXCESO DE ADHESIVO EN STRAP'),
  ('EXCESO DE ADHESIVO EN SUELA'),
  ('EXCESO DE FILM EN COLLAR'),
  ('EXCESO DE FILM EN EMPEINE'),
  ('EXCESO DE FILM EN LATERAL'),
  ('EXCESO DE FILM EN PISO'),
  ('EXCESO DE FILM EN PUNTA'),
  ('EXCESO DE FILM EN STRAP'),
  ('EXCESO DE FILM EN SUELA'),
  ('EXCESO DE FILM EN TALON'),
  ('FALTA DE FILM EN COLLAR'),
  ('FALTA DE FILM EN EMPEINE'),
  ('FALTA DE FILM EN LATERAL'),
  ('FALTA DE FILM EN PUNTA'),
  ('FALTA DE FILM EN STRAP'),
  ('FALTA DE FILM EN TALON'),
  ('FILM EN CUADRO'),
  ('FILM EN ORIFICIOS'),
  ('GANCHO EQUIVOCADO'),
  ('HANGTAG EQUIVOCADO'),
  ('JASPEADO'),
  ('MAL DE MEDIDA'),
  ('MANCHAS DE LAVADOR'),
  ('MANCHAS OPACAS'),
  ('MOLDES REVUELTOS'),
  ('PREPACK EQUIVOCADO'),
  ('PUNTO DE INYECCION'),
  ('QUEMADO'),
  ('RAYADO'),
  ('REBABA EN CUADROS'),
  ('REBABA EN EMPEINE'),
  ('REBABA EN LATERAL'),
  ('REBABA EN LETRAS'),
  ('REBABA EN ORIFICIOS'),
  ('REBABA EN STRAP'),
  ('REBABA EN TALON'),
  ('RESIDUO DE CINTA'),
  ('ROTA EN CUADRO'),
  ('SIN HANGTAG'),
  ('SIN STRAP'),
  ('STRAP IMPAR "TM"'),
  ('STRAP SAFADO'),
  ('STRAP SUCIO'),
  ('SUCIO'),
  ('TALLAS REVUELTAS'),
  ('TALON JALADO'),
  ('TAPON BASURA'),
  ('TONO DE SUELA'),
  ('TONO STRAP'),
  ('VOLUMEN')
) AS v(nombre)
ON CONFLICT (nombre, grupo_defecto_id) DO NOTHING;


COMMIT;
