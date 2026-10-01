-- ============================================================================
-- Corrección única: horas guardadas en GMT desde el 14-sep-2026
-- ============================================================================
-- El 14-sep-2026, entre las 09:19 y las 12:35 (hora de planta), la BD empezó a
-- correr con TimeZone = GMT. Todas las columnas TIMESTAMP (sin zona) que toman la
-- hora del servidor (DEFAULT now()/CURRENT_TIMESTAMP, o "= now()" en el código)
-- se guardaron 6 h adelantadas. En registros_defectos el corte es exacto: el
-- id 12156 es el último en hora local y el 12157 el primero en GMT.
--
-- Este script les resta 6 h a los valores >= 2026-09-14 14:00. Ese umbral
-- separa sin ambigüedad: lo anterior al corte quedó por debajo de las 12:35 y
-- lo posterior, ya en GMT, por encima de las 15:19.
--
-- CUÁNDO CORRERLO (en este orden):
--   1. Detener el backend (también detiene las sincronizaciones programadas).
--   2. Correr este script.
--   3. Subir el backend con src/config/database.js corregido (timezone por
--      conexión) y arrancarlo.
-- Si el backend corregido ya grabó datos antes de correr esto, NO correrlo:
-- esos registros nuevos (ya en hora local) también quedarían arriba del umbral
-- y se les restarían 6 h.
--
-- QUÉ NO TOCA (a propósito):
--   - Fechas de negocio capturadas o importadas (iny_produccion.fecha, comp_*,
--     cs_kpi, staff/res valores de Excel, etc.).
--   - Tiempos copiados de osTicket (moldes_tickets / ti_tickets: creado,
--     cerrado, ...) ni corte_actualizado, que es la marca de la sincronización.
--   - Valores que pone Node con new Date() (qr_sincronizaciones.fecha_consulta,
--     cs_archivos.modificado_en): dependen de la zona del proceso Node, no de
--     la BD.
--   - El JSON guardado en logs_sistema.datos_* (es una foto del registro).
--
-- Tiene candado: si ya se corrió, el id 12157 ya no tiene 18:35 y aborta.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    umbral CONSTANT timestamp := '2026-09-14 14:00:00';
    -- Columnas que el código llena con "= now()" o CURRENT_TIMESTAMP en un
    -- UPDATE, sin DEFAULT. Las que sí tienen DEFAULT se descubren solas abajo.
    extras CONSTANT text[][] := ARRAY[
        ['iny_produccion',          'editado_en'],
        ['cs_archivos',             'leido_en'],
        ['cs_archivos',             'error_en'],
        ['cs_sincronizaciones',     'terminada_en'],
        ['moldes_sincronizaciones', 'terminada_en'],
        ['ti_sincronizaciones',     'terminada_en'],
        ['reportes_programados',    'ultima_ejecucion'],
        ['usuarios',                'ultimo_acceso'],
        ['cajas_produccion',        'fecha_completado']
    ];
    r record;
    n bigint;
    total bigint := 0;
BEGIN
    -- Candado contra doble ejecución
    IF NOT EXISTS (
        SELECT 1 FROM registros_defectos
        WHERE id = 12157 AND fecha_registro = '2026-09-14 18:35:03.144495'
    ) THEN
        RAISE EXCEPTION 'El registro 12157 no tiene la hora GMT esperada: la corrección ya se aplicó o esta no es la BD de producción. No se cambió nada.';
    END IF;

    CREATE TEMP TABLE _cols ON COMMIT DROP AS
    SELECT c.table_name::text AS tabla, c.column_name::text AS columna
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.data_type = 'timestamp without time zone'
      AND (c.column_default ILIKE '%now()%' OR c.column_default ILIKE '%current_timestamp%');

    FOR i IN 1 .. array_length(extras, 1) LOOP
        INSERT INTO _cols
        SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = extras[i][1]
          AND c.column_name = extras[i][2]
          AND c.data_type = 'timestamp without time zone'
          AND NOT EXISTS (SELECT 1 FROM _cols x WHERE x.tabla = c.table_name AND x.columna = c.column_name);
    END LOOP;

    -- Sin triggers mientras se corrige: actualizar_timestamp() reescribiría
    -- actualizado_en con la hora actual y registrar_log_defectos() metería una
    -- fila en logs_sistema por cada registro.
    FOR r IN SELECT DISTINCT tabla FROM _cols LOOP
        EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER', r.tabla);
    END LOOP;

    FOR r IN SELECT tabla, columna FROM _cols ORDER BY tabla, columna LOOP
        EXECUTE format(
            'UPDATE %I SET %I = %I - INTERVAL ''6 hours'' WHERE %I >= $1',
            r.tabla, r.columna, r.columna, r.columna
        ) USING umbral;
        GET DIAGNOSTICS n = ROW_COUNT;
        total := total + n;
        IF n > 0 THEN
            RAISE NOTICE '%.%: % filas', r.tabla, r.columna, n;
        END IF;
    END LOOP;

    FOR r IN SELECT DISTINCT tabla FROM _cols LOOP
        EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER', r.tabla);
    END LOOP;

    RAISE NOTICE 'Total: % valores corregidos en % columnas', total, (SELECT count(*) FROM _cols);
END;
$$;

-- Verificación: el id 12157 debe quedar en 12:35 y el turno A entre 8 y 15 h
SELECT id, fecha_registro FROM registros_defectos WHERE id IN (12156, 12157);

SELECT t.nombre,
       min(extract(hour FROM rd.fecha_registro)) AS hmin,
       max(extract(hour FROM rd.fecha_registro)) AS hmax,
       count(*)
FROM registros_defectos rd JOIN turnos t ON t.id = rd.turno_id
WHERE rd.fecha_registro >= '2026-09-15'
GROUP BY t.nombre ORDER BY t.nombre;

-- Si la verificación se ve bien:  COMMIT;
-- Si algo no cuadra:              ROLLBACK;
