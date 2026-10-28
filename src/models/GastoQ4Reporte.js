const db = require("../config/database");
const { cargaVigente } = require("../services/importarGastoQ4.service");

/**
 * Reporte de Gasto Q4: lo que cada área necesita gastar de octubre a diciembre.
 *
 * Son un centenar de conceptos, así que se entregan todos y la pantalla filtra
 * y suma (por área, por mes, por tipo, en pesos o en dólares) sin volver a
 * preguntar al servidor.
 *
 * TIPO DE GASTO — sale de los montos, nadie lo marca:
 *
 *   FIJO      el mismo monto en todos los meses en que aparece, y aparece en
 *             dos o tres (Internet, renta de montacargas; también lo que
 *             Inyección empieza en noviembre y repite en diciembre)
 *   VARIABLE  aparece en dos o tres meses con montos distintos (fletes, aduanas)
 *   UNICO     aparece en un solo mes (seguros, laptops, una certificación)
 *   CERO      ningún mes trae monto (la fiesta de fin de año, que se quitó)
 */

const MESES = ["octubre", "noviembre", "diciembre"];

function tipoGasto(c) {
  const conMonto = MESES.map((m) => c[m]).filter((v) => v !== 0);
  if (conMonto.length === 0) return "CERO";
  if (conMonto.length === 1) return "UNICO";
  return conMonto.every((v) => v === conMonto[0]) ? "FIJO" : "VARIABLE";
}

/** Año y mes de hoy en México: lo que ya pasó ya no se puede decidir. */
async function hoyMexico() {
  const { rows } = await db.query(
    `SELECT extract(year FROM now() AT TIME ZONE 'America/Mexico_City')::int AS anio,
            extract(month FROM now() AT TIME ZONE 'America/Mexico_City')::int AS mes`,
  );
  return rows[0];
}

/**
 * @returns {Object} { carga, areas, conceptos, hoy }
 *   conceptos: [{ id, area, concepto, mostrado, renglon, octubre, noviembre, diciembre, total, tipo }]
 *   `mostrado` lleva un número cuando el mismo concepto se repite en el área
 *   ("Control de proceso (2)"), para poder distinguirlos en la tabla.
 */
async function reporte() {
  const carga = await cargaVigente();
  const { rows: areas } = await db.query("SELECT clave, nombre, orden FROM gq4_areas ORDER BY orden");
  const hoy = await hoyMexico();
  if (!carga) return { carga: null, areas, conceptos: [], hoy };

  const { rows } = await db.query(
    `SELECT id, area_clave AS area, concepto, renglon,
            octubre::float AS octubre, noviembre::float AS noviembre, diciembre::float AS diciembre
       FROM gq4_conceptos
      WHERE carga_id = $1
      ORDER BY renglon`,
    [carga.id],
  );

  const veces = {};
  for (const c of rows) {
    const k = `${c.area}|${c.concepto.toLowerCase()}`;
    veces[k] = (veces[k] || 0) + 1;
  }
  const vistos = {};
  const conceptos = rows.map((c) => {
    const k = `${c.area}|${c.concepto.toLowerCase()}`;
    vistos[k] = (vistos[k] || 0) + 1;
    return {
      ...c,
      mostrado: veces[k] > 1 ? `${c.concepto} (${vistos[k]})` : c.concepto,
      total: Math.round((c.octubre + c.noviembre + c.diciembre) * 100) / 100,
      tipo: tipoGasto(c),
    };
  });

  return { carga, areas, conceptos, hoy };
}

module.exports = { reporte, tipoGasto };
