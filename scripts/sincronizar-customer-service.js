/**
 * Sincroniza a mano los archivos de Customer Service.
 *
 *   node scripts/sincronizar-customer-service.js              todos los activos
 *   node scripts/sincronizar-customer-service.js KPI          solo ese
 *   node scripts/sincronizar-customer-service.js --forzar     relee aunque no
 *                                                            haya cambiado
 *   node scripts/sincronizar-customer-service.js --probar     solo revisa que
 *                                                            la ruta se alcance
 *
 * El `--probar` es lo primero que hay que correr en el servidor: contesta si la
 * cuenta del backend llega al recurso compartido, sin mover un solo dato.
 */

require("dotenv").config();
const cs = require("../src/services/sincronizarCustomerService.service");
const db = require("../src/config/database");

async function main() {
  const args = process.argv.slice(2);
  const forzar = args.includes("--forzar");
  const soloProbar = args.includes("--probar");
  const clave = args.find((a) => !a.startsWith("--"))?.toUpperCase();

  const archivos = await cs.listarArchivos();
  const objetivo = clave ? archivos.filter((a) => a.clave === clave) : archivos;

  if (objetivo.length === 0) {
    console.error(
      `No hay ningún archivo con la clave "${clave}". Configurados: ` +
        archivos.map((a) => a.clave).join(", "),
    );
    process.exitCode = 1;
    return;
  }

  if (soloProbar) {
    for (const a of objetivo) {
      const r = await cs.probar(a.clave);
      console.log(`\n${a.clave} — ${a.nombre}`);
      console.log(`  ${r.ruta}`);
      console.log(`  ${r.ok ? "✅" : "❌"} ${r.mensaje}`);
    }
    return;
  }

  console.log(`Sincronizando ${objetivo.length} archivo(s)${forzar ? " (forzado)" : ""}…\n`);

  for (const a of objetivo) {
    const r = await cs.sincronizarArchivo(a.clave, { forzar });

    if (r.omitido) {
      console.log(`⏭️  ${r.clave}: ${r.motivo}`);
      continue;
    }
    if (!r.ok) {
      console.log(`❌ ${r.clave}: ${r.mensaje}`);
      process.exitCode = 1;
      continue;
    }
    if (r.sinCambios) {
      console.log(`✔️  ${r.clave}: sin cambios desde la última lectura`);
      continue;
    }

    console.log(
      `✅ ${r.clave}: ${r.leidas} renglones leídos, ${r.guardadas} guardados ` +
        `en ${(r.duracionMs / 1000).toFixed(1)} s`,
    );
    for (const h of r.hojas || []) {
      console.log(`     ${h.hoja.padEnd(20)} ${h.filas} renglones`);
    }
    for (const aviso of r.avisos || []) console.log(`     ⚠️  ${aviso}`);
  }
}

main()
  .catch((e) => {
    console.error("❌", e.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
