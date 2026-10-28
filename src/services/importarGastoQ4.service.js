const db = require("../config/database");
const { parsearGastoQ4, MESES } = require("../utils/gastoQ4ExcelParser");

/**
 * Carga del libro "Budget Acumulado" (gasto indispensable Q4 por área).
 *
 * Se carga una vez. Volver a subirlo REEMPLAZA lo anterior: no es una bitácora
 * de checadas que se va sumando, es un plan, y dos versiones del mismo plan
 * sumadas darían el doble. `gq4_cargas` guarda quién subió qué y cuándo.
 *
 * Un departamento que no esté en `gq4_areas` detiene la carga: con un nombre
 * mal escrito el área saldría partida en dos.
 */

const LOTE = 200;

/** 'S.Patrimonial' → 'spatrimonial', 'Inyección Crocs' → 'inyeccioncrocs'. */
const claveNombre = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

async function catalogoAreas() {
  const { rows } = await db.query("SELECT clave, nombre, alias, orden FROM gq4_areas ORDER BY orden");
  const porAlias = new Map();
  for (const a of rows) {
    for (const k of [a.clave, a.nombre, ...(a.alias || [])]) porAlias.set(claveNombre(k), a);
  }
  return { areas: rows, buscar: (nombre) => porAlias.get(claveNombre(nombre)) || null };
}

const suma = (filas, mes) => filas.reduce((a, f) => a + f[mes], 0);
const redondo = (n) => Math.round(n * 100) / 100;

/** Lee el archivo y lo cruza contra el catálogo de áreas. */
async function leer(archivo, opciones) {
  const r = parsearGastoQ4(archivo, opciones);
  const { areas, buscar } = await catalogoAreas();

  const desconocidas = new Set();
  const filas = r.filas.map((f) => {
    const area = buscar(f.departamento);
    if (!area) desconocidas.add(f.departamento);
    return { ...f, area };
  });

  // Mismo concepto más de una vez en la misma área: en el reporte no se distinguen
  const veces = {};
  for (const f of filas) {
    if (!f.area) continue;
    const k = `${f.area.clave}|${f.concepto.toLowerCase()}`;
    veces[k] = (veces[k] || 0) + 1;
  }
  const repetidos = Object.entries(veces)
    .filter(([, n]) => n > 1)
    .map(([k, n]) => {
      const [clave] = k.split("|");
      const ejemplo = filas.find((f) => f.area?.clave === clave && `${clave}|${f.concepto.toLowerCase()}` === k);
      return { area: ejemplo.area.nombre, concepto: ejemplo.concepto, veces: n };
    });

  const total = redondo(MESES.reduce((a, m) => a + suma(filas, m), 0));
  const totalArchivo = r.totalArchivo
    ? redondo(MESES.reduce((a, m) => a + r.totalArchivo[m], 0))
    : null;

  const porArea = areas
    .map((a) => {
      const delArea = filas.filter((f) => f.area?.clave === a.clave);
      return {
        clave: a.clave,
        nombre: a.nombre,
        conceptos: delArea.length,
        total: redondo(MESES.reduce((s, m) => s + suma(delArea, m), 0)),
      };
    })
    .filter((a) => a.conceptos > 0);

  return {
    ...r,
    filas,
    porArea,
    total,
    totalArchivo,
    // Más de un peso de diferencia: el renglón de sumas no abarca todo, o hay montos perdidos
    cuadra: totalArchivo == null ? null : Math.abs(total - totalArchivo) < 1,
    desconocidas: [...desconocidas],
    repetidos,
  };
}

async function cargaVigente() {
  const { rows } = await db.query(
    `SELECT c.id, c.archivo, c.hoja, c.anio, c.conceptos, c.total::float AS total,
            u.nombre_completo AS usuario,
            to_char(c.creado_en, 'YYYY-MM-DD HH24:MI') AS creado_texto
       FROM gq4_cargas c
       LEFT JOIN usuarios u ON u.id = c.usuario_id
      WHERE EXISTS (SELECT 1 FROM gq4_conceptos k WHERE k.carga_id = c.id)
      ORDER BY c.creado_en DESC LIMIT 1`,
  );
  return rows[0] || null;
}

