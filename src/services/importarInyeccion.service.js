const db = require("../config/database");
const { parseProduccionInyeccion } = require("../utils/inyeccionExcelParser");

/**
 * Importación de "Producción Inyección.xlsx" a iny_produccion.
 *
 * Lo usan tanto el endpoint de subida como el script de línea de comandos
 * (scripts/importar-inyeccion.js), para que la carga histórica y la del día a
 * día pasen exactamente por el mismo camino.
 */

// Filas por INSERT. Con 17 columnas son 34,000 parámetros por statement, muy
// por debajo del tope de 65,535 de Postgres.
const LOTE = 2000;

// Por debajo de este volumen no compensa reconstruir índices
const UMBRAL_SIN_INDICES = 20000;

const fmt = (n) => Number(n).toLocaleString("es-MX");

async function cargarCatalogos(cliente) {
  const q = async (sql) => (await cliente.query(sql)).rows;

  const turnos = new Map();
  for (const t of await q("SELECT id, nombre FROM turnos")) {
    const m = String(t.nombre).trim().toUpperCase().match(/([ABC])\s*$/);
    if (m) turnos.set(m[1], t.id);
  }

  const maquinas = new Map();
  for (const m of await q("SELECT id, codigo FROM iny_maquinas")) {
    maquinas.set(m.codigo.toUpperCase(), m.id);
  }

  const estaciones = new Map();
  for (const e of await q("SELECT id, maquina_id, codigo FROM iny_estaciones")) {
    estaciones.set(`${e.maquina_id}|${e.codigo}`, e.id);
  }

  const modelos = new Map();
  for (const m of await q("SELECT id, nombre FROM modelos")) {
    modelos.set(m.nombre.trim().toUpperCase(), m.id);
  }

  return { turnos, maquinas, estaciones, modelos };
}

/**
 * Da de alta en iny_productos los SKUs que aún no existen. Devuelve sku -> id.
 */
