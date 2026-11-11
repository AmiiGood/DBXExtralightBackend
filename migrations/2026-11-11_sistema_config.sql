-- ============================================================================
-- CONFIGURACIÓN GENERAL DEL SISTEMA (clave → valor)
--
-- Para interruptores que no son de ningún módulo. El primero: los adornos de
-- temporada (Navidad, Año nuevo, Fiestas patrias, Día de Muertos) que salen en
-- Inicio y en la pantalla de inicio de sesión. Las fechas están en el
-- frontend (config/temporadas.js); aquí solo se guarda si se muestran.
--
-- Idempotente.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.sistema_config (
  clave            varchar(60)  PRIMARY KEY,
  valor            jsonb        NOT NULL,
  actualizado_por  integer      REFERENCES public.usuarios(id),
  actualizado_en   timestamp    NOT NULL DEFAULT now()
);

INSERT INTO public.sistema_config (clave, valor)
VALUES ('adornos_temporada', 'true'::jsonb)
ON CONFLICT (clave) DO NOTHING;

COMMIT;
