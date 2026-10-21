const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const cron = require("node-cron");
const db = require("../config/database");
const { parsearCapex, parsearIniziative, leerLibro } = require("../utils/capexExcelParser");

/**
 * Sincronización del plan de CAPEX desde la carpeta de red.
 *
 * Igual que Customer Service (ver `sincronizarCustomerService.service.js`):
 * se vigila la carpeta, se compara un SHA-256 del contenido y solo se relee si
 * cambió. La diferencia es que aquí el nombre del archivo no es fijo.
 *
 * ---------------------------------------------------------------------------
 * SE TOMA LA REV MÁS ALTA
 * ---------------------------------------------------------------------------
 * El libro se guarda como un archivo nuevo en cada revisión, y en la carpeta
 * conviven 'Rev 02', 'Rev 03' y 'Rev 04'. Se configura el principio del nombre
 * y en cada vuelta se elige el de número de Rev más alto. Si dos tienen la
 * misma Rev, gana el más reciente. Los temporales de Excel ('~$...') se
 * ignoran: existen mientras alguien tiene el libro abierto.
 */

const CADA_MINUTOS = Number(process.env.CAPEX_SYNC_MINUTOS || 20);
const MAXIMO_BYTES = Number(process.env.CAPEX_MAX_BYTES || 30 * 1024 * 1024);
const LOTE = 500;

/** Traduce los errores del sistema de archivos a algo que se entienda. */
function explicarError(e, ruta) {
  switch (e.code) {
    case "ENOENT":
      return `No se encontró "${ruta}".`;
    case "EACCES":
    case "EPERM":
      return `Sin permiso para leer "${ruta}". La cuenta con la que corre el backend necesita acceso de lectura al recurso compartido.`;
    case "EBUSY":
      return "El archivo está en uso. Se reintenta en la siguiente vuelta.";
    case "ETIMEDOUT":
    case "ENETUNREACH":
    case "EHOSTUNREACH":
      return `No se pudo llegar al servidor de archivos (${e.code}). Revisar la red.`;
    default:
      return `${e.code || "Error"} al leer "${ruta}": ${e.message}`;
  }
}

const normal = (s) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Elige el libro vigente de la carpeta: el de la Rev más alta.
 *
 * @returns {Object} { archivo, revision, ruta }
 */
async function elegirArchivo(config) {
  const nombres = await fsp.readdir(config.carpeta);
  const prefijo = normal(config.patron);

  const candidatos = [];
  for (const n of nombres) {
    if (n.startsWith("~$") || !/\.xls[xm]$/i.test(n)) continue;
    if (!normal(n).startsWith(prefijo)) continue;
    const m = n.match(/rev\.?\s*0*(\d+)/i);
    const ruta = path.win32.join(config.carpeta, n);
    const st = await fsp.stat(ruta);
    candidatos.push({ archivo: n, revision: m ? Number(m[1]) : null, ruta, mtime: st.mtimeMs });
  }

  if (candidatos.length === 0) {
    const libros = nombres.filter((n) => /\.xls[xm]$/i.test(n) && !n.startsWith("~$"));
    const e = new Error(
      `En la carpeta no hay ningún Excel que empiece con "${config.patron}". ` +
        (libros.length ? `Hay: ${libros.join(", ")}.` : "No hay ningún Excel."),
    );
    e.sinCandidatos = true;
    throw e;
  }

  candidatos.sort((a, b) => (b.revision ?? -1) - (a.revision ?? -1) || b.mtime - a.mtime);
  return candidatos[0];
}

async function configDe() {
  const { rows } = await db.query("SELECT * FROM capex_archivo WHERE clave = 'CAPEX'");
  if (!rows[0]) throw new Error("No hay configuración de CAPEX. Falta correr el seed.");
  return rows[0];
}

async function leerConfig() {
  const { rows } = await db.query(
    `SELECT clave, nombre, carpeta, patron, hoja, bloque, hoja_iniziative, activo, archivo, revision,
            huella, tamano_bytes, filas, aprobados, avisos, ultimo_error,
            to_char(modificado_en,  'YYYY-MM-DD HH24:MI:SS') AS modificado_texto,
            to_char(leido_en,       'YYYY-MM-DD HH24:MI:SS') AS leido_texto,
            to_char(error_en,       'YYYY-MM-DD HH24:MI:SS') AS error_texto,
            to_char(actualizado_en, 'YYYY-MM-DD HH24:MI:SS') AS actualizado_texto
       FROM capex_archivo WHERE clave = 'CAPEX'`,
  );
  return rows[0] || null;
}

/**
 * Revisa que se alcance la carpeta y qué libro elegiría, SIN cargar nada.
 * También lee el bloque, para avisar desde ya si la hoja o el bloque están mal.
 */
