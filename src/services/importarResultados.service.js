const db = require("../config/database");
const { parsearResultados } = require("../utils/resultadosExcelParser");

/**
 * Importación del Excel mensual de Resultados ('DATA-FCMX-AAAA Mes.xlsx').
 *
 * La comparten el script de línea de comandos y la pantalla de carga.
 *
 * Igual que en STAFF, la carga hace UPSERT y NO borra por rango: el libro
 * vuelve a traer todo el histórico cada mes, así que actualiza lo que cambió y
 * agrega lo nuevo. Un archivo recortado no puede perder historia.
 *
 * Eso importa más aquí que en ningún otro módulo: el histórico arranca en 2020
 * y no existe en otro lado.
 */

const LOTE = 1000;

/** Inserta o actualiza un lote de valores. */
async function guardarValores(cliente, valores, cargaId) {
  let guardadas = 0;

  for (let i = 0; i < valores.length; i += LOTE) {
    const lote = valores.slice(i, i + LOTE);
    const filas = [];
    const params = [];

    for (const v of lote) {
      const b = params.length;
      filas.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`);
      params.push(v.anio, v.mes, v.bu, v.metrica_codigo, v.valor, cargaId);
    }

    // Solo se pisa lo que vino de una importación: si algún día se corrige un
    // valor a mano en el sistema, una recarga del Excel no lo debe borrar.
    const { rowCount } = await cliente.query(
      `INSERT INTO res_valores (anio, mes, bu, metrica_codigo, valor, carga_id)
       VALUES ${filas.join(", ")}
       ON CONFLICT (anio, mes, bu, metrica_codigo) DO UPDATE SET
         valor          = EXCLUDED.valor,
         carga_id       = EXCLUDED.carga_id,
         actualizado_en = now()
       WHERE res_valores.origen = 'IMPORTACION'`,
      params,
    );
    guardadas += rowCount;
  }

  return guardadas;
}

/**
 * Quita los valores repetidos antes de mandarlos a la base.
 *
 * Hace falta porque el libro dice lo mismo en más de un lugar: la hoja de
 * Personal repite plantilla y horas en su bloque de resumen, y un INSERT con
 * la misma llave dos veces en el MISMO comando revienta con
 * "ON CONFLICT DO UPDATE no puede afectar la fila por segunda vez".
 *
 * Gana el último, que es el que está más abajo en la hoja.
 */
function deduplicar(valores) {
  const mapa = new Map();
  for (const v of valores) {
    mapa.set(`${v.anio}|${v.mes}|${v.bu}|${v.metrica_codigo}`, v);
  }
  return { unicos: [...mapa.values()], repetidos: valores.length - mapa.size };
}

/** Rango de años que abarca un conjunto de valores. */
function rangoDe(valores) {
  if (valores.length === 0) return { min: null, max: null };
  const anios = valores.map((v) => v.anio);
  return { min: Math.min(...anios), max: Math.max(...anios) };
}

/** Resumen por bloque, que es como se lee la pantalla de carga. */
async function resumirPorBloque(valores) {
  const { rows } = await db.query("SELECT codigo, bloque FROM res_metricas");
  const bloquePorMetrica = new Map(rows.map((m) => [m.codigo, m.bloque]));

  const porBloque = {};
  const desconocidas = new Set();
  for (const v of valores) {
    const b = bloquePorMetrica.get(v.metrica_codigo);
    if (!b) desconocidas.add(v.metrica_codigo);
    else porBloque[b] = (porBloque[b] || 0) + 1;
  }
  return { porBloque, desconocidas: [...desconocidas] };
}

/**
 * Lee el archivo y describe lo que trae, SIN escribir nada.
 */
async function analizarArchivo(archivo, nombreArchivo) {
  const leido = parsearResultados(archivo, nombreArchivo);
  const { unicos, repetidos } = deduplicar(leido.valores);
  const { min, max } = rangoDe(unicos);
  const { porBloque, desconocidas } = await resumirPorBloque(unicos);

  const avisos = [...leido.avisos];
  if (desconocidas.length) {
    avisos.push(
      `Métricas fuera del catálogo, se van a ignorar: ${desconocidas.join(", ")}.`,
    );
  }

  // Cuánto de lo que trae el archivo ya está cargado
  let yaCargados = 0;
  if (unicos.length) {
    const { rows } = await db.query(
      "SELECT COUNT(*)::int AS n FROM res_valores WHERE anio BETWEEN $1 AND $2",
      [min, max],
    );
    yaCargados = rows[0].n;
  }

  return {
    valores: unicos.length,
    repetidos,
    anioMin: min,
    anioMax: max,
    anios: [...new Set(unicos.map((v) => v.anio))].sort(),
    porBloque,
    hojasLeidas: leido.hojasLeidas,
    hojasIgnoradas: leido.hojasIgnoradas,
    corte: leido.corte,
    semanaCarga: leido.semanaCarga,
    yaCargados,
    avisos,
  };
}

/**
 * Carga el archivo.
 *
 * @param {String} archivo
 * @param {Object} opciones  { usuarioId, nombreArchivo }
 */
async function importarArchivo(archivo, opciones = {}) {
  const leido = parsearResultados(archivo, opciones.nombreArchivo);
  const { unicos } = deduplicar(leido.valores);

  if (unicos.length === 0) {
    throw new Error("El archivo no trae ningún valor utilizable");
  }

  const { min, max } = rangoDe(unicos);
  const arranque = Date.now();

  const cliente = await db.pool.connect();
  try {
    await cliente.query("BEGIN");

    const { rows: carga } = await cliente.query(
      `INSERT INTO res_cargas
         (archivo, filas_leidas, anio_min, anio_max, corte_anio, corte_mes,
          semana_carga, hojas, usuario_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        opciones.nombreArchivo || null, unicos.length, min, max,
        leido.corte?.anio || null, leido.corte?.mes || null,
        leido.semanaCarga || null,
        leido.hojasLeidas.map((h) => h.hoja).join(", "),
        opciones.usuarioId || null,
      ],
    );
    const cargaId = carga[0].id;

    // Las métricas fuera del catálogo se descartan aquí y no en la base: la
    // llave foránea abortaría el lote completo por un solo renglón.
    const { rows: catalogo } = await cliente.query("SELECT codigo FROM res_metricas");
    const conocidas = new Set(catalogo.map((m) => m.codigo));
    const utiles = unicos.filter((v) => conocidas.has(v.metrica_codigo));
    const ignoradas = unicos.length - utiles.length;

    const guardadas = await guardarValores(cliente, utiles, cargaId);

    await cliente.query(
      "UPDATE res_cargas SET filas_cargadas = $2 WHERE id = $1",
      [cargaId, guardadas],
    );
    await cliente.query("COMMIT");

    const avisos = [...leido.avisos];
    if (ignoradas) {
      avisos.push(`${ignoradas} valores de métricas fuera del catálogo, ignorados.`);
    }

    return {
      cargaId,
      valores: guardadas,
      anioMin: min,
      anioMax: max,
      corte: leido.corte,
      hojasLeidas: leido.hojasLeidas,
      hojasIgnoradas: leido.hojasIgnoradas,
      avisos,
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
    `SELECT c.id, c.archivo, c.filas_leidas, c.filas_cargadas,
            c.anio_min, c.anio_max, c.corte_anio, c.corte_mes, c.semana_carga,
            u.nombre_completo AS usuario,
            to_char(c.creado_en, 'YYYY-MM-DD HH24:MI') AS creado_texto
       FROM res_cargas c
       LEFT JOIN usuarios u ON u.id = c.usuario_id
      ORDER BY c.creado_en DESC LIMIT $1`,
    [limite],
  );
  return rows;
}

module.exports = { analizarArchivo, importarArchivo, historialCargas };
