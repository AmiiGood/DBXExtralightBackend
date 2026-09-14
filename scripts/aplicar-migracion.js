#!/usr/bin/env node
/**
 * Aplica uno o más archivos de migrations/ usando la conexión del .env.
 * Existe porque en este equipo no hay psql en el PATH.
 *
 * Cada archivo corre en su propia transacción: si uno falla, ese archivo se
 * revierte completo y los anteriores quedan aplicados.
 *
 * Uso:
 *   node scripts/aplicar-migracion.js 2026-08-20_iny_produccion_01_schema.sql
 *   node scripts/aplicar-migracion.js archivo1.sql archivo2.sql
 *   node scripts/aplicar-migracion.js archivo.sql --simular   (valida y revierte)
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("../src/config/database");

const DIR = path.join(__dirname, "..", "migrations");

async function main() {
  const args = process.argv.slice(2);
  const simular = args.includes("--simular");
  const archivos = args.filter((a) => !a.startsWith("--"));

  if (archivos.length === 0) {
    console.error("Uso: node scripts/aplicar-migracion.js <archivo.sql> [...] [--simular]");
    console.error("\nDisponibles en migrations/:");
    for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith(".sql"))) {
      console.error("  " + f);
    }
    process.exit(1);
  }

  for (const nombre of archivos) {
    const ruta = path.isAbsolute(nombre) ? nombre : path.join(DIR, nombre);
    if (!fs.existsSync(ruta)) {
      console.error(`No existe: ${ruta}`);
      process.exitCode = 1;
      break;
    }

    const cliente = await db.pool.connect();
    try {
      // Los archivos ya traen su BEGIN/COMMIT; para poder simular se quitan y
      // se controla la transacción desde aquí.
      const sql = fs
        .readFileSync(ruta, "utf8")
        .replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gm, "");

      await cliente.query("BEGIN");
      const t0 = Date.now();
      await cliente.query(sql);
      const seg = ((Date.now() - t0) / 1000).toFixed(1);

      if (simular) {
        await cliente.query("ROLLBACK");
        console.log(`OK (simulado, revertido)  ${nombre}  ${seg}s`);
      } else {
        await cliente.query("COMMIT");
        console.log(`APLICADO  ${nombre}  ${seg}s`);
      }
    } catch (e) {
      await cliente.query("ROLLBACK");
      console.error(`\n*** ERROR en ${nombre}: ${e.message}`);
      if (e.position) console.error(`    posición ${e.position}`);
      process.exitCode = 1;
      cliente.release();
      break;
    }
    cliente.release();
  }

  await db.pool.end();
}

main();
