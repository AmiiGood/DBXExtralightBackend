-- ============================================================================
-- SOLICITUDES DE COMPRA — Nombre del tema 41
--
-- La migración 04 dio de alta el tema 41 de osticketadm como "Inyección Suela y
-- Almacén": osTicket corta el nombre a 32 caracteres ("Compras - Inyección
-- Suela y Alm") y se leyó mal. Es "Inyección Suela y Almohada" (Alexis,
-- 3-nov-2026). La 04 ya está corregida para instalaciones nuevas; esta arregla
-- donde ya se aplicó.
--
-- Idempotente.
-- ============================================================================

BEGIN;

UPDATE public.compras_areas
   SET nombre = 'Inyección Suela y Almohada', actualizado_en = now()
 WHERE osticket_topic_id = 41
   AND nombre <> 'Inyección Suela y Almohada';

COMMIT;
