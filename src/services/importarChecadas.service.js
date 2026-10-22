const db = require("../config/database");
const { parsearTransacciones } = require("../utils/transaccionesExcelParser");

/**
 * Carga del reporte "Transacciones" de Hikvision.
 *
 * No reemplaza nada: cada checada se identifica por empleado + fecha + hora +
 * lector, y si ya estaba se ignora. Así RH puede subir las ventanas de cada
 * corte (7:50 a 8:20, 15:50 a 16:20…) aunque se encimen, o volver a subir un
 * archivo por error, sin duplicar.
 */

const LOTE = 500;
const COLUMNAS = ["empleado_id", "nombre", "departamento", "departamento_ruta", "fecha", "hora", "punto"];

/** Lo que trae el archivo, sin escribir nada. */
async function analizarArchivo(archivo) {
  const r = parsearTransacciones(archivo);
  const personas = new Set(r.filas.map((f) => f.empleado_id)).size;
  const horas = r.filas.map((f) => f.hora).sort();

  // Cuántas ya están en la base: el resto son nuevas
  let yaCargadas = 0;
  if (r.filas.length) {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n
         FROM chk_transacciones t
         JOIN unnest($1::text[], $2::date[], $3::time[], $4::text[]) AS a(empleado_id, fecha, hora, punto)
           ON t.empleado_id = a.empleado_id AND t.fecha = a.fecha
          AND t.hora = a.hora AND t.punto = a.punto`,
      [
        r.filas.map((f) => f.empleado_id),
        r.filas.map((f) => f.fecha),
        r.filas.map((f) => f.hora),
        r.filas.map((f) => f.punto),
      ],
    );
    yaCargadas = rows[0].n;
  }

  return {
    checadas: r.filas.length,
    personas,
    periodoDesde: r.periodoDesde,
    periodoHasta: r.periodoHasta,
    horaMin: horas[0]?.slice(0, 5) || null,
    horaMax: horas[horas.length - 1]?.slice(0, 5) || null,
    yaCargadas,
    nuevas: r.filas.length - yaCargadas,
    avisos: r.avisos,
  };
}

/**
 * Carga el archivo.
 *
 * @param {String|Buffer} archivo
 * @param {Object} opciones { usuarioId, nombreArchivo }
 */
async function importarArchivo(archivo, opciones = {}) {
  const r = parsearTransacciones(archivo);
  if (r.filas.length === 0) {
    const e = new Error("El archivo no trae ninguna checada");
    e.statusCode = 400;
    throw e;
  }

  const cliente = await db.pool.connect();
  try {
    await cliente.query("BEGIN");
    const { rows: carga } = await cliente.query(
      `INSERT INTO chk_cargas (archivo, periodo_desde, periodo_hasta, exportado_en, filas_leidas, usuario_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [opciones.nombreArchivo || null, r.periodoDesde, r.periodoHasta, r.exportadoEn, r.leidas,
       opciones.usuarioId || null],
    );
    const cargaId = carga[0].id;

    let nuevas = 0;
    const cols = [...COLUMNAS, "carga_id"];
    for (let i = 0; i < r.filas.length; i += LOTE) {
      const lote = r.filas.slice(i, i + LOTE);
      const valores = [];
      const params = [];
      lote.forEach((f, j) => {
        const b = j * cols.length;
        valores.push(`(${cols.map((_, k) => `$${b + k + 1}`).join(", ")})`);
        params.push(...COLUMNAS.map((c) => f[c]), cargaId);
      });
      const res = await cliente.query(
        `INSERT INTO chk_transacciones (${cols.join(", ")}) VALUES ${valores.join(", ")}
         ON CONFLICT (empleado_id, fecha, hora, punto) DO NOTHING`,
        params,
      );
      nuevas += res.rowCount;
    }

    await cliente.query(
      "UPDATE chk_cargas SET filas_nuevas = $2, ya_cargadas = $3 WHERE id = $1",
      [cargaId, nuevas, r.filas.length - nuevas],
    );
    await cliente.query("COMMIT");

    return {
      cargaId,
      checadas: r.filas.length,
      nuevas,
      yaCargadas: r.filas.length - nuevas,
      periodoDesde: r.periodoDesde,
      periodoHasta: r.periodoHasta,
      avisos: r.avisos,
    };
  } catch (e) {
    await cliente.query("ROLLBACK");
    throw e;
  } finally {
    cliente.release();
  }
}

/** Últimas cargas, para la pantalla. */
async function historialCargas(limite = 20) {
  const { rows } = await db.query(
    `SELECT c.id, c.archivo, c.filas_leidas, c.filas_nuevas, c.ya_cargadas,
            u.nombre_completo AS usuario,
            to_char(c.periodo_desde, 'YYYY-MM-DD')     AS periodo_desde,
            to_char(c.periodo_hasta, 'YYYY-MM-DD')     AS periodo_hasta,
            to_char(c.exportado_en, 'YYYY-MM-DD HH24:MI') AS exportado_texto,
            to_char(c.creado_en, 'YYYY-MM-DD HH24:MI')    AS creado_texto
       FROM chk_cargas c
       LEFT JOIN usuarios u ON u.id = c.usuario_id
      ORDER BY c.creado_en DESC LIMIT $1`,
    [limite],
  );
  return rows;
}

module.exports = { analizarArchivo, importarArchivo, historialCargas };
