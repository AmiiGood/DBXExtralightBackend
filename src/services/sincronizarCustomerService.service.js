const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const cron = require("node-cron");
const db = require("../config/database");
const {
  parsearKpi,
  parsearMuestras,
} = require("../utils/customerServiceExcelParser");

/**
 * Sincronización de Customer Service desde una carpeta de red.
 *
 * Es el tercer patrón de origen del proyecto. Los otros dos son la carga manual
 * por pantalla (STAFF, Resultados) y la réplica de una base externa (Moldes,
 * TI). Aquí los archivos viven en un recurso compartido y el área los actualiza
 * ahí cada semana; nadie va a subirlos a mano, así que el sistema vigila la
 * carpeta y se entera solo.
 *
 * ---------------------------------------------------------------------------
 * SE COMPARA EL CONTENIDO, NO LA FECHA
 * ---------------------------------------------------------------------------
 * Cada vuelta calcula un SHA-256 del archivo y lo compara con el de la última
 * lectura. Si no cambió, no se lee nada más y la vuelta cuesta lo que cuesta
 * leer unos cientos de KB.
 *
 * La fecha de modificación NO sirve para decidir: abrir un Excel y cerrarlo sin
 * guardar ya la mueve, y estos libros los abren a diario. Con la fecha, el
 * sistema estaría recargando todo el histórico varias veces por semana sin que
 * hubiera cambiado un solo número.
 *
 * ---------------------------------------------------------------------------
 * LO QUE PUEDE SALIR MAL, Y POR QUÉ NINGUNO TUMBA LA APLICACIÓN
 * ---------------------------------------------------------------------------
 *   Sin permiso al recurso     EACCES / EPERM. Pasa el día que el backend corra
 *                              como servicio en vez de como la sesión de un
 *                              usuario. Se registra y se sigue.
 *   Carpeta o archivo ausente  ENOENT. En enero cambia el año del nombre y el
 *                              archivo viejo deja de existir.
 *   Archivo abierto            EBUSY. Alguien lo tiene en Excel. Se reintenta a
 *                              la siguiente vuelta, no es un error de verdad.
 *
 * Los tres dejan el error escrito en `cs_archivos.ultimo_error` y la pantalla lo
 * enseña. Esa es la diferencia entre "el dato está viejo y nadie sabe" y "el
 * dato está viejo porque dice justo por qué".
 */

/** Cada cuánto se revisa la carpeta. El área actualiza semanalmente. */
const CADA_MINUTOS = Number(process.env.CS_SYNC_MINUTOS || 20);

/** Tamaño del lote al escribir en Postgres. */
const LOTE = 1000;

/**
 * Tope de tamaño de archivo, por prudencia.
 *
 * Los dos libros pesan menos de 200 KB. Si un día alguien deja un archivo de
 * gigas en esa ruta con el mismo nombre, más vale fallar con un mensaje claro
 * que intentar meterlo en memoria.
 */
const MAXIMO_BYTES = Number(process.env.CS_MAX_BYTES || 80 * 1024 * 1024);

/** Une carpeta y archivo respetando las rutas UNC de Windows. */
function rutaCompleta(config) {
  return path.win32.join(config.carpeta, config.archivo);
}

/** Traduce los errores del sistema de archivos a algo que se entienda. */
function explicarError(e, ruta) {
  switch (e.code) {
    case "ENOENT":
      return `No se encontró "${ruta}". Revisar que el nombre del archivo sea el correcto; cambia cada año.`;
    case "EACCES":
    case "EPERM":
      return `Sin permiso para leer "${ruta}". La cuenta con la que corre el backend necesita acceso de lectura al recurso compartido.`;
    case "EBUSY":
      return `El archivo está en uso, probablemente abierto en Excel. Se reintenta en la siguiente vuelta.`;
    case "ENOTDIR":
      return `La ruta "${ruta}" no apunta a una carpeta válida.`;
    case "ETIMEDOUT":
    case "ENETUNREACH":
    case "EHOSTUNREACH":
      return `No se pudo llegar al servidor de archivos (${e.code}). Revisar la red.`;
    default:
      return `${e.code || "Error"} al leer "${ruta}": ${e.message}`;
  }
}

