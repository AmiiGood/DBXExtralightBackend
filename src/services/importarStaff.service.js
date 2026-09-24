const db = require("../config/database");
const {
  parsearSeries,
  parsearOpenPo,
  leerSemanaDelNombre,
} = require("../utils/staffExcelParser");

/**
 * Importación del Excel semanal de la junta de STAFF.
 *
 * La comparten el script de línea de comandos y el endpoint de carga, igual
 * que en Inyección y Compound. Un solo archivo alimenta las dos tablas:
 *
 *   series   -> staff_periodos + staff_valores
 *   Open PO  -> staff_open_po
 *
 * La diferencia con los demás importadores del sistema es que aquí NO se borra
 * por rango. El Excel vuelve a traer todo el histórico cada semana, así que la
 * carga hace UPSERT: actualiza lo que cambió, agrega lo nuevo y deja en paz lo
 * que el archivo ya no mencione. Un archivo recortado no puede borrar historia.
 *
 * Open PO sí se reemplaza, pero solo el corte que trae: es una foto de una
 * semana concreta y volver a cargar la misma semana debe dejar una sola.
 */

const LOTE = 1000;

/**
 * Da de alta los periodos que falten y devuelve su id por código.
 *
 * ON CONFLICT sobre `codigo` y no sobre (tipo, anio, numero): las dos llaves
 * existen, pero el código es con el que viajan los valores.
 */
async function asegurarPeriodos(cliente, periodos) {
  if (periodos.length === 0) return new Map();

  for (let i = 0; i < periodos.length; i += LOTE) {
    const lote = periodos.slice(i, i + LOTE);
    const valores = [];
    const params = [];
    lote.forEach((p, j) => {
      const b = j * 5;
      valores.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`);
      params.push(p.codigo, p.tipo, p.anio, p.numero, p.etiqueta);
    });
    await cliente.query(
      `INSERT INTO staff_periodos (codigo, tipo, anio, numero, etiqueta)
       VALUES ${valores.join(", ")}
       ON CONFLICT (codigo) DO UPDATE SET etiqueta = EXCLUDED.etiqueta`,
      params,
    );
  }

  const { rows } = await cliente.query(
    "SELECT id, codigo FROM staff_periodos WHERE codigo = ANY($1)",
    [periodos.map((p) => p.codigo)],
  );
  return new Map(rows.map((r) => [r.codigo, r.id]));
}

/** Inserta o actualiza un lote de valores. */
async function guardarValores(cliente, valores, idPorCodigo, cargaId) {
  let guardadas = 0;

  for (let i = 0; i < valores.length; i += LOTE) {
    const lote = valores.slice(i, i + LOTE);
    const filas = [];
    const params = [];

    for (const v of lote) {
      const periodoId = idPorCodigo.get(v.periodo_codigo);
      if (!periodoId) continue;
      const b = params.length;
      filas.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`);
      params.push(periodoId, v.metrica_codigo, v.valor, cargaId);
    }
    if (filas.length === 0) continue;

    // Solo se pisa lo que vino de una importación: si algún día se captura un
    // valor a mano en el sistema, una recarga del Excel no lo debe borrar.
    const { rowCount } = await cliente.query(
      `INSERT INTO staff_valores (periodo_id, metrica_codigo, valor, carga_id)
       VALUES ${filas.join(", ")}
       ON CONFLICT (periodo_id, metrica_codigo) DO UPDATE SET
         valor          = EXCLUDED.valor,
         carga_id       = EXCLUDED.carga_id,
         actualizado_en = now()
       WHERE staff_valores.origen = 'IMPORTACION'`,
      params,
    );
    guardadas += rowCount;
  }

  return guardadas;
}

/** Reemplaza la foto de PO abierta de una semana de corte. */
async function guardarOpenPo(cliente, filas, corte, cargaId) {
  if (!corte || filas.length === 0) return 0;

  await cliente.query(
    "DELETE FROM staff_open_po WHERE corte_anio = $1 AND corte_semana = $2",
    [corte.anio, corte.semana],
  );

  const valores = [];
  const params = [];
  filas.forEach((f, i) => {
    const b = i * 8;
    valores.push(
      `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8})`,
    );
    params.push(
      corte.anio, corte.semana, f.bu, f.entrega, f.orden, f.meta, f.cantidad, cargaId,
    );
  });

  const { rowCount } = await cliente.query(
    `INSERT INTO staff_open_po
       (corte_anio, corte_semana, bu, entrega, orden, es_meta, cantidad, carga_id)
     VALUES ${valores.join(", ")}`,
    params,
  );
  return rowCount;
}

/** Rango de periodos que abarca un conjunto de valores. */
function rangoDe(valores) {
  if (valores.length === 0) return { min: null, max: null };
  const codigos = valores.map((v) => v.periodo_codigo).sort();
  return { min: codigos[0], max: codigos[codigos.length - 1] };
}

/**
 * Lee el archivo y describe lo que trae, SIN escribir nada.
 *
 * @param {String} archivo        ruta del temporal
 * @param {String} nombreArchivo  nombre original, de donde sale la semana de corte
 */
