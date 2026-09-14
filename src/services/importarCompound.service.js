const db = require("../config/database");
const {
  parsearProduccion,
  parsearRecuperacion,
} = require("../utils/compoundExcelParser");

/**
 * Importación de los Excel de Compound.
 *
 * La comparte el script de línea de comandos y el endpoint de carga, igual que
 * en Inyección. Cada archivo va a su tabla:
 *
 *   'Producción Diaria ... .xlsx'  ->  comp_produccion
 *   'Powder recovery.xlsx'         ->  comp_recuperacion
 *
 * El reemplazo se limita al RANGO DE FECHAS del archivo y solo a lo que cargó
 * una importación previa (`origen = 'IMPORTACION'`): así una recarga no pisa
 * nada capturado a mano y no borra periodos que el archivo ya no trae.
 */

const LOTE = 1000;

const COLUMNAS_PRODUCCION = [
  "fecha", "linea", "turno", "supervisor", "produccion_kg", "turno_horas",
  "paro_am", "paro_cc", "paro_lh", "paro_tmm", "paro_plan", "paro_ft", "paro_fp",
  "meta_kg_hora", "meta_turno_kg", "kg_vs_meta", "observaciones",
];

const COLUMNAS_RECUPERACION = [
  "fecha", "bu", "produccion_kg", "consumo_polvo_kg", "purga_kg", "meta",
];

/** Inserta un lote armando un solo INSERT con muchos VALUES. */
async function insertarLote(cliente, tabla, columnas, filas, cargaId) {
  if (filas.length === 0) return 0;

  const cols = [...columnas, "carga_id"];
  const valores = [];
  const params = [];

  filas.forEach((f, i) => {
    const base = i * cols.length;
    valores.push(`(${cols.map((_, j) => `$${base + j + 1}`).join(", ")})`);
    params.push(...columnas.map((c) => f[c] ?? null), cargaId);
  });

  const { rowCount } = await cliente.query(
    `INSERT INTO ${tabla} (${cols.join(", ")}) VALUES ${valores.join(", ")}`,
    params,
  );
  return rowCount;
}

/** Rango de fechas que abarca un conjunto de filas ya parseadas. */
function rangoDe(filas) {
  if (filas.length === 0) return { min: null, max: null };
  const fechas = filas.map((f) => f.fecha).sort();
  return { min: fechas[0], max: fechas[fechas.length - 1] };
}

/**
 * Lee un archivo y describe lo que trae, SIN escribir nada.
 *
 * @param {String} destino  'PRODUCCION' | 'RECUPERACION'
 */
async function analizarArchivo(archivo, destino) {
  const { filas, avisos } =
    destino === "RECUPERACION"
      ? parsearRecuperacion(archivo)
      : parsearProduccion(archivo);

  const { min, max } = rangoDe(filas);
  const resumen = { destino, filas: filas.length, fechaMin: min, fechaMax: max, avisos };

  if (destino === "PRODUCCION") {
    const suma = (k) => filas.reduce((a, f) => a + (Number(f[k]) || 0), 0);
    const paro = suma("paro_am") + suma("paro_cc") + suma("paro_lh") +
      suma("paro_tmm") + suma("paro_plan") + suma("paro_ft") + suma("paro_fp");
    resumen.produccionKg = suma("produccion_kg");
    resumen.turnoHoras = suma("turno_horas");
    resumen.tiempoMuerto = paro;
    resumen.lineas = [...new Set(filas.map((f) => f.linea))].sort();
  } else {
    resumen.produccionKg = filas.reduce((a, f) => a + (Number(f.produccion_kg) || 0), 0);
    resumen.polvoKg = filas.reduce((a, f) => a + (Number(f.consumo_polvo_kg) || 0), 0);
    resumen.bus = [...new Set(filas.map((f) => f.bu))].sort();
  }

  // Qué se borraría si se confirma la carga
  if (min && max) {
    const tabla = destino === "RECUPERACION" ? "comp_recuperacion" : "comp_produccion";
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM ${tabla}
        WHERE fecha BETWEEN $1 AND $2 AND origen = 'IMPORTACION'`,
      [min, max],
    );
    resumen.seReemplazan = rows[0].n;
  } else {
    resumen.seReemplazan = 0;
  }

  return resumen;
}

/**
 * Carga un archivo, reemplazando su rango de fechas.
 *
 * @param {String}  archivo   ruta o Buffer
 * @param {String}  destino   'PRODUCCION' | 'RECUPERACION'
 * @param {Object}  opciones  { usuarioId, nombreArchivo, reemplazar }
 */
async function importarArchivo(archivo, destino, opciones = {}) {
  const esRecuperacion = destino === "RECUPERACION";
  const tabla = esRecuperacion ? "comp_recuperacion" : "comp_produccion";
  const columnas = esRecuperacion ? COLUMNAS_RECUPERACION : COLUMNAS_PRODUCCION;
  const hoja = esRecuperacion ? "Powder recovery" : "Producción compuestos";

  const { filas, avisos } = esRecuperacion
    ? parsearRecuperacion(archivo)
    : parsearProduccion(archivo);

  if (filas.length === 0) {
    throw new Error("El archivo no trae ningún renglón utilizable");
  }

  const { min, max } = rangoDe(filas);
  const arranque = Date.now();

  const cliente = await db.pool.connect();
  try {
    await cliente.query("BEGIN");

    const { rows: carga } = await cliente.query(
      `INSERT INTO comp_cargas
         (archivo, hoja, destino, filas_leidas, fecha_min, fecha_max, usuario_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        opciones.nombreArchivo || null, hoja, destino,
        filas.length, min, max, opciones.usuarioId || null,
      ],
    );
    const cargaId = carga[0].id;

    let borradas = 0;
    if (opciones.reemplazar !== false) {
      const { rowCount } = await cliente.query(
        `DELETE FROM ${tabla}
          WHERE fecha BETWEEN $1 AND $2 AND origen = 'IMPORTACION'`,
        [min, max],
      );
      borradas = rowCount;
    }

    let insertadas = 0;
    for (let i = 0; i < filas.length; i += LOTE) {
      insertadas += await insertarLote(
        cliente, tabla, columnas, filas.slice(i, i + LOTE), cargaId,
      );
    }

    await cliente.query(
      "UPDATE comp_cargas SET filas_cargadas = $2 WHERE id = $1",
      [cargaId, insertadas],
    );
    await cliente.query("COMMIT");

    return {
      cargaId, destino, insertadas, borradas,
      fechaMin: min, fechaMax: max, avisos,
      duracionMs: Date.now() - arranque,
    };
  } catch (e) {
    await cliente.query("ROLLBACK");
    throw e;
  } finally {
    cliente.release();
  }
}

/** Últimas cargas, para la pantalla y el script. */
async function historialCargas(limite = 20) {
  const { rows } = await db.query(
    `SELECT c.id, c.archivo, c.hoja, c.destino, c.filas_leidas, c.filas_cargadas,
            u.nombre_completo AS usuario,
            -- Texto y no Date: evita que el JSON las corra a UTC
            to_char(c.fecha_min, 'YYYY-MM-DD')             AS fecha_min,
            to_char(c.fecha_max, 'YYYY-MM-DD')             AS fecha_max,
            to_char(c.creado_en, 'YYYY-MM-DD HH24:MI')     AS creado_texto
       FROM comp_cargas c
       LEFT JOIN usuarios u ON u.id = c.usuario_id
      ORDER BY c.creado_en DESC LIMIT $1`,
    [limite],
  );
  return rows;
}

module.exports = { analizarArchivo, importarArchivo, historialCargas };
