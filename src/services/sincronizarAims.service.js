const fsp = require("fs/promises");
const crypto = require("crypto");
const cron = require("node-cron");
const db = require("../config/database");
const { parsearAims } = require("../utils/aimsExcelParser");
const { elegirArchivo, explicarError } = require("../utils/libroPorRevision");

/**
 * Sincronización del libro de indicadores de AIMS desde la carpeta de red.
 *
 * Igual que CAPEX: se toma el libro de la rev más alta que empiece con el
 * patrón ('KPIs AIMS rev'), se compara un SHA-256 del contenido y solo se
 * relee si cambió o si apareció una rev nueva. La carga reemplaza todo: son
 * doce fichas y unos cien valores.
 */

const CADA_MINUTOS = Number(process.env.AIMS_SYNC_MINUTOS || 20);
const MAXIMO_BYTES = Number(process.env.AIMS_MAX_BYTES || 30 * 1024 * 1024);

async function configDe() {
  const { rows } = await db.query("SELECT * FROM aims_archivo WHERE clave = 'AIMS'");
  if (!rows[0]) throw new Error("No hay configuración de AIMS. Falta correr el seed.");
  return rows[0];
}

async function leerConfig() {
  const { rows } = await db.query(
    `SELECT clave, nombre, carpeta, patron, activo, archivo, revision, huella,
            tamano_bytes, kpis, avisos, ultimo_error,
            to_char(modificado_en,  'YYYY-MM-DD HH24:MI:SS') AS modificado_texto,
            to_char(leido_en,       'YYYY-MM-DD HH24:MI:SS') AS leido_texto,
            to_char(error_en,       'YYYY-MM-DD HH24:MI:SS') AS error_texto,
            to_char(actualizado_en, 'YYYY-MM-DD HH24:MI:SS') AS actualizado_texto
       FROM aims_archivo WHERE clave = 'AIMS'`,
  );
  return rows[0] || null;
}

const mensajeDe = (e, config) =>
  e.code ? explicarError(e, config.carpeta) : e.message;

/** Qué libro elegiría y qué trae, SIN cargar nada. */
async function probar() {
  const config = await configDe();
  try {
    const elegido = await elegirArchivo(config);
    const r = parsearAims(await fsp.readFile(elegido.ruta));
    const meses = r.kpis.reduce((a, k) => a + k.valores.length, 0);
    return {
      ok: true,
      ruta: elegido.ruta,
      archivo: elegido.archivo,
      revision: elegido.revision,
      mensaje:
        `Se leería "${elegido.archivo}": ${r.kpis.length} indicadores, ` +
        `${meses} meses cerrados en total.`,
      avisos: r.avisos,
    };
  } catch (e) {
    return { ok: false, ruta: config.carpeta || null, mensaje: mensajeDe(e, config) };
  }
}

