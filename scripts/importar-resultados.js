#!/usr/bin/env node
/**
 * Carga del Excel mensual de Resultados desde la línea de comandos.
 *
 * Es la misma lógica que la pantalla de carga: las dos pasan por
 * src/services/importarResultados.service.js.
 *
 * Uso:
 *   node scripts/importar-resultados.js "../Resultados/DATA-FCMX-2026 Agosto.xlsx"
 *   node scripts/importar-resultados.js <archivo> --analizar   (no escribe nada)
 *
 * El año y el mes de corte salen del NOMBRE del archivo, que es de donde se
 * fecha la foto de carga de PO y el bloque del estado de resultados al que
 * nadie le escribió el año en la hoja.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("../src/config/database");
const {
  analizarArchivo,
  importarArchivo,
} = require("../src/services/importarResultados.service");

const n = (v) => Number(v || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 });

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function imprimirAvisos(avisos) {
  if (!avisos?.length) return;
  console.log("\nA revisar:");
  for (const a of avisos) console.log("  - " + a);
}

async function main() {
  const args = process.argv.slice(2);
  const analizar = args.includes("--analizar");
  const archivo = args.find((a) => !a.startsWith("--"));

  if (!archivo) {
    console.error('Uso: node scripts/importar-resultados.js "<archivo.xlsx>" [--analizar]');
    process.exit(1);
  }

  const ruta = path.resolve(archivo);
  if (!fs.existsSync(ruta)) {
    console.error(`No existe: ${ruta}`);
    process.exit(1);
  }

  const nombre = path.basename(ruta);
  const r = await analizarArchivo(ruta, nombre);

  console.log(`\nArchivo: ${nombre}`);
  console.log(`  Valores          ${n(r.valores)}` + (r.repetidos ? `  (${n(r.repetidos)} repetidos en el libro, se queda el último)` : ""));
  console.log(`  Años             ${r.anios.join(", ")}`);
  console.log(
    `  Corte            ${r.corte?.mes ? MESES[r.corte.mes - 1] : "?"} de ${r.corte?.anio ?? "?"}` +
      (r.semanaCarga ? `, carga de PO de la semana ${r.semanaCarga}` : ""),
  );
  console.log(`  Ya en la base    ${n(r.yaCargados)} valores de esos años`);

  console.log("\n  Por bloque:");
  for (const [bloque, cuantos] of Object.entries(r.porBloque)) {
    console.log(`    ${bloque.padEnd(14)} ${String(n(cuantos)).padStart(7)}`);
  }

  console.log("\n  Hojas leídas:");
  for (const h of r.hojasLeidas) {
    console.log(`    ${h.etiqueta.padEnd(30)} ${String(n(h.valores)).padStart(7)}   ${h.hoja}`);
  }
  if (r.hojasIgnoradas?.length) {
    // No es un problema: son re-acomodos de las mismas cifras
    console.log(`\n  Hojas derivadas, no se leen: ${r.hojasIgnoradas.join(", ")}`);
  }

  imprimirAvisos(r.avisos);

  if (analizar) {
    console.log("\n(--analizar: no se escribió nada)");
    return;
  }

  const res = await importarArchivo(ruta, { nombreArchivo: nombre });
  console.log(
    `\nCargado: ${n(res.valores)} valores de ${res.anioMin} a ${res.anioMax} ` +
      `en ${(res.duracionMs / 1000).toFixed(1)}s`,
  );
  imprimirAvisos(res.avisos);
}

main()
  .catch((e) => {
    console.error("\n*** ERROR:", e.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
