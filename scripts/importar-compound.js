#!/usr/bin/env node
/**
 * Carga de los Excel de Compound desde la línea de comandos.
 *
 * Es la misma lógica que usará la pantalla de carga: las dos pasan por
 * src/services/importarCompound.service.js.
 *
 * Uso:
 *   node scripts/importar-compound.js "../Compound/Producción Diaria 2025 rev01.xlsx"
 *   node scripts/importar-compound.js "../Compound/Powder recovery.xlsx"
 *   node scripts/importar-compound.js <archivo> --analizar   (no escribe nada)
 *
 * El destino se deduce de la hoja que traiga el archivo; con --recuperacion o
 * --produccion se fuerza.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("../src/config/database");
const {
  analizarArchivo,
  importarArchivo,
} = require("../src/services/importarCompound.service");

const n = (v) => Number(v || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 });

/** Mira las hojas del archivo para saber a qué tabla va. */
function deducirDestino(archivo) {
  const XLSX = require("xlsx");
  const libro = XLSX.read(fs.readFileSync(archivo), { type: "buffer", bookSheets: true });
  if (libro.SheetNames.includes("Powder recovery")) return "RECUPERACION";
  if (libro.SheetNames.includes("Producción compuestos")) return "PRODUCCION";
  throw new Error(
    `No reconozco el archivo. Sus hojas son: ${libro.SheetNames.join(", ")}`,
  );
}

function leerArgs(argv) {
  const args = { analizar: false, destino: null };
  const sueltos = [];
  for (const a of argv) {
    if (a === "--analizar") args.analizar = true;
    else if (a === "--recuperacion") args.destino = "RECUPERACION";
    else if (a === "--produccion") args.destino = "PRODUCCION";
    else sueltos.push(a);
  }
  // En Windows es fácil escribir la ruta sin comillas y que los espacios la
  // partan en pedazos. Si los pedazos juntos sí existen, se usan tal cual.
  if (sueltos.length > 1) {
    const unido = sueltos.join(" ");
    if (fs.existsSync(path.resolve(unido))) return { ...args, archivo: unido };
  }
  args.archivo = sueltos[0] ?? null;
  return args;
}

async function main() {
  const args = leerArgs(process.argv.slice(2));
  if (!args.archivo) {
    console.error(
      "Uso: node scripts/importar-compound.js <archivo.xlsx> [--analizar] [--produccion|--recuperacion]",
    );
    process.exitCode = 1;
    return;
  }

  const ruta = path.resolve(args.archivo);
  if (!fs.existsSync(ruta)) {
    console.error(`No existe: ${ruta}`);
    process.exitCode = 1;
    return;
  }

  const destino = args.destino || deducirDestino(ruta);
  console.log(`Archivo : ${path.basename(ruta)}`);
  console.log(`Destino : ${destino}\n`);

  const resumen = await analizarArchivo(ruta, destino);
  console.log(`  Renglones      : ${n(resumen.filas)}`);
  console.log(`  Periodo        : ${resumen.fechaMin} a ${resumen.fechaMax}`);
  if (destino === "PRODUCCION") {
    console.log(`  Producción     : ${n(resumen.produccionKg)} kg`);
    console.log(`  Horas de turno : ${n(resumen.turnoHoras)} h`);
    console.log(`  Tiempo muerto  : ${n(resumen.tiempoMuerto)} h ` +
      `(${(resumen.tiempoMuerto / resumen.turnoHoras * 100).toFixed(2)}%)`);
    console.log(`  Líneas         : ${resumen.lineas.join(", ")}`);
  } else {
    console.log(`  Producción     : ${n(resumen.produccionKg)} kg`);
    console.log(`  Polvo usado    : ${n(resumen.polvoKg)} kg ` +
      `(${(resumen.polvoKg / resumen.produccionKg * 100).toFixed(2)}%)`);
    console.log(`  BU             : ${resumen.bus.join(", ")}`);
  }
  console.log(`  Se reemplazan  : ${n(resumen.seReemplazan)} renglones ya cargados`);
  for (const a of resumen.avisos) console.log(`  ⚠️  ${a}`);

  if (args.analizar) {
    console.log("\n(--analizar: no se escribió nada)");
    return;
  }

  console.log("\nCargando...");
  const r = await importarArchivo(ruta, destino, {
    nombreArchivo: path.basename(ruta),
  });
  console.log(
    `\nListo en ${(r.duracionMs / 1000).toFixed(1)} s\n` +
      `  Insertados : ${n(r.insertadas)}\n` +
      `  Reemplazados: ${n(r.borradas)}`,
  );
}

main()
  .catch((e) => {
    console.error("\nFalló:", e.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
