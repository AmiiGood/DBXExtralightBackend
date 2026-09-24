#!/usr/bin/env node
/**
 * Sincroniza los tickets de TI desde osTicket hacia la réplica local.
 *
 * El servidor lo corre solo cada 15 minutos; este script sirve para la carga
 * inicial y para forzar una corrida a mano.
 *
 *   node scripts/sincronizar-ti.js             incremental
 *   node scripts/sincronizar-ti.js --completa  trae todo el histórico
 *   node scripts/sincronizar-ti.js --estado    solo informa, no sincroniza
 */
require("dotenv").config();
const { sincronizar, estado, DEPARTAMENTO } = require("../src/services/sincronizarTi.service");
const db = require("../src/config/database");
const osticket = require("../src/config/osticket");

const n = (v) => Number(v || 0).toLocaleString("es-MX");

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--estado")) {
    const e = await estado();
    console.log(`Réplica: ${n(e.tickets)} tickets (departamento "${DEPARTAMENTO}" de osTicket)`);
    if (e.tickets > 0) console.log(`Rango:   ${e.desde} a ${e.hasta}`);
    if (e.ultimaSincronizacion) {
      const u = e.ultimaSincronizacion;
      console.log(
        `Última:  ${u.iniciada_texto} (${n(u.filas_nuevas)} nuevos, ` +
          `${n(u.filas_modificadas)} modificados, ${u.duracion_ms} ms)`,
      );
    } else {
      console.log("Última:  nunca");
    }
    if (e.enCurso) console.log(`⚠️  Hay una corrida sin terminar (id ${e.enCurso.id})`);
    return;
  }

  const completa = args.includes("--completa");
  console.log(completa ? "Carga completa..." : "Sincronización incremental...");

  const r = await sincronizar({ completa });
  console.log(
    `\nListo en ${(r.duracionMs / 1000).toFixed(1)} s\n` +
      `  Leídos de osTicket: ${n(r.leidas)}\n` +
      `  Nuevos:             ${n(r.nuevas)}\n` +
      `  Actualizados:       ${n(r.modificadas)}\n` +
      `  Corte:              ${r.corte}`,
  );
}

main()
  .catch((e) => {
    console.error("\nFalló:", e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await osticket.pool.end();
    await db.pool.end();
  });
