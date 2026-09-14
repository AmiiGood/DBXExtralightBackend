-- ============================================================================
-- CARGA MASIVA DE ARTÍCULOS — Seed de catálogos
-- Fuentes: "Estilo-Tallas-SP-Colores 2026.xlsx" (LISTA DE COLORES) y catálogo
-- UNFIN / STRAP / PRODUCTO TERMINADO proporcionado por Alexis (jul 2026).
--
-- NOTA sobre cat_tallas_equivalencias: los sufijos numéricos se derivaron de
-- los archivos de ejemplo (214 Taupe y 30T Crocs Green):
--   Unfin:  M2W4→102 ... M13→113 (100+n) · C4→104 ... C13→113 · J1→121 ... J6→126
--   Strap adulto: M2→032 ... M13→043 (030+n) · Strap kids: mismo sufijo que unfin
-- Verificar contra el catálogo oficial de tallas equivalentes cuando esté
-- disponible y corregir aquí si difiere.
--
-- Idempotente (ON CONFLICT DO NOTHING: no pisa ediciones manuales).
-- Correr DESPUÉS del archivo de esquema (01_schema).
-- ============================================================================

BEGIN;

-- Colores ------------------------------------------------------------
INSERT INTO public.cat_colores (codigo, nombre) VALUES
  ('001', 'Black'),
  ('007', 'Light Grey'),
  ('014', 'Graphite'),
  ('0DA', 'Slate Grey'),
  ('0HZ', 'Linen'),
  ('0Z3', 'Concrete'),
  ('100', 'White'),
  ('103', 'Marbed White/Black'),
  ('160', 'Stucco'),
  ('1FT', 'Atmosphere'),
  ('1LM', 'Elephant'),
  ('200', 'Chocolate'),
  ('206', 'Espresso'),
  ('209', 'Wheat'),
  ('21Q', 'Coffee'),
  ('260', 'Khaki'),
  ('2DS', 'Shitake'),
  ('2JJ', 'Milk Chocolate'),
  ('2MC', 'Frappé'),
  ('2Q9', 'Latte'),
  ('2V3', 'Cobblestone'),
  ('2Y2', 'Bone'),
  ('302', 'Emerald'),
  ('308', 'Moss'),
  ('309', 'Army Green'),
  ('335', 'Celery'),
  ('3AC', 'Dark Algae'),
  ('3AY', 'Turbo Teal'),
  ('3CM', 'Field Green'),
  ('3E8', 'Grass Green'),
  ('3N9', 'Tropical Teal'),
  ('3P7', 'New Mint'),
  ('3TD', 'Dusty Green'),
  ('3TI', 'Neo Mint'),
  ('3TX', 'Lime Punch'),
  ('3U3', 'Pistachio'),
  ('3U4', 'Lime Zest'),
  ('3UG', 'Jade Stone'),
  ('3VS', 'Plaster'),
  ('3WH', 'Green Ivy'),
  ('3WM', 'Lagoon'),
  ('3YF', 'Mint Tint'),
  ('3YO', 'Pond'),
  ('402', 'Bijou Blue'),
  ('40M', 'Pool'),
  ('410', 'Navy'),
  ('411', 'Arctic'),
  ('44O', 'Chambray Blue'),
  ('456', 'Ocean'),
  ('4GX', 'Blue Jean'),
  ('4JL', 'Bright Cobalt'),
  ('4JQ', 'Mineral Blue'),
  ('4KZ', 'Blue Bolt'),
  ('4NS', 'Blue Calcite'),
  ('4O9', 'Ice Blue'),
  ('4OX', 'Venetian Blue'),
  ('4PD', 'Aquamarine'),
  ('4SL', 'Digital Aqua'),
  ('4SS', 'Pure Water'),
  ('4ST', 'Turq Tonic'),
  ('4TB', 'Oxygen'),
  ('4WK', 'Blue Frost'),
  ('518', 'Neon Purple'),
  ('530', 'Lavender'),
  ('57H', 'Amethyst'),
  ('5AF', 'Dreamscape'),
  ('5AJ', 'Galaxy'),
  ('5AS', 'Dark Iris'),
  ('5BN', 'Mystic Purple'),
  ('5BO', 'Frosted Grape'),
  ('5BX', 'Hydrangea'),
  ('5CQ', 'Plush Plum'),
  ('5PR', 'Orchid'),
  ('5PY', 'Digital Violet'),
  ('5Q6', 'Moon Jelly'),
  ('605', 'Burgundy'),
  ('606', 'Petal Pink'),
  ('612', 'Garnet'),
  ('669', 'Pink Lemonade'),
  ('682', 'Blossom'),
  ('6EN', 'Pepper'),
  ('6GD', 'Ballerina Pink'),
  ('6L0', 'Neon Magenta'),
  ('6PI', 'Barely Pink'),
  ('6QQ', 'Electric Pink'),
  ('6SL', 'Fresco'),
  ('6SN', 'Fresco/Multi'),
  ('6SV', 'Fuchsia Fun'),
  ('6SW', 'Taffy Pink'),
  ('6TW', 'Pink Crush'),
  ('6TY', 'Pink Clay'),
  ('6UB', 'Juice'),
  ('6UR', 'Quartz'),
  ('6WC', 'Varsity Red'),
  ('6WY', 'Pink Tweed'),
  ('6X0', 'Candy Pink'),
  ('6XJ', 'Strawberry Wine'),
  ('6XX', 'Rosette'),
  ('6ZQ', 'Dragon Fruit'),
  ('6ZW', 'Pink Milk'),
  ('710', 'Gold'),
  ('737', 'Melon'),
  ('738', 'Citrus'),
  ('75U', 'Sulphur'),
  ('75Y', 'Sunflower'),
  ('76M', 'Acidity'),
  ('77J', 'Cyber Yellow'),
  ('7AH', 'Starfish'),
  ('7C1', 'Lemon'),
  ('7HD', 'Banana Yellow'),
  ('801', 'Cantaloupe'),
  ('817', 'Tangerine'),
  ('83A', 'Orange Zing'),
  ('83E', 'Papaya'),
  ('854', 'Bronze'),
  ('86A', 'Electric Sunstone'),
  ('90H', 'Mlt'),
  ('928', 'Multi/White'),
  ('94S', 'White/Multi')