/** La configuración de los archivos vigilados. */
async function listarArchivos({ soloActivos = false } = {}) {
  const { rows } = await db.query(
    `SELECT clave, nombre, carpeta, archivo, activo, huella, tamano_bytes, filas,
            ultimo_error,
            to_char(modificado_en,  'YYYY-MM-DD HH24:MI:SS') AS modificado_texto,
            to_char(leido_en,       'YYYY-MM-DD HH24:MI:SS') AS leido_texto,
            to_char(error_en,       'YYYY-MM-DD HH24:MI:SS') AS error_texto,
            to_char(actualizado_en, 'YYYY-MM-DD HH24:MI:SS') AS actualizado_texto
       FROM cs_archivos ${soloActivos ? "WHERE activo" : ""}
      ORDER BY clave`,
  );
  return rows;
}

/**
 * Revisa que un archivo se pueda leer, SIN cargarlo.
 *
 * Es lo que llama el botón de probar conexión de la pantalla: contesta la
 * pregunta "¿el backend alcanza esta ruta?" sin mover ningún dato, que es justo
 * lo que hace falta mientras se gestionan los permisos del recurso compartido.
 */
async function probar(clave) {
  const { rows } = await db.query("SELECT * FROM cs_archivos WHERE clave = $1", [clave]);
  const config = rows[0];
  if (!config) throw new Error(`No hay ningún archivo configurado con la clave "${clave}"`);

  const ruta = rutaCompleta(config);
  try {
    const st = await fsp.stat(ruta);
    if (!st.isFile()) {
      return { ok: false, ruta, mensaje: `"${ruta}" existe pero no es un archivo.` };
    }
    await fsp.access(ruta, fs.constants.R_OK);
    return {
      ok: true,
      ruta,
      tamanoBytes: st.size,
      modificado: st.mtime,
      mensaje: `Se puede leer. ${(st.size / 1024).toFixed(0)} KB, modificado el ${st.mtime.toLocaleString("es-MX")}.`,
    };
  } catch (e) {
    return { ok: false, ruta, codigo: e.code, mensaje: explicarError(e, ruta) };
  }
}

/** Lee el archivo a memoria y devuelve su contenido y su huella. */
async function leerConHuella(ruta) {
  const st = await fsp.stat(ruta);
  if (st.size > MAXIMO_BYTES) {
    throw new Error(
      `"${ruta}" pesa ${(st.size / 1048576).toFixed(1)} MB y el tope es ` +
        `${(MAXIMO_BYTES / 1048576).toFixed(0)} MB. Revisar que sea el archivo correcto.`,
    );
  }
  const contenido = await fsp.readFile(ruta);
  const huella = crypto.createHash("sha256").update(contenido).digest("hex");
  return { contenido, huella, tamano: st.size, modificado: st.mtime };
}

// =============================================
// ESCRITURA
// =============================================

/** UPSERT del KPI. La llave natural es indicador + año + semana + unidad. */
async function guardarKpi(cliente, filas, archivo, cargaId) {
  let guardadas = 0;
  const cols = 13;

  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    const valores = [];
    const params = [];

    lote.forEach((f, j) => {
      const b = j * cols;
      valores.push(
        `(${Array.from({ length: cols }, (_, k) => `$${b + k + 1}`).join(", ")})`,
      );
      params.push(
        f.indicador, f.anio, f.semana, f.bu, f.mes, f.trimestre, f.fecha,
        f.meta, f.valor_general, f.valor_bu, f.ponderacion, archivo, cargaId,
      );
    });

    const { rowCount } = await cliente.query(
      `INSERT INTO cs_kpi
         (indicador, anio, semana, bu, mes, trimestre, fecha,
          meta, valor_general, valor_bu, ponderacion, archivo_origen, carga_id)
       VALUES ${valores.join(", ")}
       ON CONFLICT (indicador, anio, semana, bu) DO UPDATE SET
         mes            = EXCLUDED.mes,
         trimestre      = EXCLUDED.trimestre,
         fecha          = EXCLUDED.fecha,
         meta           = EXCLUDED.meta,
         valor_general  = EXCLUDED.valor_general,
         valor_bu       = EXCLUDED.valor_bu,
         ponderacion    = EXCLUDED.ponderacion,
         archivo_origen = EXCLUDED.archivo_origen,
         carga_id       = EXCLUDED.carga_id,
         actualizado_en = now()`,
      params,
    );
    guardadas += rowCount;
  }

  return guardadas;
}