/** Lo que trae el archivo, sin escribir nada. */
async function analizarArchivo(archivo, opciones = {}) {
  const r = await leer(archivo, opciones);
  return {
    hoja: r.hoja,
    anio: r.anio,
    conceptos: r.filas.length,
    total: r.total,
    totalArchivo: r.totalArchivo,
    cuadra: r.cuadra,
    porArea: r.porArea,
    desconocidas: r.desconocidas,
    repetidos: r.repetidos,
    avisos: r.avisos,
    // Lo que se va a reemplazar
    vigente: await cargaVigente(),
  };
}

/**
 * Carga el archivo y reemplaza lo anterior.
 *
 * @param {String|Buffer} archivo
 * @param {Object} opciones { usuarioId, nombreArchivo }
 */
async function importarArchivo(archivo, opciones = {}) {
  const r = await leer(archivo, opciones);
  if (r.filas.length === 0) {
    const e = new Error("El archivo no trae ningún concepto");
    e.statusCode = 400;
    throw e;
  }
  if (r.desconocidas.length) {
    const e = new Error(
      `Estos departamentos no están en el catálogo de áreas: ${r.desconocidas.join(", ")}. ` +
        "Corrige el nombre en el archivo o pide que se agreguen.",
    );
    e.statusCode = 400;
    throw e;
  }

  const cliente = await db.pool.connect();
  try {
    await cliente.query("BEGIN");
    const anterior = await cliente.query("SELECT count(*)::int AS n FROM gq4_conceptos");
    // Solo queda vigente la carga nueva; las cargas viejas se quedan en la bitácora
    await cliente.query("DELETE FROM gq4_conceptos");

    const { rows: carga } = await cliente.query(
      `INSERT INTO gq4_cargas (archivo, hoja, anio, conceptos, total, usuario_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [opciones.nombreArchivo || null, r.hoja, r.anio, r.filas.length, r.total, opciones.usuarioId || null],
    );
    const cargaId = carga[0].id;

    const cols = ["carga_id", "area_clave", "concepto", "renglon", ...MESES];
    for (let i = 0; i < r.filas.length; i += LOTE) {
      const lote = r.filas.slice(i, i + LOTE);
      const valores = [];
      const params = [];
      lote.forEach((f, j) => {
        const b = j * cols.length;
        valores.push(`(${cols.map((_, k) => `$${b + k + 1}`).join(", ")})`);
        params.push(cargaId, f.area.clave, f.concepto, f.renglon, ...MESES.map((m) => f[m]));
      });
      await cliente.query(`INSERT INTO gq4_conceptos (${cols.join(", ")}) VALUES ${valores.join(", ")}`, params);
    }
    await cliente.query("COMMIT");

    return {
      cargaId,
      hoja: r.hoja,
      conceptos: r.filas.length,
      total: r.total,
      areas: r.porArea.length,
      reemplazados: anterior.rows[0].n,
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
    `SELECT c.id, c.archivo, c.hoja, c.anio, c.conceptos, c.total::float AS total,
            u.nombre_completo AS usuario,
            EXISTS (SELECT 1 FROM gq4_conceptos k WHERE k.carga_id = c.id) AS vigente,
            to_char(c.creado_en, 'YYYY-MM-DD HH24:MI') AS creado_texto
       FROM gq4_cargas c
       LEFT JOIN usuarios u ON u.id = c.usuario_id
      ORDER BY c.creado_en DESC LIMIT $1`,
    [limite],
  );
  return rows;
}

module.exports = { analizarArchivo, importarArchivo, historialCargas, cargaVigente, claveNombre };
