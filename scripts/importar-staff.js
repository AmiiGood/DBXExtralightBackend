#!/usr/bin/env node
/**
 * Carga del Excel de la junta de STAFF desde la línea de comandos.
 *
 * Es la misma lógica que la pantalla de carga: las dos pasan por
 * src/services/importarStaff.service.js.
 *
 * Uso:
 *   node scripts/importar-staff.js "../STAFF/2026 CPC JUNTA DE STAFF WEEK 35.xlsx"
 *   node scripts/importar-staff.js <archivo> --analizar        (no escribe nada)
 *   node scripts/importar-staff.js <archivo> --semana 35 --anio 2026
 *
 * La semana de corte sale del NOMBRE del archivo, que es el único lugar donde
 * viene; con --semana se fuerza cuando alguien lo renombró. Sin ella se cargan
 * las series pero no la foto de PO abierta.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("../src/config/database");
const {
  analizarArchivo,
  importarArchivo,
} = require("../src/services/importarStaff.service");

const n = (v) => Number(v || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 });

function leerArgs(argv) {
  const args = { analizar: false, semana: null, anio: null };
  const sueltos = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--analizar") args.analizar = true;
    else if (a === "--semana") args.semana = parseInt(argv[++i], 10);
    else if (a === "--anio") args.anio = parseInt(argv[++i], 10);
    else if (!a.startsWith("--")) sueltos.push(a);
  }

  args.archivo = sueltos[0];
  return args;
}

function imprimirAvisos(avisos) {
  if (!avisos?.length) return;
  console.log("\nA revisar:");
  for (const a of avisos) console.log("  - " + a);
}

async function main() {
  const args = leerArgs(process.argv.slice(2));

  if (!args.archivo) {
    console.error(
      'Uso: node scripts/importar-staff.js "<archivo.xlsx>" [--analizar] [--semana N --anio AAAA]',
    );
    process.exit(1);
  }

  const ruta = path.resolve(args.archivo);
  if (!fs.existsSync(ruta)) {
    console.error(`No existe: ${ruta}`);
    process.exit(1);
  }

  const nombre = path.basename(ruta);

  // --semana manda sobre el nombre del archivo; el año por omisión es el del
  // nombre o el actual, que es lo que resuelve leerSemanaDelNombre.
  const corte = args.semana
    ? { semana: args.semana, anio: args.anio || new Date().getFullYear() }
    : null;

  const resumen = await analizarArchivo(ruta, nombre);

  console.log(`\nArchivo: ${nombre}`);
  console.log(`  Valores          ${n(resumen.valores)}`);
  console.log(`  Periodos         ${n(resumen.periodos)}  (${resumen.periodoMin} a ${resumen.periodoMax})`);
  console.log(`  Años             ${resumen.anios.join(", ")}`);
  for (const [bloque, cuantos] of Object.entries(resumen.porBloque)) {
    console.log(`    ${bloque.padEnd(12)} ${n(cuantos)}`);
  }
  const c = corte || resumen.corte;
  console.log(
    `  Open PO          ${n(resumen.openPoFilas)} renglones` +
      (c ? `, corte semana ${c.semana} de ${c.anio}` : ", SIN semana de corte"),
  );
  console.log(`  Ya en la base    ${n(resumen.yaCargados)} valores de esos periodos`);
  imprimirAvisos(resumen.avisos);

  if (args.analizar) {
    console.log("\n(--analizar: no se escribió nada)");
    return;
  }

  const r = await importarArchivo(ruta, { nombreArchivo: nombre, corte });

  console.log(
    `\nCargado: ${n(r.valores)} valores en ${n(r.periodos)} periodos ` +
      `(${r.periodoMin} a ${r.periodoMax})` +
      (r.openPoFilas ? `, ${n(r.openPoFilas)} renglones de PO abierta` : "") +
      ` en ${(r.duracionMs / 1000).toFixed(1)}s`,
  );
  imprimirAvisos(r.avisos);
}

main()
  .catch((e) => {
    console.error("\n*** ERROR:", e.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