/**
 * Reemplazo completo de las muestras.
 *
 * No hay llave natural con la cual hacer upsert: el 'SAMPLES ID' se repite
 * entre renglones porque un mismo proyecto genera varias solicitudes. Así que
 * se borra y se reinserta.
 *
 * ---------------------------------------------------------------------------
 * SE BORRA TODO, NO SOLO LO DE ESTE ARCHIVO
 * ---------------------------------------------------------------------------
 * La tabla queda siendo exactamente lo que dice el libro configurado hoy, y
 * nada más. Borrar solo `archivo_origen = archivo` dejaría los renglones del
 * nombre anterior conviviendo con los nuevos, y como no hay llave natural
 * nadie los reconocería como repetidos: el total simplemente se duplicaría.
 * Pasó en pruebas —177 muestras se volvieron 354 al cambiar el nombre del
 * archivo— y le pasaría a cualquiera que renombre el libro a media temporada.
 *
 * El lado del KPI no necesita esto porque sí tiene llave natural (indicador,
 * año, semana, unidad) y por eso ahí sí se conserva el histórico de los años
 * anteriores al apuntar al libro nuevo. Aquí no se puede, y vale más un total
 * correcto que un histórico que nadie pidió: el libro de 2026 ya arrastra los
 * renglones de diciembre de 2025 por su cuenta.
 */
async function guardarMuestras(cliente, filas, archivo, cargaId) {
  await cliente.query("DELETE FROM cs_muestras");
  if (filas.length === 0) return 0;

  const campos = [
    "area", "periodo", "bu", "tipo", "familia", "cliente", "muestra_id",
    "inicio", "fin", "dias_proceso", "dias_objetivo", "sku", "descripcion",
    "cantidad", "pares", "en_tiempo", "con_retraso", "estado", "entrega",
    "comentarios",
  ];
  const cols = campos.length + 2;
  let guardadas = 0;

  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    const valores = [];
    const params = [];

    lote.forEach((f, j) => {
      const b = j * cols;
      valores.push(
        `(${Array.from({ length: cols }, (_, k) => `$${b + k + 1}`).join(", ")})`,
      );
      params.push(...campos.map((c) => f[c] ?? null), archivo, cargaId);
    });

    const { rowCount } = await cliente.query(
      `INSERT INTO cs_muestras (${campos.join(", ")}, archivo_origen, carga_id)
       VALUES ${valores.join(", ")}`,
      params,
    );
    guardadas += rowCount;
  }

  return guardadas;
}

// =============================================
// SINCRONIZACIÓN
// =============================================

/**
 * Sincroniza un archivo.
 *
 * @param {String}  clave      KPI | MUESTRAS
 * @param {Object}  opciones   { forzar, usuarioId }
 *   `forzar` relee aunque la huella no haya cambiado. Sirve cuando se corrigió
 *   algo del lado del sistema y hay que volver a procesar el mismo archivo.
 */
