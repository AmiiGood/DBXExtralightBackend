-- ============================================================================
-- obtener_turno_actual(): calcular el turno con la hora de planta (UTC-6)
-- ============================================================================
-- Síntoma: Reportes de Calidad mostraba registros del "Turno B" antes de las
-- 16:00. La función original tomaba la hora del servidor en UTC, así que todo
-- quedaba recorrido 6 h: de 10:00 a 18:00 locales se guardaba como B, de 18:00
-- a 02:00 como C y de 02:00 a 10:00 como A (así están los registros de
-- enero a junio de 2026).
--
-- El parche que existía (now() AT TIME ZONE 'America/Mexico_City') se aplicó a
-- mano y no estaba en ninguna migración. Además depende de la tzdata del
-- servidor: un PostgreSQL con tzdata anterior a 2022 todavía aplica horario de
-- verano a Mexico_City y adelanta una hora de abril a octubre (a las 15:00 ya
-- daría turno B).
--
-- México (zona centro) quedó fijo en UTC-6 desde octubre de 2022, así que se usa
-- el desfase fijo: no depende de la TimeZone de la sesión ni de la tzdata.
--
-- También cierra el hueco de 23:59:59 a 00:00:00: el Turno B termina en
-- '23:59:59', y en ese último segundo la función regresaba NULL.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.obtener_turno_actual()
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
    hora_actual TIME;
    turno_id_resultado INTEGER;
BEGIN
    -- Hora de planta: UTC-6 fijo (México ya no tiene horario de verano)
    hora_actual := ((now() AT TIME ZONE 'UTC') - INTERVAL '6 hours')::time;

    SELECT id INTO turno_id_resultado
    FROM turnos
    WHERE activo = true
    AND (
        -- Turno que no cruza medianoche ('23:59:59' cuenta como fin de día)
        (hora_inicio < hora_fin AND hora_actual >= hora_inicio
            AND (hora_actual < hora_fin OR hora_fin = '23:59:59'))
        OR
        -- Turno que cruza medianoche
        (hora_inicio > hora_fin AND (hora_actual >= hora_inicio OR hora_actual < hora_fin))
    )
    ORDER BY hora_inicio
    LIMIT 1;

    RETURN turno_id_resultado;
END;
$function$;

-- Verificación: debe regresar el turno de la hora actual en planta
-- SELECT t.nombre, ((now() AT TIME ZONE 'UTC') - INTERVAL '6 hours')::time AS hora_planta
-- FROM turnos t WHERE t.id = obtener_turno_actual();
