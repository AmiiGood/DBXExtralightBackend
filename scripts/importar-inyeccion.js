#!/usr/bin/env node
/**
 * Carga de "Producción Inyección.xlsx" desde la línea de comandos.
 *
 * Es la misma lógica que usa la pantalla de Carga de Producción: las dos pasan
 * por src/services/importarInyeccion.service.js. Este script sirve para la
 * carga histórica inicial y para cuando el archivo es tan grande que subirlo
 * por el navegador resulta incómodo.
 *
 * Uso:
 *   node scripts/importar-inyeccion.js "../Producción/Inyección/Produccion Inyección.xlsx"
 *   node scripts/importar-inyeccion.js archivo.xlsx --usuario 1
 *   node scripts/importar-inyeccion.js archivo.xlsx --analizar    (no escribe)
 *   node scripts/importar-inyeccion.js archivo.xlsx --reemplazar  (recarga el rango)
 *
 * Si Node se queda sin memoria:
 *   node --max-old-space-size=4096 scripts/importar-inyeccion.js ...
 */

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const db = require("../src/config/database");
const {
  analizarArchivo,
  importarArchivo,
} = require("../src/services/importarInyeccion.service");

const fmt = (n) => Number(n ?? 0).toLocaleString("es-MX");

function parseArgs(argv) {
  const args = { archivo: null, usuario: null, analizar: false, reemplazar: false };
  const sueltos = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--analizar" || a === "--simular") args.analizar = true;
    else if (a === "--reemplazar") args.reemplazar = true;
    else if (a === "--usuario") args.usuario = parseInt(argv[++i], 10);
    else sueltos.push(a);
  }
  // En Windows es fácil escribir la ruta sin comillas y que los espacios la
  // partan en pedazos ("../Producción/Inyección/Produccion Inyección.xlsx").
  // Si los pedazos juntos sí existen, se usan tal cual.
  if (sueltos.length > 1) {
    const unido = sueltos.join(" ");
    if (fs.existsSync(path.resolve(unido))) return { ...args, archivo: unido };
  }
  args.archivo = sueltos[0] ?? null;
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.archivo) {
    console.error(
      "Uso: node scripts/importar-inyeccion.js <archivo.xlsx> [--usuario N] [--analizar] [--reemplazar]",
    );
    process.exit(1);
  }
  const archivo = path.resolve(args.archivo);
  if (!fs.existsSync(archivo)) {
    console.error(`No existe el archivo: ${archivo}`);
    process.exit(1);
  }

  try {
    console.log(`\nLeyendo ${path.basename(archivo)} ...`);

    if (args.analizar) {
      const a = await analizarArchivo(archivo);
      console.log("\n--- Contenido del archivo ---");
      console.log(`  Filas a cargar         ${fmt(a.filas)}`);
      console.log(`    de producción        ${fmt(a.resumen.validas - a.resumen.scrapPorModelo)}`);
      console.log(`    de rezago            ${fmt(a.resumen.scrapPorModelo)}`);
      console.log(`  Periodo                ${a.fechaMin} a ${a.fechaMax}`);
      console.log(`  Productos distintos    ${fmt(a.productos)}`);
      console.log(`  Omitidas (vacías)      ${fmt(a.resumen.sinMaquina)}`);
      console.log(`  Tallas corregidas      ${fmt(a.resumen.tallaCorregida)}`);
      console.log(`  Ajustes negativos      ${fmt(a.resumen.scrapNegativo)}`);
      console.log(`\n  Ya cargado en ese periodo: ${fmt(a.yaCargado.existentes)} ` +
        `(${fmt(a.yaCargado.importados)} de importación, ${fmt(a.yaCargado.capturados)} capturados a mano)`);
      console.log("\n  BU                 Filas        Piezas       Scrap");
      for (const b of a.porBu) {
        console.log(
          `  ${String(b.bu).padEnd(16)} ${fmt(b.filas).padStart(8)} ` +
            `${fmt(Math.round(b.produccion)).padStart(12)} ${fmt(Math.round(b.scrap)).padStart(11)}`,
        );
      }
      console.log("\n(--analizar: no se escribió nada)\n");
      return;
    }

    let ultimo = 0;
    const r = await importarArchivo(archivo, {
      nombreArchivo: path.basename(archivo),
      usuarioId: args.usuario ?? (await usuarioPorDefecto()),
      reemplazar: args.reemplazar,
      alAvanzar: (hechas, total) => {
        const pct = Math.floor((hechas / total) * 100);
        if (pct >= ultimo + 10) {
          ultimo = pct;
          console.log(`    ${fmt(hechas)} de ${fmt(total)} (${pct}%)`);
        }
      },
    });

    console.log("\n--- Carga terminada ---");
    console.log(`  Insertadas             ${fmt(r.insertadas)}`);
    console.log(`  Reemplazadas           ${fmt(r.reemplazados)}`);
    console.log(`  Productos nuevos       ${fmt(r.productosNuevos)}`);
    console.log(`  Periodo                ${r.fechaMin} a ${r.fechaMax}`);
    console.log(`  Máquina no catalogada  ${fmt(r.maquinaNoCatalogada)}` +
      (r.maquinasDesconocidas.length ? ` -> ${r.maquinasDesconocidas.join(", ")}` : ""));
    console.log(`  Duración               ${(r.duracionMs / 1000).toFixed(1)}s`);
    console.log(`\n>>> Guardado (iny_cargas.id = ${r.cargaId}).\n`);
  } catch (e) {
    console.error(`\n*** Error: ${e.message}\n`);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

/** Primer administrador, para atribuir la carga cuando no se pasa --usuario. */
async function usuarioPorDefecto() {
  const r = await db.query(
    `SELECT u.id FROM usuarios u
     LEFT JOIN roles rol ON rol.id = u.rol_id
     ORDER BY (rol.es_admin IS TRUE) DESC, u.id ASC LIMIT 1`,
  );
  if (r.rows.length === 0) throw new Error("No hay usuarios en la BD");
  return r.rows[0].id;
}

main();