async function sincronizarArchivo(clave, opciones = {}) {
  const { rows } = await db.query("SELECT * FROM cs_archivos WHERE clave = $1", [clave]);
  const config = rows[0];
  if (!config) throw new Error(`No hay ningún archivo configurado con la clave "${clave}"`);
  if (!config.activo && !opciones.forzar) {
    return { clave, omitido: true, motivo: "El archivo está marcado como inactivo" };
  }

  const ruta = rutaCompleta(config);
  const arranque = Date.now();

  const { rows: bit } = await db.query(
    `INSERT INTO cs_sincronizaciones (clave, archivo, usuario_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [clave, config.archivo, opciones.usuarioId || null],
  );
  const cargaId = bit[0].id;

  const cerrarConError = async (mensaje) => {
    await db.query(
      `UPDATE cs_sincronizaciones
          SET terminada_en = now(), exito = false, duracion_ms = $2, mensaje = $3
        WHERE id = $1`,
      [cargaId, Date.now() - arranque, mensaje],
    );
    await db.query(
      `UPDATE cs_archivos
          SET ultimo_error = $2, error_en = now(), actualizado_en = now()
        WHERE clave = $1`,
      [clave, mensaje],
    );
  };

  let leido;
  try {
    leido = await leerConHuella(ruta);
  } catch (e) {
    const mensaje = e.code ? explicarError(e, ruta) : e.message;
    await cerrarConError(mensaje);
    // No se lanza: que un archivo no se alcance no debe tumbar la vuelta del
    // otro ni la aplicación. Queda escrito y la pantalla lo enseña.
    return { clave, ok: false, ruta, mensaje };
  }

  // Sin cambios: no se toca nada más
  if (!opciones.forzar && leido.huella === config.huella) {
    await db.query(
      `UPDATE cs_sincronizaciones
          SET terminada_en = now(), exito = true, hubo_cambio = false, duracion_ms = $2
        WHERE id = $1`,
      [cargaId, Date.now() - arranque],
    );
    await db.query(
      `UPDATE cs_archivos
          SET ultimo_error = NULL, error_en = NULL, actualizado_en = now()
        WHERE clave = $1`,
      [clave],
    );
    return { clave, ok: true, sinCambios: true, ruta, huella: leido.huella };
  }

  try {
    const resultado =
      clave === "KPI" ? parsearKpi(leido.contenido) : parsearMuestras(leido.contenido);

    if (resultado.filas.length === 0) {
      const mensaje =
        `El archivo se leyó pero no trae ningún renglón utilizable. ` +
        (resultado.avisos.join(" ") || "Revisar que sea el libro correcto.");
      await cerrarConError(mensaje);
      return { clave, ok: false, ruta, mensaje, avisos: resultado.avisos };
    }

    const cliente = await db.pool.connect();
    let guardadas = 0;
    try {
      await cliente.query("BEGIN");
      guardadas =
        clave === "KPI"
          ? await guardarKpi(cliente, resultado.filas, config.archivo, cargaId)
          : await guardarMuestras(cliente, resultado.filas, config.archivo, cargaId);
      await cliente.query("COMMIT");
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw e;
    } finally {
      cliente.release();
    }

    const duracion = Date.now() - arranque;

    await db.query(
      `UPDATE cs_sincronizaciones
          SET terminada_en = now(), exito = true, hubo_cambio = true,
              filas_leidas = $2, filas_cargadas = $3, duracion_ms = $4, mensaje = $5
        WHERE id = $1`,
      [cargaId, resultado.filas.length, guardadas, duracion,
       resultado.avisos.length ? resultado.avisos.join(" | ") : null],
    );
    await db.query(
      `UPDATE cs_archivos
          SET huella = $2, tamano_bytes = $3, modificado_en = $4, leido_en = now(),
              filas = $5, ultimo_error = NULL, error_en = NULL, actualizado_en = now()
        WHERE clave = $1`,
      [clave, leido.huella, leido.tamano, leido.modificado, resultado.filas.length],
    );

    return {
      clave, ok: true, sinCambios: false, ruta,
      leidas: resultado.filas.length,
      guardadas,
      hojas: resultado.hojas,
      avisos: resultado.avisos,
      duracionMs: duracion,
    };
  } catch (e) {
    await cerrarConError(e.message);
    return { clave, ok: false, ruta, mensaje: e.message };
  }
}

/** Sincroniza todos los archivos activos. */
async function sincronizar(opciones = {}) {
  const archivos = await listarArchivos({ soloActivos: !opciones.forzar });
  const resultados = [];
  for (const a of archivos) {
    resultados.push(await sincronizarArchivo(a.clave, opciones));
  }
  return resultados;
}

/** Estado de los archivos y de las últimas corridas, para la pantalla. */
async function estado() {
  const [archivos, corridas, conteos] = await Promise.all([
    listarArchivos(),
    db.query(
      `SELECT id, clave, archivo, exito, hubo_cambio, filas_leidas, filas_cargadas,
              duracion_ms, mensaje,
              to_char(iniciada_en, 'YYYY-MM-DD HH24:MI:SS') AS iniciada_texto
         FROM cs_sincronizaciones ORDER BY iniciada_en DESC LIMIT 20`,
    ),
    db.query(
      `SELECT (SELECT COUNT(*)::int FROM cs_kpi)      AS kpi,
              (SELECT COUNT(*)::int FROM cs_muestras) AS muestras`,
    ),
  ]);

  return {
    archivos,
    corridas: corridas.rows,
    conteos: conteos.rows[0],
    cadaMinutos: CADA_MINUTOS,
  };
}

/** Cambia la configuración de un archivo desde la pantalla. */
async function guardarConfiguracion(clave, { carpeta, archivo, activo }) {
  const campos = [];
  const params = [clave];
  const add = (sql, valor) => {
    params.push(valor);
    campos.push(sql.replace("?", `$${params.length}`));
  };

  if (carpeta !== undefined) add("carpeta = ?", String(carpeta).trim());
  if (archivo !== undefined) add("archivo = ?", String(archivo).trim());
  if (activo !== undefined) add("activo = ?", Boolean(activo));
  if (campos.length === 0) return null;

  // Si cambió de archivo, la huella vieja ya no significa nada: se limpia para
  // que la siguiente vuelta lo lea aunque por casualidad pese lo mismo.
  const limpiaHuella =
    carpeta !== undefined || archivo !== undefined
      ? ", huella = NULL, ultimo_error = NULL, error_en = NULL"
      : "";

  const { rows } = await db.query(
    `UPDATE cs_archivos SET ${campos.join(", ")}${limpiaHuella}, actualizado_en = now()
      WHERE clave = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// =============================================
// PROGRAMACIÓN
// =============================================

let tarea = null;
let corriendo = false;

/** Arranca la vigilancia periódica de la carpeta. */
function iniciarProgramado() {
  if (tarea) return;

  tarea = cron.schedule(`*/${CADA_MINUTOS} * * * *`, async () => {
    if (corriendo) {
      console.warn("⏭️  Customer Service: se omite la vuelta, la anterior sigue en curso");
      return;
    }
    corriendo = true;
    try {
      const r = await sincronizar();
      const cambiaron = r.filter((x) => x.ok && !x.sinCambios);
      const fallaron = r.filter((x) => x.ok === false);
      if (cambiaron.length) {
        console.log(
          "🔄 Customer Service: " +
            cambiaron.map((x) => `${x.clave} ${x.guardadas} renglones`).join(", "),
        );
      }
      for (const f of fallaron) {
        console.warn(`⚠️  Customer Service (${f.clave}): ${f.mensaje}`);
      }
    } catch (e) {
      console.error("⚠️  Customer Service: falló la vuelta —", e.message);
    } finally {
      corriendo = false;
    }
  });

  console.log(
    `🕒 Customer Service: se revisa la carpeta de red cada ${CADA_MINUTOS} min`,
  );
}

function detenerProgramado() {
  if (!tarea) return;
  tarea.stop();
  tarea = null;
}

module.exports = {
  sincronizar,
  sincronizarArchivo,
  probar,
  estado,
  listarArchivos,
  guardarConfiguracion,
  iniciarProgramado,
  detenerProgramado,
  rutaCompleta,
};
