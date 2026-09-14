-- ==========================================================================
-- PRODUCCIÓN INYECCIÓN — Modelos faltantes
--
-- Da de alta los 186 modelos que el histórico de inyección usa y que no
-- existen en la tabla 'modelos'.
--
-- SEPARADO A PROPÓSITO: 'modelos' la comparte el módulo de Scrap, así que
-- estos modelos también aparecerán en su catálogo de Suela / Almohada /
-- Dual Color. Correr solo cuando eso esté confirmado.
--
-- El módulo de inyección NO depende de este archivo: la BU del reporte viaja
-- en iny_productos.bu_reporte, no en el modelo.
--
-- Idempotente.
-- ==========================================================================

BEGIN;

INSERT INTO public.modelos (unidad_negocio_id, nombre, bu_reporte, activo)
SELECT u.id, v.nombre, v.bu, true
FROM (VALUES
  ('BLAINE', 'Suela', 'SUELA'),   --     175 registros
  ('BLAINE TACON', 'Suela', 'SUELA'),   --      41 registros
  ('CLIPPER', 'Suela', 'SUELA'),   --       1 registros
  ('FREMONT', 'Suela', 'SUELA'),   --       5 registros
  ('FREMONT TACCO', 'Suela', 'SUELA'),   --       5 registros
  ('JUNIPER', 'Suela', 'SUELA'),   --      14 registros
  ('KRATOS CUADRA', 'Suela', 'SUELA'),   --     123 registros
  ('KRATOS TACCO CUADRA', 'Suela', 'SUELA'),   --      68 registros
  ('MOWER UOMO', 'Suela', 'SUELA'),   --     173 registros
  ('PORTOFINO CUADRA', 'Suela', 'SUELA'),   --      35 registros
  ('PROLINE', 'Almohada', 'ALMOHADA'),   --     148 registros
  ('RANGER CUADRA', 'Suela', 'SUELA'),   --      13 registros
  ('SD 780 26', 'Almohada', 'ALMOHADA'),   --     226 registros
  ('SOFTSENSE', 'Suela', 'SUELA'),   --     186 registros
  ('STEFY', 'Suela', 'SUELA'),   --     908 registros
  ('STEFY TACCO', 'Suela', 'SUELA'),   --     101 registros
  ('STEFY TACON', 'Suela', 'SUELA'),   --     180 registros
  ('STRAP BAYA ADULTO', 'Crocs Strap', 'CROCS'),   --       1 registros
  ('STRAP BAYA KIDS', 'Crocs Strap', 'CROCS'),   --       4 registros
  ('STRAP CLASSIC ADULTO', 'Crocs Strap', 'CROCS'),   --  27,795 registros
  ('STRAP CLASSIC KIDS', 'Crocs Strap', 'CROCS'),   --  15,624 registros
  ('TACCO RANGER CUADRA', 'Suela', 'SUELA'),   --       6 registros
  ('TITANIUM', 'Suela', 'SUELA'),   --       2 registros
  ('UNFIN 12"', 'Almohada', 'ALMOHADA'),   --      83 registros
  ('UNFIN 26"', 'Almohada', 'ALMOHADA'),   --      63 registros
  ('UNFIN AKRON', 'Suela', 'SUELA'),   --       3 registros
  ('UNFIN ALPENA', 'Suela', 'SUELA'),   --      10 registros
  ('UNFIN BAYA ADULTO', 'Crocs Unfin', 'CROCS'),   --  17,899 registros
  ('UNFIN BAYA KIDS', 'Crocs Unfin', 'CROCS'),   --  16,000 registros
  ('UNFIN BENSON', 'Suela', 'SUELA'),   --      14 registros
  ('UNFIN BLOOMFIELD', 'Dual Color', 'DUAL COLOR'),   --     351 registros
  ('UNFIN BULLFROG 2020 SERIES A FILTER', 'Almohada', 'ALMOHADA'),   --     304 registros
  ('UNFIN BULLFROG 2020 SERIES A MAIN', 'Almohada', 'ALMOHADA'),   --   1,358 registros
  ('UNFIN BULLFROG 2020 SERIES A NECK', 'Almohada', 'ALMOHADA'),   --     417 registros
  ('UNFIN BULLFROG 2022 SERIES A MAIN', 'Almohada', 'ALMOHADA'),   --   3,947 registros
  ('UNFIN BULLFROG 2022 SERIES A NECK', 'Almohada', 'ALMOHADA'),   --   1,041 registros
  ('UNFIN BULLFROG 2022 SERIES R MAIN', 'Almohada', 'ALMOHADA'),   --       1 registros
  ('UNFIN BULLFROG 2023 SERIES R MAIN', 'Almohada', 'ALMOHADA'),   --       1 registros
  ('UNFIN BULLFROG SERIES A', 'Almohada', 'ALMOHADA'),   --       4 registros
  ('UNFIN BULLFROG SERIES M', 'Almohada', 'ALMOHADA'),   --     685 registros
  ('UNFIN BULLFROG SERIES R', 'Almohada', 'ALMOHADA'),   --       1 registros
  ('UNFIN BULLFROG SERIES R NECK', 'Almohada', 'ALMOHADA'),   --       1 registros
  ('UNFIN CANCUN', 'Almohada', 'ALMOHADA'),   --      18 registros
  ('UNFIN CARRIER', 'Almohada', 'ALMOHADA'),   --     209 registros
  ('UNFIN CASCADE', 'Almohada', 'ALMOHADA'),   --      95 registros
  ('UNFIN CELEBRITY', 'Almohada', 'ALMOHADA'),   --     182 registros
  ('UNFIN CHEVRON', 'Almohada', 'ALMOHADA'),   --     156 registros
  ('UNFIN CLASSIC ADULTO', 'Crocs Unfin', 'CROCS'),   -- 102,023 registros
  ('UNFIN CLASSIC KIDS', 'Crocs Unfin', 'CROCS'),   --  42,654 registros
  ('UNFIN COMMANDO', 'Suela', 'SUELA'),   --      44 registros
  ('UNFIN COSTCO', 'Almohada', 'ALMOHADA'),   --      97 registros
  ('UNFIN DOYLE', 'Suela', 'SUELA'),   --       4 registros
  ('UNFIN DULUTH', 'Suela', 'SUELA'),   --      16 registros
  ('UNFIN DUNOON', 'Suela', 'SUELA'),   --      15 registros
  ('UNFIN DYER', 'Suela', 'SUELA'),   --      17 registros
  ('UNFIN DYNASTY CLUB', 'Almohada', 'ALMOHADA'),   --     184 registros
  ('UNFIN DYNASTY LOUNGE', 'Almohada', 'ALMOHADA'),   --     330 registros
  ('UNFIN DYNASTY NECK', 'Almohada', 'ALMOHADA'),   --      74 registros
  ('UNFIN DYNASTY WRAP', 'Almohada', 'ALMOHADA'),   --     122 registros
  ('UNFIN ELBOW', 'Suela', 'SUELA'),   --      61 registros
  ('UNFIN EPPING', 'Suela', 'SUELA'),   --       3 registros
  ('UNFIN EXO', 'Suela', 'SUELA'),   --       1 registros
  ('UNFIN FREEFLOW', 'Almohada', 'ALMOHADA'),   --      48 registros
  ('UNFIN FRONTLINE', 'Suela', 'SUELA'),   --     167 registros
  ('UNFIN GALES PROLINE', 'Suela', 'SUELA'),   --       2 registros
  ('UNFIN GARVE', 'Suela', 'SUELA'),   --      10 registros
  ('UNFIN GENERIC', 'Almohada', 'ALMOHADA'),   --     168 registros
  ('UNFIN GENESYS', 'Almohada', 'ALMOHADA'),   --      58 registros
  ('UNFIN GILBY', 'Suela', 'SUELA'),   --      17 registros
  ('UNFIN GIULLIA', 'Dual Color', 'DUAL COLOR'),   --     993 registros
  ('UNFIN GRAVEL', 'Almohada', 'ALMOHADA'),   --       3 registros
  ('UNFIN GUDO', 'Suela', 'SUELA'),   --       3 registros
  ('UNFIN HEAD NO DOME', 'Almohada', 'ALMOHADA'),   --     140 registros
  ('UNFIN HENRY', 'Suela', 'SUELA'),   --      87 registros
  ('UNFIN HIGHLIFE', 'Almohada', 'ALMOHADA'),   --     696 registros
  ('UNFIN HIGHLIFE 2022', 'Almohada', 'ALMOHADA'),   --   1,642 registros
  ('UNFIN HOME', 'Almohada', 'ALMOHADA'),   --     434 registros
  ('UNFIN HOT SPOT', 'Almohada', 'ALMOHADA'),   --     684 registros
  ('UNFIN HOT SPOT 2020', 'Almohada', 'ALMOHADA'),   --   2,163 registros
  ('UNFIN HR', 'Suela', 'SUELA'),   --     373 registros
  ('UNFIN HTSS COSTCO', 'Almohada', 'ALMOHADA'),   --     251 registros
  ('UNFIN HUMBOLT', 'Suela', 'SUELA'),   --     954 registros
  ('UNFIN HURON', 'Dual Color', 'DUAL COLOR'),   --      81 registros
  ('UNFIN INFINITY MINI PLAIN', 'Almohada', 'ALMOHADA'),   --      24 registros
  ('UNFIN INSERT CHEVRON', 'Almohada', 'ALMOHADA'),   --      60 registros
  ('UNFIN INSERT WRAP', 'Almohada', 'ALMOHADA'),   --      57 registros
  ('UNFIN IRVINE', 'Suela', 'SUELA'),   --      10 registros
  ('UNFIN ITHACA', 'Suela', 'SUELA'),   --       9 registros
  ('UNFIN J200', 'Almohada', 'ALMOHADA'),   --     373 registros
  ('UNFIN J300 035', 'Almohada', 'ALMOHADA'),   --     294 registros
  ('UNFIN J300 036', 'Almohada', 'ALMOHADA'),   --   1,402 registros
  ('UNFIN J300 2014', 'Almohada', 'ALMOHADA'),   --     215 registros
  ('UNFIN J300 INNER', 'Almohada', 'ALMOHADA'),   --     103 registros
  ('UNFIN J300 OUTER', 'Almohada', 'ALMOHADA'),   --     366 registros
  ('UNFIN J345', 'Almohada', 'ALMOHADA'),   --   1,168 registros
  ('UNFIN J400 2006', 'Almohada', 'ALMOHADA'),   --     235 registros
  ('UNFIN J400 2009', 'Almohada', 'ALMOHADA'),   --     203 registros
  ('UNFIN J400 2017', 'Almohada', 'ALMOHADA'),   --     947 registros
  ('UNFIN J500', 'Almohada', 'ALMOHADA'),   --     148 registros
  ('UNFIN JAC OVAL', 'Almohada', 'ALMOHADA'),   --      11 registros
  ('UNFIN JACUZZI 2011', 'Almohada', 'ALMOHADA'),   --     139 registros
  ('UNFIN KREFT 27.5"', 'Almohada', 'ALMOHADA'),   --     207 registros
  ('UNFIN KREFT PLUS 29"', 'Almohada', 'ALMOHADA'),   --      18 registros
  ('UNFIN KREFT PRO 29"', 'Almohada', 'ALMOHADA'),   --     221 registros
  ('UNFIN KREFT TRAIL 27.5"', 'Almohada', 'ALMOHADA'),   --      21 registros
  ('UNFIN KREFT TRAIL 29"', 'Almohada', 'ALMOHADA'),   --     109 registros
  ('UNFIN KREFT XC 27.5"', 'Almohada', 'ALMOHADA'),   --      19 registros
  ('UNFIN KREFT XC 29"', 'Almohada', 'ALMOHADA'),   --      60 registros
  ('UNFIN LA SPAS LOUNGE', 'Almohada', 'ALMOHADA'),   --      87 registros
  ('UNFIN LA SPAS NECK', 'Almohada', 'ALMOHADA'),   --      12 registros
  ('UNFIN LADAKH', 'Suela', 'SUELA'),   --       7 registros
  ('UNFIN LEA', 'Suela', 'SUELA'),   --       9 registros
  ('UNFIN LEGACY', 'Suela', 'SUELA'),   --       2 registros
  ('UNFIN LIMELIGHT', 'Almohada', 'ALMOHADA'),   --     532 registros
  ('UNFIN LIMELIGHT 2018', 'Almohada', 'ALMOHADA'),   --   2,450 registros
  ('UNFIN LOOM', 'Suela', 'SUELA'),   --      26 registros
  ('UNFIN LOUNGE FCI', 'Almohada', 'ALMOHADA'),   --     101 registros
  ('UNFIN LOUNGE ISLAND INNER', 'Almohada', 'ALMOHADA'),   --     116 registros
  ('UNFIN LOUNGE ISLAND NO LOGO', 'Almohada', 'ALMOHADA'),   --      81 registros
  ('UNFIN LOUNGE ISLAND OUTER', 'Almohada', 'ALMOHADA'),   --     208 registros
  ('UNFIN LOUNGER NO DOME', 'Almohada', 'ALMOHADA'),   --      46 registros
  ('UNFIN LS LOUNGE', 'Almohada', 'ALMOHADA'),   --      32 registros
  ('UNFIN LS NECK', 'Almohada', 'ALMOHADA'),   --       1 registros
  ('UNFIN MAAX LOUNGE', 'Almohada', 'ALMOHADA'),   --     316 registros
  ('UNFIN MAAX NECK', 'Almohada', 'ALMOHADA'),   --     532 registros
  ('UNFIN MAAX VEEP', 'Almohada', 'ALMOHADA'),   --      84 registros
  ('UNFIN MAAX VITA ADJUSTABLE', 'Almohada', 'ALMOHADA'),   --     613 registros
  ('UNFIN MAAX VITA COLLAR', 'Almohada', 'ALMOHADA'),   --      56 registros
  ('UNFIN MAAX VITA LOUNGE', 'Almohada', 'ALMOHADA'),   --     371 registros
  ('UNFIN MARQUIS CROWN', 'Almohada', 'ALMOHADA'),   --     116 registros
  ('UNFIN MARQUIS INNER', 'Almohada', 'ALMOHADA'),   --     234 registros
  ('UNFIN MARQUIS OUTER', 'Almohada', 'ALMOHADA'),   --     237 registros
  ('UNFIN MASTER SPAS CHEVRON', 'Almohada', 'ALMOHADA'),   --     193 registros
  ('UNFIN MELDGES', 'Suela', 'SUELA'),   --       9 registros
  ('UNFIN MILACA', 'Suela', 'SUELA'),   --       8 registros
  ('UNFIN MISSION SENTRY', 'Almohada', 'ALMOHADA'),   --   6,186 registros
  ('UNFIN MOWER DONNA', 'Suela', 'SUELA'),   --     163 registros
  ('UNFIN MOWER UOMO', 'Suela', 'SUELA'),   --      37 registros
  ('UNFIN NECK ISLAND NO LOGO', 'Almohada', 'ALMOHADA'),   --     310 registros
  ('UNFIN NEW DIMENSION', 'Almohada', 'ALMOHADA'),   --     238 registros
  ('UNFIN NEW SWEETWATER', 'Almohada', 'ALMOHADA'),   --      41 registros
  ('UNFIN NEWBERRY', 'Suela', 'SUELA'),   --       5 registros
  ('UNFIN NIZA CABALLERO', 'Suela', 'SUELA'),   --   1,572 registros
  ('UNFIN NIZA DAMA', 'Suela', 'SUELA'),   --     652 registros
  ('UNFIN OLD DIMENSION', 'Almohada', 'ALMOHADA'),   --      39 registros
  ('UNFIN OLD SWEETWATER', 'Almohada', 'ALMOHADA'),   --       6 registros
  ('UNFIN OVAL IMPERIAL', 'Almohada', 'ALMOHADA'),   --      16 registros
  ('UNFIN OVAL WARPED 2012', 'Almohada', 'ALMOHADA'),   --      40 registros
  ('UNFIN ROADES', 'Suela', 'SUELA'),   --   1,597 registros
  ('UNFIN RONIN', 'Almohada', 'ALMOHADA'),   --     889 registros
  ('UNFIN SD 680', 'Almohada', 'ALMOHADA'),   --     348 registros
  ('UNFIN SD 780', 'Almohada', 'ALMOHADA'),   --     223 registros
  ('UNFIN SD 780 2017', 'Almohada', 'ALMOHADA'),   --     808 registros
  ('UNFIN SD 780 BLEND NON-ADJUSTABLE', 'Almohada', 'ALMOHADA'),   --     607 registros
  ('UNFIN SD 880 2018', 'Almohada', 'ALMOHADA'),   --      75 registros
  ('UNFIN SD 880 2019', 'Almohada', 'ALMOHADA'),   --     777 registros
  ('UNFIN SD 880 LOUNGE UPPER', 'Almohada', 'ALMOHADA'),   --      35 registros
  ('UNFIN SD 880 LOWER', 'Almohada', 'ALMOHADA'),   --     100 registros
  ('UNFIN SD 880 UPPER', 'Almohada', 'ALMOHADA'),   --      78 registros
  ('UNFIN SD 980', 'Almohada', 'ALMOHADA'),   --      48 registros
  ('UNFIN SOFTSENSE SPORT', 'Suela', 'SUELA'),   --       8 registros
  ('UNFIN SOLANA', 'Almohada', 'ALMOHADA'),   --     422 registros
  ('UNFIN SOUTH SEAS LOUNGE', 'Almohada', 'ALMOHADA'),   --   1,045 registros
  ('UNFIN SOUTH SEAS NECK', 'Almohada', 'ALMOHADA'),   --      80 registros
  ('UNFIN SPEAKER', 'Almohada', 'ALMOHADA'),   --     204 registros
  ('UNFIN STAND GRIP', 'Suela', 'SUELA'),   --   1,602 registros
  ('UNFIN STAND LIGHT', 'Suela', 'SUELA'),   --   9,063 registros
  ('UNFIN STEFY CUADRA', 'Suela', 'SUELA'),   --      69 registros
  ('UNFIN STEFY TACON', 'Suela', 'SUELA'),   --     186 registros
  ('UNFIN STRATTON', 'Suela', 'SUELA'),   --       2 registros
  ('UNFIN SUNDANCE 2011', 'Almohada', 'ALMOHADA'),   --      19 registros
  ('UNFIN SUPERFLEX', 'Suela', 'SUELA'),   --      20 registros
  ('UNFIN TACOMA', 'Suela', 'SUELA'),   --     796 registros
  ('UNFIN TACOMA TACON', 'Suela', 'SUELA'),   --     369 registros
  ('UNFIN TILE', 'Almohada', 'ALMOHADA'),   --      15 registros
  ('UNFIN TOOLE', 'Suela', 'SUELA'),   --      15 registros
  ('UNFIN TOPLIFT ROADES', 'Suela', 'SUELA'),   --     947 registros
  ('UNFIN TRENTINO', 'Dual Color', 'DUAL COLOR'),   --   5,513 registros
  ('UNFIN TWILIGHT FLEX', 'Almohada', 'ALMOHADA'),   --      31 registros
  ('UNFIN VECTOR OUTER', 'Almohada', 'ALMOHADA'),   --     210 registros
  ('UNFIN VIKING BATWING', 'Almohada', 'ALMOHADA'),   --      45 registros
  ('UNFIN WATERFALL ISLAND', 'Almohada', 'ALMOHADA'),   --     259 registros
  ('UNFIN WATERFALL ISLAND 2013', 'Almohada', 'ALMOHADA'),   --      16 registros
  ('UNFIN WIND RIVER', 'Almohada', 'ALMOHADA'),   --     185 registros
  ('UNFIN WRAP FCI', 'Almohada', 'ALMOHADA'),   --      18 registros
  ('UNFIN WRAP SUNDANCE', 'Almohada', 'ALMOHADA')   --     203 registros
) AS v(nombre, bu, unidad)
JOIN public.unidades_negocio u ON u.nombre = v.unidad
ON CONFLICT (unidad_negocio_id, nombre) DO NOTHING;

COMMIT;