ON CONFLICT (codigo) DO NOTHING;

-- Estilos PF ---------------------------------------------------------
INSERT INTO public.cat_estilos (codigo, nombre, corrida_tallas, obsoleto) VALUES
  ('10001', 'Classic', 'M2-M17', false),
  ('10126', 'Baya', 'M4-M13', false),
  ('12132', 'Classic Realtree', 'M4-M17', false),
  ('206867', 'Classic Marbled Clog', 'M2-M15', false),
  ('206990', 'Classic Clog T', 'C4-C10', false),
  ('206991', 'Classic Clog K', 'C11-C13/J1-J6', false),
  ('207012', 'Baya Clog T', 'C4-C10', false),
  ('207013', 'Baya Clog K', 'C11-C13/J1-J6', false),
  ('207657', 'Baya Printed Clog K', 'C11-C13/J1-J6', false),
  ('209728', 'Baya Seasonal Printed Cg K', 'C11-C13/J1-J6', false),
  ('210099', 'Realtree APX Classic Clog', 'M2-M17', false),
  ('11016', 'Crocband', 'M4-M13', true),
  ('205453', 'Classic Tie Dye Graphic', 'M2-M13', true),
  ('206121', 'Classic Crocs Slide', 'M2-M13', true),
  ('204536', 'Classic Clog K', 'C4-J6', true),
  ('205483', 'Baya Clog K', 'C4-J3', true)
ON CONFLICT (codigo) DO NOTHING;

-- Unfin -------------------------------------------------------------
INSERT INTO public.cat_unfin (codigo, nombre, nota, obsoleto) VALUES
  ('43019', 'Unfin Classic', NULL, false),
  ('43020', 'Unfin Digital Printing', 'Sólo aplica para colores White, Khaki & Black', false),
  (NULL, 'Unfin Classic Realtree APX', 'Sin código asignado en el catálogo', false),
  ('43021', 'Unfin Classic Marbled Clog', NULL, false),
  ('43022', 'Unfin Baya Printed Cg K', NULL, false),
  ('43032', 'Unfin Classic Kids', NULL, false),
  ('43033', 'Unfin Baya', NULL, false),
  ('43034', 'Unfin Baya Clog K', NULL, false),
  ('41341', 'Unfin Crocband', NULL, true),
  ('43035', 'Unfin Classic Slide', NULL, true)