async function guardar(cliente, kpis, archivo, cargaId) {
  // aims_valores cae en cascada
  await cliente.query("DELETE FROM aims_kpis");
  let meses = 0;
  for (const k of kpis) {
    await cliente.query(
      `INSERT INTO aims_kpis
         (codigo, orden, nombre, definicion, calculo, meta_texto, meta, sentido, unidad,
          fuente, agregado, extra, archivo_origen, carga_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [k.codigo, k.orden, k.nombre, k.definicion, k.calculo, k.meta_texto, k.meta, k.sentido,
       k.unidad, k.fuente, k.agregado, k.extra ? JSON.stringify(k.extra) : null, archivo, cargaId],
    );
    for (const v of k.valores) {
      await cliente.query(
        `INSERT INTO aims_valores
           (codigo, anio, mes, valor, numerador, denominador, peso, detalle)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (codigo, anio, mes) DO NOTHING`,
        [k.codigo, v.anio, v.mes, v.valor, v.numerador ?? null, v.denominador ?? null,
         v.peso ?? null, v.detalle ? JSON.stringify(v.detalle) : null],
      );
      meses++;
    }
  }
  return meses;
}

/**
 * Sincroniza el libro.
 *
 * @param {Object} opciones { forzar, usuarioId }
 */
async function sincronizar(opciones = {}) {
  const config = await configDe();
  if (!config.activo && !opciones.forzar) {
    return { ok: true, omitido: true, motivo: "La lectura está apagada" };
  }

  const arranque = Date.now();
  const { rows: bit } = await db.query(
    "INSERT INTO aims_sincronizaciones (usuario_id) VALUES ($1) RETURNING id",
    [opciones.usuarioId || null],
  );
  const cargaId = bit[0].id;

  const cerrarConError = async (mensaje, archivo) => {
    await db.query(
      `UPDATE aims_sincronizaciones
          SET terminada_en = now(), exito = false, duracion_ms = $2, mensaje = $3,
              archivo = COALESCE($4, archivo)
        WHERE id = $1`,
      [cargaId, Date.now() - arranque, mensaje, archivo || null],
    );
    await db.query(
      `UPDATE aims_archivo SET ultimo_error = $1, error_en = now(), actualizado_en = now()
        WHERE clave = 'AIMS'`,
      [mensaje],
    );
    return { ok: false, mensaje };
  };

  let elegido;
  let contenido;
  let st;
  try {
    elegido = await elegirArchivo(config);
    st = await fsp.stat(elegido.ruta);
    if (st.size > MAXIMO_BYTES) {
      return cerrarConError(
        `"${elegido.archivo}" pesa ${(st.size / 1048576).toFixed(1)} MB; revisar que sea el libro correcto.`,
        elegido.archivo,
      );
    }
    contenido = await fsp.readFile(elegido.ruta);
  } catch (e) {
    return cerrarConError(mensajeDe(e, config), elegido?.archivo);
  }

  const huella = crypto.createHash("sha256").update(contenido).digest("hex");
  await db.query(
    "UPDATE aims_sincronizaciones SET archivo = $2, revision = $3 WHERE id = $1",
    [cargaId, elegido.archivo, elegido.revision],
  );

  if (!opciones.forzar && huella === config.huella) {
    await db.query(
      `UPDATE aims_sincronizaciones
          SET terminada_en = now(), exito = true, hubo_cambio = false, duracion_ms = $2
        WHERE id = $1`,
      [cargaId, Date.now() - arranque],
    );
    await db.query(
      `UPDATE aims_archivo SET ultimo_error = NULL, error_en = NULL, actualizado_en = now()
        WHERE clave = 'AIMS'`,
    );
    return { ok: true, sinCambios: true, archivo: elegido.archivo };
  }

  try {
    const r = parsearAims(contenido);
    const cliente = await db.pool.connect();
    let meses = 0;
    try {
      await cliente.query("BEGIN");
      meses = await guardar(cliente, r.kpis, elegido.archivo, cargaId);
      await cliente.query("COMMIT");
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw e;
    } finally {
      cliente.release();
    }

    const avisos = r.avisos.length ? r.avisos.join(" | ") : null;
    await db.query(
      `UPDATE aims_sincronizaciones
          SET terminada_en = now(), exito = true, hubo_cambio = true, kpis = $2, meses = $3,
              duracion_ms = $4, mensaje = $5
        WHERE id = $1`,
      [cargaId, r.kpis.length, meses, Date.now() - arranque, avisos],
    );
    await db.query(
      `UPDATE aims_archivo
          SET archivo = $1, revision = $2, huella = $3, tamano_bytes = $4, modificado_en = $5,
              leido_en = now(), kpis = $6, avisos = $7,
              ultimo_error = NULL, error_en = NULL, actualizado_en = now()
        WHERE clave = 'AIMS'`,
      [elegido.archivo, elegido.revision, huella, st.size, st.mtime, r.kpis.length, avisos],
    );

    return {
      ok: true,
      sinCambios: false,
      archivo: elegido.archivo,
      revision: elegido.revision,
      kpis: r.kpis.length,
      meses,
      avisos: r.avisos,
      duracionMs: Date.now() - arranque,
    };
  } catch (e) {
    return cerrarConError(e.message, elegido.archivo);
  }
}

async function estado() {
  const [config, corridas] = await Promise.all([
    leerConfig(),
    db.query(
      `SELECT id, archivo, revision, exito, hubo_cambio, kpis, meses, duracion_ms, mensaje,
              to_char(iniciada_en, 'YYYY-MM-DD HH24:MI:SS') AS iniciada_texto
         FROM aims_sincronizaciones ORDER BY iniciada_en DESC LIMIT 20`,
    ),
  ]);
  return { config, corridas: corridas.rows, cadaMinutos: CADA_MINUTOS };
}

/** Cambia la carpeta, el principio del nombre o si se vigila. */
async function guardarConfiguracion(cambios) {
  const campos = [];
  const params = [];
  if (cambios.carpeta !== undefined) {
    params.push(String(cambios.carpeta).trim());
    campos.push(`carpeta = $${params.length}`);
  }
  if (cambios.patron !== undefined) {
    const v = String(cambios.patron).trim();
    if (!v) throw new Error("El principio del nombre no puede quedar vacío");
    params.push(v);
    campos.push(`patron = $${params.length}`);
  }
  if (cambios.activo !== undefined) {
    params.push(Boolean(cambios.activo));
    campos.push(`activo = $${params.length}`);
  }
  if (campos.length === 0) return null;

  const limpia =
    cambios.carpeta !== undefined || cambios.patron !== undefined
      ? ", huella = NULL, ultimo_error = NULL, error_en = NULL"
      : "";

  const { rows } = await db.query(
    `UPDATE aims_archivo SET ${campos.join(", ")}${limpia}, actualizado_en = now()
      WHERE clave = 'AIMS' RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// =============================================
// PROGRAMACIÓN
// =============================================

let tarea = null;
let corriendo = false;

function iniciarProgramado() {
  if (tarea) return;
  tarea = cron.schedule(`*/${CADA_MINUTOS} * * * *`, async () => {
    if (corriendo) return;
    corriendo = true;
    try {
      const r = await sincronizar();
      if (r.ok && !r.sinCambios && !r.omitido) {
        console.log(`🔄 AIMS: ${r.archivo}, ${r.kpis} indicadores, ${r.meses} meses`);
      }
      if (r.ok === false) console.warn(`⚠️  AIMS: ${r.mensaje}`);
    } catch (e) {
      console.error("⚠️  AIMS: falló la vuelta —", e.message);
    } finally {
      corriendo = false;
    }
  });
  console.log(`🕒 AIMS: se revisa la carpeta cada ${CADA_MINUTOS} min`);
}

function detenerProgramado() {
  if (!tarea) return;
  tarea.stop();
  tarea = null;
}

module.exports = {
  sincronizar,
  probar,
  estado,
  leerConfig,
  guardarConfiguracion,
  iniciarProgramado,
  detenerProgramado,
};
