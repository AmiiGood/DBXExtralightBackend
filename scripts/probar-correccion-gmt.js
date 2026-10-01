/**
 * Prueba en seco de migrations/2026-10-01_corregir_horas_gmt.sql
 *
 * Corre el script completo dentro de una transacción y SIEMPRE hace ROLLBACK:
 * muestra cuántos valores corregiría por columna y cómo quedarían los turnos,
 * sin guardar nada.
 *
 *   node scripts/probar-correccion-gmt.js .env.production
 *   node scripts/probar-correccion-gmt.js .env --sin-candado   (BD local)
 *
 * --sin-candado salta la verificación del id 12157 (para probar el flujo en
 * una BD que no es la de producción).
 *
 *   node scripts/probar-correccion-gmt.js .env.production --aplicar
 *
 * --aplicar hace COMMIT, pero solo si el id 12156 quedó igual, el 12157 quedó
 * en 12:35 y ningún defecto desde el 15-sep cae fuera de su turno. Correrlo con
 * el backend detenido (ver encabezado del .sql).
 */
const path = require("path");
const fs = require("fs");
const { Client } = require("pg");

const envFile = process.argv[2] || ".env";
const sinCandado = process.argv.includes("--sin-candado");
const aplicar = process.argv.includes("--aplicar");
require("dotenv").config({ path: path.resolve(__dirname, "..", envFile), quiet: true });

let sql = fs.readFileSync(
  path.resolve(__dirname, "../migrations/2026-10-01_corregir_horas_gmt.sql"),
  "utf8",
);
// El BEGIN y el cierre los controla este script
sql = sql.replace(/^BEGIN;\s*$/m, "");
if (sinCandado) sql = sql.replace(/IF NOT EXISTS \(/, "IF false AND NOT EXISTS (");

(async () => {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    // No esperar locks más de 5 s: si el backend tiene una tabla ocupada, abortar
    options: "-c lock_timeout=5000",
  });
  client.on("notice", (n) => console.log("  " + n.message));
  await client.connect();
  console.log(
    `BD: ${process.env.DB_HOST}/${process.env.DB_NAME}  ` +
      (aplicar ? "(APLICAR: COMMIT si la verificación cuadra)\n" : "(prueba en seco, se hace ROLLBACK)\n"),
  );

  let confirmar = false;
  try {
    await client.query("BEGIN");
    const resultados = await client.query(sql);
    const selects = (Array.isArray(resultados) ? resultados : [resultados]).filter(
      (r) => r.command === "SELECT",
    );
    for (const r of selects) console.table(r.rows);

    if (aplicar) {
      // Solo se confirma si el corte y los turnos quedaron como deben
      const { rows } = await client.query(`
        SELECT
          (SELECT fecha_registro::text FROM registros_defectos WHERE id = 12156) AS r12156,
          (SELECT fecha_registro::text FROM registros_defectos WHERE id = 12157) AS r12157,
          (SELECT count(*) FROM registros_defectos rd JOIN turnos t ON t.id = rd.turno_id
            WHERE rd.fecha_registro >= '2026-09-15' AND NOT (
                 (t.nombre = 'Turno A' AND extract(hour FROM rd.fecha_registro) BETWEEN 8 AND 15)
              OR (t.nombre = 'Turno B' AND extract(hour FROM rd.fecha_registro) BETWEEN 16 AND 23)
              OR (t.nombre = 'Turno C' AND extract(hour FROM rd.fecha_registro) BETWEEN 0 AND 7)
            ))::int AS fuera_de_turno`);
      const v = rows[0];
      confirmar =
        v.r12156 === "2026-09-14 09:19:36.845487" &&
        v.r12157 === "2026-09-14 12:35:03.144495" &&
        v.fuera_de_turno === 0;
      console.log("Verificación:", v, confirmar ? "OK" : "NO CUADRA");
    }
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exitCode = 1;
  } finally {
    if (confirmar) {
      await client.query("COMMIT");
      console.log("\nCOMMIT hecho: corrección guardada.");
    } else {
      await client.query("ROLLBACK");
      console.log("\nROLLBACK hecho: no se guardó ningún cambio.");
    }
    await client.end();
  }
})();