ON CONFLICT (nombre) DO NOTHING;

-- Strap -------------------------------------------------------------
INSERT INTO public.cat_strap (codigo, nombre, nota, obsoleto) VALUES
  ('40003', 'Strap', NULL, false),
  ('40004', 'Strap Marbled Clog', NULL, false),
  ('41121', 'Strap Kids', NULL, false),
  ('44020', 'Strap Crocband', NULL, true),
  ('41122', 'Strap Baya', NULL, true),
  ('41123', 'Strap Baya Clog', NULL, true)
ON CONFLICT (nombre) DO NOTHING;

-- Tallas equivalentes -----------------------------------------------
INSERT INTO public.cat_tallas_equivalencias
  (talla, talla_display, sufijo_unfin, talla_strap, sufijo_strap, qty_pares, qty_strap, es_kids, orden) VALUES
  ('C4', 'C4', '104', 'C4', '104', 24, 48, true, 1),
  ('C5', 'C5', '105', 'C5', '105', 24, 48, true, 2),
  ('C6', 'C6', '106', 'C6', '106', 24, 48, true, 3),
  ('C7', 'C7', '107', 'C7', '107', 24, 48, true, 4),
  ('C8', 'C8', '108', 'C8', '108', 24, 48, true, 5),
  ('C9', 'C9', '109', 'C9', '109', 24, 48, true, 6),
  ('C10', 'C10', '110', 'C10', '110', 24, 48, true, 7),
  ('C11', 'C11', '111', 'C11', '111', 24, 48, true, 8),
  ('C12', 'C12', '112', 'C12', '112', 24, 48, true, 9),
  ('C13', 'C13', '113', 'C13', '113', 24, 48, true, 10),
  ('J1', 'J1', '121', 'J1', '121', 24, 48, true, 11),
  ('J2', 'J2', '122', 'J2', '122', 24, 48, true, 12),
  ('J3', 'J3', '123', 'J3', '123', 24, 48, true, 13),
  ('J4', 'J4', '124', 'J4', '124', 24, 48, true, 14),
  ('J5', 'J5', '125', 'J5', '125', 24, 48, true, 15),
  ('J6', 'J6', '126', 'J6', '126', 24, 48, true, 16),
  ('M2W4', 'M2/W4', '102', 'M2', '032', 12, 24, false, 17),
  ('M3W5', 'M3/W5', '103', 'M3', '033', 12, 24, false, 18),
  ('M4W6', 'M4/W6', '104', 'M4', '034', 12, 24, false, 19),
  ('M5W7', 'M5/W7', '105', 'M5', '035', 12, 24, false, 20),
  ('M6W8', 'M6/W8', '106', 'M6', '036', 12, 24, false, 21),
  ('M7W9', 'M7/W9', '107', 'M7', '037', 12, 24, false, 22),
  ('M8W10', 'M8/W10', '108', 'M8', '038', 12, 24, false, 23),
  ('M9W11', 'M9/W11', '109', 'M9', '039', 12, 24, false, 24),
  ('M10W12', 'M10/W12', '110', 'M10', '040', 12, 24, false, 25),
  ('M11', 'M11', '111', 'M11', '041', 12, 24, false, 26),
  ('M12', 'M12', '112', 'M12', '042', 12, 24, false, 27),
  ('M13', 'M13', '113', 'M13', '043', 12, 24, false, 28),
  ('M14', 'M14', '114', 'M14', '044', 12, 24, false, 29),
  ('M15', 'M15', '115', 'M15', '045', 12, 24, false, 30),
  ('M16', 'M16', '116', 'M16', '046', 12, 24, false, 31),
  ('M17', 'M17', '117', 'M17', '047', 12, 24, false, 32)
ON CONFLICT (talla) DO NOTHING;


-- Colores confirmados en los archivos ARTICLES MASSIVE LOAD de ejemplo
-- (no aparecen en LISTA DE COLORES del Excel de referencia)
INSERT INTO public.cat_colores (codigo, nombre) VALUES
  ('214', 'Taupe'),
  ('453', 'Blue Haze'),
  ('30T', 'Crocs Green')
ON CONFLICT (codigo) DO NOTHING;

COMMIT;