async function probar() {
  const config = await configDe();
  try {
    const elegido = await elegirArchivo(config);
    const libro = leerLibro(await fsp.readFile(elegido.ruta));
    const r = parsearCapex(libro, { hoja: config.hoja, bloque: config.bloque });
    const ini = parsearIniziative(libro, { hoja: config.hoja_iniziative });
    const aprobados = r.filas.filter((f) => f.aprobado_foam).length;
    return {
      ok: true,
      ruta: elegido.ruta,
      archivo: elegido.archivo,
      revision: elegido.revision,
      mensaje:
        `Se leería "${elegido.archivo}". El bloque "${config.bloque}" trae ` +
        `${r.filas.length} renglones visibles (${r.ocultos} ocultos que no se leen), ` +
        `${aprobados} con Firmas FOAM en verde. ` +
        (ini.filas.length
          ? `"${config.hoja_iniziative}" trae ${ini.filas.length} iniciativas.`
          : ini.avisos.join(" ")),
      avisos: [...r.avisos, ...ini.avisos],
    };
  } catch (e) {
    return {
      ok: false,
      ruta: config.carpeta,
      mensaje: e.code ? explicarError(e, config.carpeta) : e.message,
    };
  }
}

/** Reemplaza la tabla completa: no hay llave natural (el código se repite). */
async function guardarProyectos(cliente, filas, bloque, archivo, cargaId) {
  await cliente.query("DELETE FROM capex_proyectos");

  const campos = [
    "fila", "codigo", "descripcion", "dueno", "notas", "monto", "monto_texto",
    "monto_relacion_tecnica", "monto_final", "gasto_q1", "gasto_q2", "gasto_q3",
    "gasto_q4", "notas_gasto", "total_gastado", "etapas", "aprobado_foam",
  ];
  const json = new Set(["notas_gasto", "etapas"]);
  const cols = campos.length + 3;
  let guardadas = 0;

  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    const valores = [];
    const params = [];
    lote.forEach((f, j) => {
      const b = j * cols;
      valores.push(`(${Array.from({ length: cols }, (_, k) => `$${b + k + 1}`).join(", ")})`);
      params.push(
        ...campos.map((c) => (json.has(c) && f[c] != null ? JSON.stringify(f[c]) : f[c] ?? null)),
        bloque, archivo, cargaId,
      );
    });
    const { rowCount } = await cliente.query(
      `INSERT INTO capex_proyectos (${campos.join(", ")}, bloque, archivo_origen, carga_id)
       VALUES ${valores.join(", ")}`,
      params,
    );
    guardadas += rowCount;
  }
  return guardadas;
}

