const db = require("../config/database");

/**
 * Reporte de Solicitudes de Compra: lo que la propuesta llama "medición" —
 * cuánto tarda cada área en aprobar y cuántas se rechazan.
 *
 * Mismas reglas que los reportes de Moldes y TI:
 *
 *   - La métrica es la MEDIANA (más p90), no el promedio: una sola solicitud
 *     olvidada una semana arrastra el promedio de un área chica.
 *   - Horas de reloj, no hábiles. Una solicitud del viernes a las 17:00 que se
 *     aprueba el lunes a las 9:00 cuenta 64 h. Es lo que vivió quien la pidió.
 *
 * Las que pidió el propio gerente nacen aprobadas en 0 segundos: se cuentan
 * como solicitudes pero NO entran al tiempo de decisión ni a la tasa de
 * rechazo, porque nadie las revisó.
 *
 * El periodo filtra por fecha de CREACIÓN. Las pendientes de hoy se muestran
 * aparte y sin filtro: lo que espera ahora importa aunque sea de otro mes.
 */

// Columnas derivadas comunes
const BASE = `
  SELECT s.*,
         ca.nombre AS area,
         (s.decidido_por = s.solicitante_id) AS propia,
         CASE WHEN s.decidido_en IS NOT NULL AND s.decidido_por <> s.solicitante_id
              THEN EXTRACT(EPOCH FROM (s.decidido_en - s.creado_en)) / 3600.0 END AS horas_decision,
         CASE WHEN s.enviado_en IS NOT NULL
              THEN EXTRACT(EPOCH FROM (s.enviado_en - s.decidido_en)) / 60.0 END AS minutos_envio
    FROM compras_solicitudes s
    JOIN compras_areas ca ON ca.id = s.compras_area_id
   WHERE s.creado_en >= $1::date
     AND s.creado_en <  $2::date + 1
`;

const METRICAS = `
  count(*)::int                                                        AS total,
  count(*) FILTER (WHERE estado = 'PENDIENTE')::int                    AS pendientes,
  count(*) FILTER (WHERE estado IN ('APROBADA', 'EN_COMPRAS'))::int    AS aprobadas,
  count(*) FILTER (WHERE estado = 'RECHAZADA')::int                    AS rechazadas,
  count(*) FILTER (WHERE estado = 'CANCELADA')::int                    AS canceladas,
  count(*) FILTER (WHERE propia)::int                                  AS propias,
  count(*) FILTER (WHERE horas_decision IS NOT NULL)::int              AS decididas,
  round(100.0 * count(*) FILTER (WHERE estado = 'RECHAZADA')
        / NULLIF(count(*) FILTER (WHERE horas_decision IS NOT NULL), 0), 1)::float AS pct_rechazo,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY horas_decision)::numeric, 2)::float AS mediana_horas,
  round(percentile_cont(0.9) WITHIN GROUP (ORDER BY horas_decision)::numeric, 2)::float AS p90_horas,
  round(avg(horas_decision)::numeric, 2)::float                        AS promedio_horas,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY minutos_envio)::numeric, 1)::float AS mediana_minutos_envio,
  count(*) FILTER (WHERE estado = 'APROBADA')::int                     AS sin_ticket
`;

class CompraReporte {
  static async resumen({ desde, hasta }) {
    const { rows } = await db.query(`WITH b AS (${BASE}) SELECT ${METRICAS} FROM b`, [desde, hasta]);
    return rows[0];
  }

  static async porArea({ desde, hasta }) {
    const { rows } = await db.query(
      `WITH b AS (${BASE})
       SELECT compras_area_id AS id, area, ${METRICAS}
         FROM b
        GROUP BY compras_area_id, area
        ORDER BY count(*) DESC, area`,
      [desde, hasta],
    );
    return rows;
  }

  /** Por semana (lunes) y estado, para la gráfica de volumen. */
  static async semanal({ desde, hasta }) {
    const { rows } = await db.query(
      `WITH b AS (${BASE})
       SELECT to_char(date_trunc('week', creado_en), 'YYYY-MM-DD') AS semana,
              count(*) FILTER (WHERE estado IN ('APROBADA', 'EN_COMPRAS'))::int AS aprobadas,
              count(*) FILTER (WHERE estado = 'RECHAZADA')::int AS rechazadas,
              count(*) FILTER (WHERE estado = 'PENDIENTE')::int AS pendientes,
              count(*) FILTER (WHERE estado = 'CANCELADA')::int AS canceladas,
              round(percentile_cont(0.5) WITHIN GROUP (ORDER BY horas_decision)::numeric, 2)::float AS mediana_horas
         FROM b
        GROUP BY 1
        ORDER BY 1`,
      [desde, hasta],
    );
    return rows;
  }

  /** Lo que espera ahora mismo, sin importar el periodo; lo más viejo arriba. */
  static async pendientesAhora() {
    const { rows } = await db.query(
      `SELECT s.id, s.folio, s.asunto, ca.nombre AS area,
              us.nombre_completo AS solicitante,
              g.nombre_completo AS gerente,
              p.nombre_completo AS suplente,
              to_char(s.creado_en, 'YYYY-MM-DD"T"HH24:MI:SS') AS creado_en,
              round((EXTRACT(EPOCH FROM (now() - s.creado_en)) / 3600.0)::numeric, 1)::float AS horas
         FROM compras_solicitudes s
         JOIN compras_areas ca ON ca.id = s.compras_area_id
         JOIN usuarios us ON us.id = s.solicitante_id
         LEFT JOIN usuarios g ON g.id = ca.gerente_id
         LEFT JOIN usuarios p ON p.id = ca.suplente_id
        WHERE s.estado = 'PENDIENTE'
        ORDER BY s.creado_en`,
    );
    return rows;
  }

  /** Por qué se rechaza: los motivos dicen más que la tasa. */
  static async rechazos({ desde, hasta }, limite = 30) {
    const { rows } = await db.query(
      `WITH b AS (${BASE})
       SELECT b.id, b.folio, b.asunto, b.area, b.comentario AS motivo,
              u.nombre_completo AS decidio,
              to_char(b.decidido_en, 'YYYY-MM-DD"T"HH24:MI:SS') AS decidido_en
         FROM b
         LEFT JOIN usuarios u ON u.id = b.decidido_por
        WHERE b.estado = 'RECHAZADA'
        ORDER BY b.decidido_en DESC
        LIMIT $3`,
      [desde, hasta, limite],
    );
    return rows;
  }
}

module.exports = CompraReporte;
