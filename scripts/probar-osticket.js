/**
 * Sonda de la base de osTicket.
 *
 * Verifica que la conexión funcione y describe lo que hay del lado de Moldes:
 * departamentos, temas de ayuda, estados y el volumen de tickets. Es solo
 * lectura y sirve para confirmar que el reporte se puede armar contra el
 * servidor real antes de escribir consultas definitivas.
 *
 *   node scripts/probar-osticket.js
 */
require("dotenv").config();
const { query, pool, configurado } = require("../src/config/osticket");

const TEMA = "Moldes - Cambio de molde";
const DEPTO = "Moldes";

async function main() {
  if (!configurado() || !process.env.OSTICKET_DB_PASSWORD) {
    console.error("Falta configurar OSTICKET_DB_* en el .env (incluida la contraseña).");
    process.exit(1);
  }

  console.log("\n=== Columnas de ost_help_topic ===");
  const colsTopic = await query(
    "SELECT column_name AS c, data_type AS tipo FROM information_schema.columns " +
      "WHERE table_schema = DATABASE() AND table_name = 'ost_help_topic' " +
      "ORDER BY ordinal_position",
  );
  console.log(colsTopic.map((c) => `  ${c.c} (${c.tipo})`).join("\n"));

  console.log("\n=== Temas relacionados con Moldes ===");
  console.table(
    await query(
      `SELECT h.topic_id, h.topic, d.name AS depto, COUNT(t.ticket_id) AS tickets
         FROM ost_help_topic h
         LEFT JOIN ost_department d ON d.id = h.dept_id
         LEFT JOIN ost_ticket t     ON t.topic_id = h.topic_id
        WHERE h.topic LIKE '%olde%' OR d.name = ?
        GROUP BY h.topic_id, h.topic, d.name
        ORDER BY tickets DESC`,
      [DEPTO],
    ),
  );

  console.log("\n=== Estados ===");
  console.table(await query("SELECT id, name, state FROM ost_ticket_status ORDER BY id"));

  console.log("\n=== Tickets de cambio de molde por año ===");
  console.table(
    await query(
      `SELECT YEAR(t.created)           AS anio,
              COUNT(*)                  AS tickets,
              SUM(t.closed IS NOT NULL) AS cerrados,
              SUM(t.reopened IS NOT NULL) AS reabiertos,
              MIN(t.created)            AS primero,
              MAX(t.created)            AS ultimo
         FROM ost_ticket t
         JOIN ost_help_topic h ON h.topic_id = t.topic_id
         JOIN ost_department d ON d.id = t.dept_id
        WHERE h.topic = ? AND d.name = ?
        GROUP BY YEAR(t.created)
        ORDER BY anio`,
      [TEMA, DEPTO],
    ),
  );

  console.log("\n=== Horas de resolución (cerrados) ===");
  console.table(
    await query(
      `SELECT COUNT(*) AS cerrados,
              ROUND(MIN(TIMESTAMPDIFF(MINUTE, t.created, t.closed) / 60), 2) AS min_h,
              ROUND(AVG(TIMESTAMPDIFF(MINUTE, t.created, t.closed) / 60), 2) AS prom_h,
              ROUND(MAX(TIMESTAMPDIFF(MINUTE, t.created, t.closed) / 60), 2) AS max_h,
              SUM(t.closed < t.created) AS cierres_antes_de_crear
         FROM ost_ticket t
         JOIN ost_help_topic h ON h.topic_id = t.topic_id
         JOIN ost_department d ON d.id = t.dept_id
        WHERE h.topic = ? AND d.name = ? AND t.closed IS NOT NULL`,
      [TEMA, DEPTO],
    ),
  );

  console.log("\n=== Estado actual de esos tickets ===");
  console.table(
    await query(
      `SELECT s.name AS estado, s.state, COUNT(*) AS tickets,
              SUM(t.closed IS NULL) AS sin_fecha_cierre
         FROM ost_ticket t
         JOIN ost_help_topic h    ON h.topic_id = t.topic_id
         JOIN ost_department d    ON d.id = t.dept_id
         JOIN ost_ticket_status s ON s.id = t.status_id
        WHERE h.topic = ? AND d.name = ?
        GROUP BY s.name, s.state
        ORDER BY tickets DESC`,
      [TEMA, DEPTO],
    ),
  );
}

main()
  .catch((e) => console.error("\nError:", e.code || "", e.message))
  .finally(() => pool.end());