async function analizarArchivo(archivo, nombreArchivo) {
  const { valores, periodos, avisos } = parsearSeries(archivo);
  const openPo = parsearOpenPo(archivo);
  const corte = leerSemanaDelNombre(nombreArchivo);

  const { min, max } = rangoDe(valores);
  const todos = [...avisos, ...openPo.avisos];

  if (!corte) {
    todos.push(
      "El nombre del archivo no trae la semana ('... WEEK 35.xlsx'), que es el " +
        "único lugar donde viene. La PO abierta no se va a cargar.",
    );
  }

  // Qué tanto de lo que trae el archivo ya está en la base
  let yaCargados = 0;
  if (valores.length) {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n
         FROM staff_valores v
         JOIN staff_periodos p ON p.id = v.periodo_id
        WHERE p.codigo = ANY($1)`,
      [[...new Set(valores.map((v) => v.periodo_codigo))]],
    );
    yaCargados = rows[0].n;
  }

  // Resumen por bloque, que es como se lee la pantalla de carga
  const { rows: metricas } = await db.query(
    "SELECT codigo, bloque FROM staff_metricas",
  );
  const bloquePorMetrica = new Map(metricas.map((m) => [m.codigo, m.bloque]));
  const porBloque = {};
  for (const v of valores) {
    const b = bloquePorMetrica.get(v.metrica_codigo) || "SIN CATÁLOGO";
    porBloque[b] = (porBloque[b] || 0) + 1;
  }

  const desconocidas = [
    ...new Set(valores.filter((v) => !bloquePorMetrica.has(v.metrica_codigo))
      .map((v) => v.metrica_codigo)),
  ];
  if (desconocidas.length) {
    todos.push(
      `Métricas que no están en el catálogo y se van a ignorar: ${desconocidas.join(", ")}.`,
    );
  }

  return {
    valores: valores.length,
    periodos: periodos.length,
    periodoMin: min,
    periodoMax: max,
    anios: [...new Set(periodos.map((p) => p.anio))].sort(),
    porBloque,
    yaCargados,
    corte,
    openPoFilas: openPo.filas.length,
    openPoBus: [...new Set(openPo.filas.map((f) => f.bu))].sort(),
    avisos: todos,
  };
}

/**
 * Carga el archivo.
 *
 * @param {String} archivo
 * @param {Object} opciones  { usuarioId, nombreArchivo, corte }
 *   `corte` permite forzar la semana cuando el nombre del archivo no la trae.
 */
async function importarArchivo(archivo, opciones = {}) {
  const { valores, periodos, avisos } = parsearSeries(archivo);
  const openPo = parsearOpenPo(archivo);
  const corte = opciones.corte || leerSemanaDelNombre(opciones.nombreArchivo);

  if (valores.length === 0) {
    throw new Error("El archivo no trae ningún valor utilizable");
  }

  const { min, max } = rangoDe(valores);
  const arranque = Date.now();

  const cliente = await db.pool.connect();
  try {
    await cliente.query("BEGIN");

    const { rows: carga } = await cliente.query(
      `INSERT INTO staff_cargas
         (archivo, filas_leidas, periodo_min, periodo_max, corte_anio, corte_semana, usuario_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        opciones.nombreArchivo || null, valores.length, min, max,
        corte?.anio || null, corte?.semana || null, opciones.usuarioId || null,
      ],
    );
    const cargaId = carga[0].id;

    // Las métricas fuera del catálogo se descartan aquí y no en la base: la
    // llave foránea abortaría el lote completo por un solo renglón.
    const { rows: catalogo } = await cliente.query("SELECT codigo FROM staff_metricas");
    const conocidas = new Set(catalogo.map((m) => m.codigo));
    const utiles = valores.filter((v) => conocidas.has(v.metrica_codigo));
    const ignoradas = valores.length - utiles.length;

    const idPorCodigo = await asegurarPeriodos(cliente, periodos);
    const guardadas = await guardarValores(cliente, utiles, idPorCodigo, cargaId);
    const openPoFilas = await guardarOpenPo(cliente, openPo.filas, corte, cargaId);

    await cliente.query(
      "UPDATE staff_cargas SET filas_cargadas = $2, open_po_filas = $3 WHERE id = $1",
      [cargaId, guardadas, openPoFilas],
    );
    await cliente.query("COMMIT");

    const todos = [...avisos, ...openPo.avisos];
    if (ignoradas) {
      todos.push(`${ignoradas} valores de métricas fuera del catálogo, ignorados.`);
    }
    if (!corte && openPo.filas.length) {
      todos.push(
        "No se pudo determinar la semana de corte, así que la PO abierta no se cargó.",
      );
    }

    return {
      cargaId,
      valores: guardadas,
      periodos: idPorCodigo.size,
      openPoFilas,
      periodoMin: min,
      periodoMax: max,
      corte,
      avisos: todos,
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
    `SELECT c.id, c.archivo, c.filas_leidas, c.filas_cargadas, c.open_po_filas,
            c.periodo_min, c.periodo_max, c.corte_anio, c.corte_semana,
            u.nombre_completo AS usuario,
            to_char(c.creado_en, 'YYYY-MM-DD HH24:MI') AS creado_texto
       FROM staff_cargas c
       LEFT JOIN usuarios u ON u.id = c.usuario_id
      ORDER BY c.creado_en DESC LIMIT $1`,
    [limite],
  );
  return rows;
}

module.exports = { analizarArchivo, importarArchivo, historialCargas };