/** Igual: reemplazo completo. Son una decena de renglones. */
async function guardarIniziative(cliente, filas, archivo, cargaId) {
  await cliente.query("DELETE FROM capex_iniziative");
  for (const f of filas) {
    await cliente.query(
      `INSERT INTO capex_iniziative
         (fila, codigo, descripcion, owner, planta, estudios, anios, total, archivo_origen, carga_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [f.fila, f.codigo, f.descripcion, f.owner, f.planta, f.estudios,
       JSON.stringify(f.anios), f.total, archivo, cargaId],
    );
  }
  return filas.length;
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
    "INSERT INTO capex_sincronizaciones (usuario_id) VALUES ($1) RETURNING id",
    [opciones.usuarioId || null],
  );
  const cargaId = bit[0].id;

  const cerrarConError = async (mensaje, archivo) => {
    await db.query(
      `UPDATE capex_sincronizaciones
          SET terminada_en = now(), exito = false, duracion_ms = $2, mensaje = $3,
              archivo = COALESCE($4, archivo)
        WHERE id = $1`,
      [cargaId, Date.now() - arranque, mensaje, archivo || null],
    );
    await db.query(
      `UPDATE capex_archivo SET ultimo_error = $1, error_en = now(), actualizado_en = now()
        WHERE clave = 'CAPEX'`,
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
        `"${elegido.archivo}" pesa ${(st.size / 1048576).toFixed(1)} MB; el tope es ` +
          `${(MAXIMO_BYTES / 1048576).toFixed(0)} MB. Revisar que sea el libro correcto.`,
        elegido.archivo,
      );
    }
    contenido = await fsp.readFile(elegido.ruta);
  } catch (e) {
    return cerrarConError(e.code ? explicarError(e, config.carpeta) : e.message, elegido?.archivo);
  }

  const huella = crypto.createHash("sha256").update(contenido).digest("hex");

  await db.query(
    "UPDATE capex_sincronizaciones SET archivo = $2, revision = $3 WHERE id = $1",
    [cargaId, elegido.archivo, elegido.revision],
  );

  if (!opciones.forzar && huella === config.huella) {
    await db.query(
      `UPDATE capex_sincronizaciones
          SET terminada_en = now(), exito = true, hubo_cambio = false, duracion_ms = $2
        WHERE id = $1`,
      [cargaId, Date.now() - arranque],
    );
    await db.query(
      `UPDATE capex_archivo SET ultimo_error = NULL, error_en = NULL, actualizado_en = now()
        WHERE clave = 'CAPEX'`,
    );
    return { ok: true, sinCambios: true, archivo: elegido.archivo };
  }

  try {
    const libro = leerLibro(contenido);
    const r = parsearCapex(libro, { hoja: config.hoja, bloque: config.bloque });
    // Si la hoja de iniciativas falta o cambió, se avisa pero no se detiene
    // la carga del bloque, que es lo principal del reporte.
    const ini = parsearIniziative(libro, { hoja: config.hoja_iniziative });
    r.avisos.push(...ini.avisos);
    if (r.filas.length === 0) {
      return cerrarConError(
        `El bloque "${config.bloque}" no trae ningún renglón visible. ${r.avisos.join(" ")}`,
        elegido.archivo,
      );
    }
    const aprobados = r.filas.filter((f) => f.aprobado_foam).length;

    const cliente = await db.pool.connect();
    let guardadas = 0;
    try {
      await cliente.query("BEGIN");
      guardadas = await guardarProyectos(cliente, r.filas, config.bloque, elegido.archivo, cargaId);
      if (ini.filas.length) {
        await guardarIniziative(cliente, ini.filas, elegido.archivo, cargaId);
      }
      await cliente.query("COMMIT");
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw e;
    } finally {
      cliente.release();
    }

    const avisos = r.avisos.length ? r.avisos.join(" | ") : null;
    await db.query(
      `UPDATE capex_sincronizaciones
          SET terminada_en = now(), exito = true, hubo_cambio = true, filas_cargadas = $2,
              aprobados = $3, duracion_ms = $4, mensaje = $5
        WHERE id = $1`,
      [cargaId, guardadas, aprobados, Date.now() - arranque, avisos],
    );
    await db.query(
      `UPDATE capex_archivo
          SET archivo = $1, revision = $2, huella = $3, tamano_bytes = $4, modificado_en = $5,
              leido_en = now(), filas = $6, aprobados = $7, avisos = $8,
              ultimo_error = NULL, error_en = NULL, actualizado_en = now()
        WHERE clave = 'CAPEX'`,
      [elegido.archivo, elegido.revision, huella, st.size, st.mtime, guardadas, aprobados, avisos],
    );

    return {
      ok: true,
      sinCambios: false,
      archivo: elegido.archivo,
      revision: elegido.revision,
      guardadas,
      aprobados,
      ocultos: r.ocultos,
      avisos: r.avisos,
      duracionMs: Date.now() - arranque,
    };
  } catch (e) {
    return cerrarConError(e.message, elegido.archivo);
  }
}

/** Configuración y últimas corridas, para la pantalla. */
async function estado() {
  const [config, corridas] = await Promise.all([
    leerConfig(),
    db.query(
      `SELECT id, archivo, revision, exito, hubo_cambio, filas_cargadas, aprobados,
              duracion_ms, mensaje,
              to_char(iniciada_en, 'YYYY-MM-DD HH24:MI:SS') AS iniciada_texto
         FROM capex_sincronizaciones ORDER BY iniciada_en DESC LIMIT 20`,
    ),
  ]);
  return { config, corridas: corridas.rows, cadaMinutos: CADA_MINUTOS };
}

/** Cambia la carpeta, el principio del nombre, las hojas, el bloque o si se vigila. */
async function guardarConfiguracion(cambios) {
  const campos = [];
  const params = [];
  for (const c of ["carpeta", "patron", "hoja", "bloque", "hoja_iniziative"]) {
    if (cambios[c] === undefined) continue;
    const v = String(cambios[c]).trim();
    if (!v) throw new Error(`"${c}" no puede quedar vacío`);
    params.push(v);
    campos.push(`${c} = $${params.length}`);
  }
  if (cambios.activo !== undefined) {
    params.push(Boolean(cambios.activo));
    campos.push(`activo = $${params.length}`);
  }
  if (campos.length === 0) return null;

  // Otro origen o otro bloque: la huella vieja ya no dice nada
  const limpia = ["carpeta", "patron", "hoja", "bloque", "hoja_iniziative"]
    .some((c) => cambios[c] !== undefined)
    ? ", huella = NULL, ultimo_error = NULL, error_en = NULL"
    : "";

  const { rows } = await db.query(
    `UPDATE capex_archivo SET ${campos.join(", ")}${limpia}, actualizado_en = now()
      WHERE clave = 'CAPEX' RETURNING *`,
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
        console.log(`🔄 CAPEX: ${r.archivo}, ${r.guardadas} renglones, ${r.aprobados} con firmas FOAM`);
      }
      if (r.ok === false) console.warn(`⚠️  CAPEX: ${r.mensaje}`);
    } catch (e) {
      console.error("⚠️  CAPEX: falló la vuelta —", e.message);
    } finally {
      corriendo = false;
    }
  });
  console.log(`🕒 CAPEX: se revisa la carpeta cada ${CADA_MINUTOS} min`);
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
  elegirArchivo,
  iniciarProgramado,
  detenerProgramado,
};