async function sincronizarProductos(cliente, productos, modelos) {
  const existentes = new Map();
  for (const p of (await cliente.query("SELECT id, sku FROM iny_productos")).rows) {
    existentes.set(p.sku, p.id);
  }

  const nuevos = [...productos.values()].filter((p) => !existentes.has(p.sku));
  for (let i = 0; i < nuevos.length; i += LOTE) {
    const lote = nuevos.slice(i, i + LOTE);
    const valores = [];
    const marcadores = lote.map((p, j) => {
      const b = j * 8;
      valores.push(
        p.sku,
        p.descripcion,
        p.modelo ? (modelos.get(p.modelo.toUpperCase()) ?? null) : null,
        p.color,
        p.variante,
        p.talla,
        p.bu,
        "HISTORICO",
      );
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`;
    });
    const res = await cliente.query(
      `INSERT INTO iny_productos
         (sku, descripcion, modelo_id, color_codigo, variante, talla, bu_reporte, origen)
       VALUES ${marcadores.join(",")}
       ON CONFLICT (sku) DO NOTHING
       RETURNING id, sku`,
      valores,
    );
    for (const r of res.rows) existentes.set(r.sku, r.id);
  }

  return { mapa: existentes, altas: nuevos.length };
}

/**
 * Corre `fn` con los índices secundarios quitados y los reconstruye al final.
 *
 * En Postgres el DDL es transaccional: si algo truena y se hace ROLLBACK, los
 * índices vuelven solos. La llave primaria nunca se toca.
 */
async function sinIndicesSecundarios(cliente, tabla, fn) {
  const { rows } = await cliente.query(
    `SELECT i.indexname, i.indexdef, c.conname,
            CASE WHEN c.oid IS NULL THEN NULL ELSE pg_get_constraintdef(c.oid) END AS condef
       FROM pg_indexes i
       LEFT JOIN pg_constraint c
              ON c.conname = i.indexname AND c.contype IN ('p','u')
      WHERE i.schemaname = 'public' AND i.tablename = $1`,
    [tabla],
  );

  const restaurar = [];
  for (const r of rows) {
    if (r.condef && r.condef.startsWith("PRIMARY KEY")) continue;
    if (r.conname) {
      await cliente.query(`ALTER TABLE public.${tabla} DROP CONSTRAINT "${r.conname}"`);
      restaurar.push(`ALTER TABLE public.${tabla} ADD CONSTRAINT "${r.conname}" ${r.condef}`);
    } else {
      await cliente.query(`DROP INDEX public."${r.indexname}"`);
      restaurar.push(r.indexdef);
    }
  }

  const resultado = await fn();

  const t0 = Date.now();
  for (const sql of restaurar) await cliente.query(sql);
  return { resultado, indices: restaurar.length, segundos: (Date.now() - t0) / 1000 };
}

/**
 * Resuelve los ids de catálogo de cada fila y las inserta por lotes.
 */
async function insertarFilas(
  cliente,
  { filas, cat, skuId, cargaId, usuarioId, alAvanzar },
) {
  let sinMaquinaCat = 0;
  let sinTurnoCat = 0;
  const maquinasDesconocidas = new Set();
  const pendientes = [];

  for (const f of filas) {
    let maquinaId = null;
    let turnoId = null;

    if (f.tipo === "PRODUCCION") {
      maquinaId = cat.maquinas.get(f.maquina);
      if (!maquinaId) {
        sinMaquinaCat++;
        maquinasDesconocidas.add(f.maquina);
        continue;
      }
      turnoId = cat.turnos.get(f.turno);
      if (!turnoId) {
        sinTurnoCat++;
        continue;
      }
    }

    pendientes.push([
      f.tipo,
      f.fecha,
      turnoId,
      maquinaId,
      maquinaId && f.estacion
        ? (cat.estaciones.get(`${maquinaId}|${f.estacion}`) ?? null)
        : null,
      f.sku ? (skuId.get(f.sku) ?? null) : null,
      f.modelo ? (cat.modelos.get(f.modelo.toUpperCase()) ?? null) : null,
      f.bu,
      f.cavidades,
      f.contadorInicial,
      f.contadorFinal,
      f.produccion,
      f.scrap,
      "IMPORTACION",
      cargaId,
      f.estacionOrigen,
      usuarioId,
    ]);
  }

  const N = 17;
  let insertadas = 0;
  for (let i = 0; i < pendientes.length; i += LOTE) {
    const lote = pendientes.slice(i, i + LOTE);
    const valores = [];
    const marcadores = lote.map((row, j) => {
      const b = j * N;
      valores.push(...row);
      return "(" + Array.from({ length: N }, (_, k) => `$${b + k + 1}`).join(",") + ")";
    });
    await cliente.query(
      `INSERT INTO iny_produccion
         (tipo, fecha, turno_id, maquina_id, estacion_id, producto_id,
          modelo_id, bu_reporte, cavidades, contador_inicial, contador_final,
          produccion, scrap, origen, carga_id, estacion_origen, registrado_por)
       VALUES ${marcadores.join(",")}`,
      valores,
    );
    insertadas += lote.length;
    alAvanzar?.(insertadas, pendientes.length);
  }

  return { insertadas, sinMaquinaCat, sinTurnoCat, maquinasDesconocidas };
}

/**
 * Lee el archivo y resume qué contiene, SIN tocar la base.
 *
 * Es lo que ve el usuario antes de confirmar la carga.
 *
 * @param {String|Buffer} archivo
 * @returns {Object} resumen + rango de fechas + qué ya existe en ese rango
 */
async function analizarArchivo(archivo) {
  const { filas, productos, resumen, advertencias } =
    parseProduccionInyeccion(archivo);

  if (filas.length === 0) {
    return { resumen, advertencias, filas: 0, productos: productos.size };
  }

  const fechas = filas.map((f) => f.fecha);
  const fechaMin = fechas.reduce((a, b) => (a < b ? a : b));
  const fechaMax = fechas.reduce((a, b) => (a > b ? a : b));

  // Lo que ya está cargado en ese mismo rango: es lo que se reemplazaría
  const { rows } = await db.query(
    `SELECT count(*)::int AS existentes,
            count(*) FILTER (WHERE origen = 'IMPORTACION')::int AS importados,
            count(*) FILTER (WHERE origen = 'FORMULARIO')::int AS capturados
       FROM iny_produccion
      WHERE fecha BETWEEN $1 AND $2`,
    [fechaMin, fechaMax],
  );

  // Totales del archivo, por BU, para poder compararlos con lo que ya hay
  const porBu = new Map();
  for (const f of filas) {
    const k = f.bu || "(sin BU)";
    if (!porBu.has(k)) porBu.set(k, { bu: k, filas: 0, produccion: 0, scrap: 0 });
    const v = porBu.get(k);
    v.filas++;
    v.produccion += f.produccion || 0;
    v.scrap += f.scrap || 0;
  }

  return {
    resumen,
    advertencias,
    filas: filas.length,
    productos: productos.size,
    fechaMin,
    fechaMax,
    yaCargado: rows[0],
    porBu: [...porBu.values()].sort((a, b) => b.produccion - a.produccion),
  };
}

/**
 * Importa el archivo completo dentro de una transacción.
 *
 * Reemplaza el rango de fechas que trae el archivo, pero SOLO lo que cargó una
 * importación previa: lo capturado por formulario nunca se borra. Así pueden
 * convivir máquinas ya migradas al formulario con el resto todavía en Excel.
 *
 * @param {String|Buffer} archivo
 * @param {Object} opciones { nombreArchivo, usuarioId, reemplazar, alAvanzar }
 */
async function importarArchivo(archivo, opciones = {}) {
  const inicio = Date.now();
  const { filas, productos, resumen, advertencias } =
    parseProduccionInyeccion(archivo);

  if (filas.length === 0) {
    const e = new Error("El archivo no tiene filas que cargar");
    e.statusCode = 400;
    throw e;
  }

  const fechas = filas.map((f) => f.fecha);
  const fechaMin = fechas.reduce((a, b) => (a < b ? a : b));
  const fechaMax = fechas.reduce((a, b) => (a > b ? a : b));

  const cliente = await db.pool.connect();
  try {
    await cliente.query("BEGIN");

    const yaHay = await cliente.query(
      `SELECT count(*)::int c FROM iny_produccion
        WHERE origen = 'IMPORTACION' AND fecha BETWEEN $1 AND $2`,
      [fechaMin, fechaMax],
    );

    if (yaHay.rows[0].c > 0 && !opciones.reemplazar) {
      const e = new Error(
        `Ya hay ${fmt(yaHay.rows[0].c)} registros importados entre ${fechaMin} y ` +
          `${fechaMax}. Confirma el reemplazo para volver a cargarlos.`,
      );
      e.statusCode = 409;
      e.detalle = { existentes: yaHay.rows[0].c, fechaMin, fechaMax };
      throw e;
    }

    let reemplazados = 0;
    if (yaHay.rows[0].c > 0) {
      const del = await cliente.query(
        `DELETE FROM iny_produccion
          WHERE origen = 'IMPORTACION' AND fecha BETWEEN $1 AND $2`,
        [fechaMin, fechaMax],
      );
      reemplazados = del.rowCount;
    }

    const cat = await cargarCatalogos(cliente);
    if (cat.maquinas.size === 0) {
      const e = new Error(
        "No hay máquinas dadas de alta. Falta correr el archivo de seed.",
      );
      e.statusCode = 500;
      throw e;
    }

    const { mapa: skuId, altas } = await sincronizarProductos(
      cliente,
      productos,
      cat.modelos,
    );

    const argumentos = {
      filas,
      cat,
      skuId,
      cargaId: null,
      usuarioId: opciones.usuarioId,
      alAvanzar: opciones.alAvanzar,
    };

    // La bitácora se crea antes para poder colgarle los renglones
    const carga = await cliente.query(
      `INSERT INTO iny_cargas (nombre_archivo, total_registros, cargado_por)
       VALUES ($1, $2, $3) RETURNING id`,
      [opciones.nombreArchivo || "carga.xlsx", resumen.totalHoja, opciones.usuarioId],
    );
    argumentos.cargaId = carga.rows[0].id;

    let r;
    let indices = 0;
    if (filas.length >= UMBRAL_SIN_INDICES) {
      const envuelto = await sinIndicesSecundarios(cliente, "iny_produccion", () =>
        insertarFilas(cliente, argumentos),
      );
      r = envuelto.resultado;
      indices = envuelto.indices;
    } else {
      r = await insertarFilas(cliente, argumentos);
    }

    await cliente.query(
      `UPDATE iny_cargas
          SET registros_nuevos = $1, registros_omitidos = $2, detalle = $3
        WHERE id = $4`,
      [
        r.insertadas,
        resumen.totalHoja - r.insertadas,
        JSON.stringify({ resumen, advertencias: advertencias.slice(0, 50) }),
        argumentos.cargaId,
      ],
    );

    await cliente.query("COMMIT");

    return {
      cargaId: argumentos.cargaId,
      insertadas: r.insertadas,
      reemplazados,
      productosNuevos: altas,
      maquinaNoCatalogada: r.sinMaquinaCat,
      turnoNoCatalogado: r.sinTurnoCat,
      maquinasDesconocidas: [...r.maquinasDesconocidas],
      indicesReconstruidos: indices,
      fechaMin,
      fechaMax,
      resumen,
      advertencias,
      duracionMs: Date.now() - inicio,
    };
  } catch (error) {
    await cliente.query("ROLLBACK");
    throw error;
  } finally {
    cliente.release();
  }
}

module.exports = {
  analizarArchivo,
  importarArchivo,
  cargarCatalogos,
  sincronizarProductos,
  insertarFilas,
  sinIndicesSecundarios,
};
