const cron = require("node-cron");
const db = require("../config/database");
const graph = require("../utils/graphClient");
const compound = require("./importarCompound.service");
const inyeccion = require("./importarInyeccion.service");

/**
 * Sincronización de archivos que viven en SharePoint.
 *
 * Hermano de `sincronizarCustomerService`: allá se vigila una carpeta de red,
 * aquí una carpeta de SharePoint por Microsoft Graph. La diferencia importante
 * es que aquí NO hay un importador propio: el archivo se le pasa tal cual al
 * mismo importador que usa la pantalla de carga de cada reporte. Lo que cambia
 * es quién lo sube, no cómo se carga.
 *
 * ---------------------------------------------------------------------------
 * SE COMPARA EL HASH QUE PUBLICA SHAREPOINT, SIN BAJAR EL ARCHIVO
 * ---------------------------------------------------------------------------
 * Cada archivo trae en sus metadatos un `quickXorHash` del contenido. Si es el
 * mismo de la última lectura no se descarga nada: la vuelta cuesta una consulta
 * y no los ~28 MB del libro de Inyección.
 *
 * ---------------------------------------------------------------------------
 * SE ESPERA A QUE EL ARCHIVO DEJE DE CAMBIAR
 * ---------------------------------------------------------------------------
 * Con el autoguardado de Excel, un libro abierto se guarda en SharePoint cada
 * pocos segundos mientras alguien captura. Leerlo a media captura es cargar un
 * día a medias y, en Inyección, reemplazar todo el rango del archivo por nada.
 * Así que si se modificó hace menos de `REPOSO_MINUTOS`, se deja para la
 * siguiente vuelta.
 *
 * ---------------------------------------------------------------------------
 * UN ARCHIVO QUE FALLA NO SE REINTENTA HASTA QUE CAMBIE
 * ---------------------------------------------------------------------------
 * Si el importador rechaza el libro (hoja renombrada, columnas movidas), volver
 * a bajarlo cada vuelta solo repite el mismo error. Se guarda la huella con la
 * que falló y se espera a que alguien lo corrija y lo guarde.
 */

/** Cada cuánto se revisa SharePoint. */
const CADA_MINUTOS = Number(process.env.SP_SYNC_MINUTOS || 20);

/** Cuánto tiene que llevar quieto un archivo antes de leerlo. */
const REPOSO_MINUTOS = Number(process.env.SP_REPOSO_MINUTOS || 10);

/** Tope de tamaño, igual que en la carga manual de Inyección. */
const MAXIMO_BYTES = Number(process.env.SP_MAX_BYTES || 80 * 1024 * 1024);

/**
 * A qué importador va cada archivo.
 *
 * Para sumar STAFF o Resultados basta con agregarlos aquí y dar de alta su
 * renglón en `sp_archivos`. Cada uno devuelve { insertadas, fechaMin, fechaMax }
 * y, si aplica, cuántos renglones reemplazó.
 */
const IMPORTADORES = {
  COMPOUND_PRODUCCION: {
    reporte: "Compound",
    importar: (contenido, opciones) =>
      compound.importarArchivo(contenido, "PRODUCCION", opciones),
  },
  COMPOUND_RECUPERACION: {
    reporte: "Compound",
    importar: (contenido, opciones) =>
      compound.importarArchivo(contenido, "RECUPERACION", opciones),
  },
  INYECCION: {
    reporte: "Inyección",
    // Sin `reemplazar` el importador se detiene a pedir confirmación cuando ya
    // hay datos en el rango. Aquí no hay a quién preguntarle, y el caso normal
    // es justo ese: el mismo libro con una semana más.
    importar: (contenido, opciones) =>
      inyeccion.importarArchivo(contenido, { ...opciones, reemplazar: true }),
  },
};

// =============================================
// UBICACIÓN
// =============================================

/**
 * Saca host, sitio y ruta de la URL de una carpeta de SharePoint.
 *
 * Acepta las dos formas que da el navegador:
 *   .../sites/FCMX/Shared Documents/Compound
 *   .../sites/FCMX/Shared Documents/Forms/AllItems.aspx?id=/sites/FCMX/Shared Documents/Compound
 *
 * No acepta los enlaces para compartir (/:f:/s/...): son un token opaco y la
 * app, con permiso solo a sitios concretos, no puede resolverlos.
 */
function interpretarUbicacion(texto) {
  let u;
  try {
    u = new URL(String(texto || "").trim());
  } catch {
    throw new Error("La ubicación no es una URL. Pegar la dirección de la carpeta tal como sale en el navegador.");
  }
  if (!/\.sharepoint\.com$/i.test(u.hostname)) {
    throw new Error(`"${u.hostname}" no es un sitio de SharePoint.`);
  }
  if (/^\/:[a-z]:\//i.test(u.pathname)) {
    throw new Error(
      "Es un enlace para compartir y no se puede usar. Abrir la carpeta en el " +
        "navegador y copiar la dirección de la barra.",
    );
  }

  let ruta = u.searchParams.get("id") || u.searchParams.get("RootFolder");
  if (!ruta) {
    ruta = decodeURIComponent(u.pathname).replace(/\/Forms\/[^/]+\.aspx$/i, "");
  }
  ruta = ruta.replace(/\/+$/, "");

  const m = ruta.match(/^(\/(?:sites|teams)\/[^/]+)(\/.*)?$/i);
  return { host: u.hostname, sitio: m ? m[1] : "", ruta };
}

/** Pide todas las páginas de una colección de Graph. */
async function todas(ruta) {
  const items = [];
  let siguiente = ruta;
  while (siguiente) {
    const r = await graph.get(siguiente);
    items.push(...(r.value || []));
    siguiente = r["@odata.nextLink"];
  }
  return items;
}

/** Una ruta de archivo para Graph, escapando cada tramo pero no las diagonales. */
const rutaGraph = (ruta) => ruta.split("/").map(encodeURIComponent).join("/");

/**
 * Las ubicaciones ya resueltas. El sitio y la biblioteca no cambian de id, así
 * que no tiene caso volver a buscarlos cada 20 minutos.
 */
const resueltas = new Map();
const VIGENCIA_MS = 6 * 60 * 60 * 1000;

/**
 * Convierte la URL de la carpeta en { driveId, carpeta } para Graph.
 *
 * La biblioteca se identifica comparando contra el `webUrl` de cada una, y no
 * por su nombre: en un sitio en español la biblioteca se ve como "Documentos"
 * pero su URL sigue siendo "Shared Documents".
 */
async function resolverCarpeta(ubicacion) {
  const hit = resueltas.get(ubicacion);
  if (hit && hit.vence > Date.now()) return hit;

  const { host, sitio, ruta } = interpretarUbicacion(ubicacion);

  let site;
  try {
    site = await graph.get(sitio ? `/sites/${host}:${rutaGraph(sitio)}` : `/sites/${host}`);
  } catch (e) {
    if (e.status === 404) {
      throw new Error(`No existe el sitio "${host}${sitio}". Revisar la URL.`);
    }
    if (e.status === 403) {
      throw new Error(
        `La aplicación no tiene permiso sobre el sitio "${sitio || host}". TI tiene ` +
          `que concederle lectura a ese sitio (ver DESPLIEGUE_SHAREPOINT.md).`,
      );
    }
    throw e;
  }

  const bibliotecas = await todas(`/sites/${site.id}/drives?$select=id,name,webUrl`);
  const buscada = ruta.toLowerCase();
  let mejor = null;
  for (const b of bibliotecas) {
    const p = decodeURIComponent(new URL(b.webUrl).pathname).replace(/\/+$/, "").toLowerCase();
    const coincide = buscada === p || buscada.startsWith(p + "/");
    if (coincide && (!mejor || p.length > mejor.prefijo.length)) mejor = { b, prefijo: p };
  }
  if (!mejor) {
    throw new Error(
      `En el sitio "${site.displayName}" no hay ninguna biblioteca en esa ruta. ` +
        `Las que hay: ${bibliotecas.map((b) => b.name).join(", ") || "ninguna"}.`,
    );
  }

  const resuelta = {
    driveId: mejor.b.id,
    carpeta: ruta.slice(mejor.prefijo.length).replace(/^\/+/, ""),
    sitio: site.displayName,
    biblioteca: mejor.b.name,
    vence: Date.now() + VIGENCIA_MS,
  };
  resueltas.set(ubicacion, resuelta);
  return resuelta;
}

/** Ruta legible para los mensajes: sitio › biblioteca › carpeta › archivo. */
const rutaLegible = (r, archivo) =>
  [r.sitio, r.biblioteca, r.carpeta, archivo].filter(Boolean).join(" › ");

/**
 * Localiza el archivo y trae sus metadatos, SIN bajarlo.
 *
 * @returns {Object} { resuelta, item, ruta }
 */
async function localizar(config) {
  if (!config.ubicacion) {
    throw new Error("Falta la ubicación: pegar la URL de la carpeta de SharePoint.");
  }
  const resuelta = await resolverCarpeta(config.ubicacion);
  const rel = resuelta.carpeta ? `${resuelta.carpeta}/${config.archivo}` : config.archivo;
  const ruta = rutaLegible(resuelta, config.archivo);

  let item;
  try {
    item = await graph.get(`/drives/${resuelta.driveId}/root:/${rutaGraph(rel)}`);
  } catch (e) {
    if (e.status === 404) {
      const err = new Error(
        `No se encontró "${config.archivo}" en ${rutaLegible(resuelta)}. ` +
          `Revisar el nombre; si lleva el año, cambia cada enero.`,
      );
      err.noEncontrado = true;
      err.resuelta = resuelta;
      throw err;
    }
    // Un 403 aquí con el sitio ya resuelto suele ser una biblioteca con
    // permisos propios, distintos a los del sitio.
    if (e.status === 403) {
      resueltas.delete(config.ubicacion);
      throw new Error(`Sin permiso para leer ${ruta}. La biblioteca puede tener permisos propios.`);
    }
    throw e;
  }

  if (!item.file) throw new Error(`${ruta} es una carpeta, no un archivo.`);
  return { resuelta, item, ruta };
}

/** Traduce lo que falla de red o de credenciales a algo accionable. */
function explicarError(e) {
  if (e instanceof graph.GraphError) {
    if (e.status === 401) {
      return "SharePoint rechazó el acceso de la aplicación. Revisar SP_CLIENT_ID y SP_CLIENT_SECRET (el secreto vence).";
    }
    if (e.status === 429 || e.status === 503) {
      return "SharePoint pidió esperar (demasiadas consultas). Se reintenta en la siguiente vuelta.";
    }
    return e.message;
  }
  const red = e.cause?.code || e.code;
  if (["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN",
       "UND_ERR_CONNECT_TIMEOUT"].includes(red)) {
    return (
      `No se pudo llegar a Microsoft (${red}). El servidor necesita salida a internet ` +
      `por HTTPS a login.microsoftonline.com y graph.microsoft.com; si la red usa ` +
      `proxy, ver DESPLIEGUE_SHAREPOINT.md.`
    );
  }
  return e.message;
}

/** La huella del contenido. quickXorHash es lo que publica SharePoint Online. */
const huellaDe = (item) =>
  item.file?.hashes?.quickXorHash || item.file?.hashes?.sha256Hash || item.cTag || null;

/** Texto corto para la pantalla, a partir de lo que devuelve el importador. */
function resumir(r) {
  const fecha = (f) => (f instanceof Date ? f.toISOString().slice(0, 10) : f);
  const reemplazo = r.reemplazados ?? r.borradas;
  return (
    `${Number(r.insertadas).toLocaleString("es-MX")} renglones del ` +
    `${fecha(r.fechaMin)} al ${fecha(r.fechaMax)}` +
    (reemplazo ? `, reemplazó ${Number(reemplazo).toLocaleString("es-MX")}` : "")
  );
}

// =============================================
// CONSULTAS
// =============================================

async function listarArchivos({ soloActivos = false } = {}) {
  const { rows } = await db.query(
    `SELECT clave, nombre, importador, ubicacion, archivo, activo, huella,
            tamano_bytes, modificado_por, filas, resumen, ultimo_error,
            to_char(modificado_en,  'YYYY-MM-DD HH24:MI:SS') AS modificado_texto,
            to_char(leido_en,       'YYYY-MM-DD HH24:MI:SS') AS leido_texto,
            to_char(error_en,       'YYYY-MM-DD HH24:MI:SS') AS error_texto,
            to_char(actualizado_en, 'YYYY-MM-DD HH24:MI:SS') AS actualizado_texto
       FROM sp_archivos ${soloActivos ? "WHERE activo" : ""}
      ORDER BY clave`,
  );
  return rows.map((r) => ({ ...r, reporte: IMPORTADORES[r.importador]?.reporte || null }));
}

async function configDe(clave) {
  const { rows } = await db.query("SELECT * FROM sp_archivos WHERE clave = $1", [clave]);
  if (!rows[0]) throw new Error(`No hay ningún archivo configurado con la clave "${clave}"`);
  return rows[0];
}

/**
 * Revisa que el archivo se alcance, SIN bajarlo ni cargarlo.
 *
 * Es el botón de la pantalla para mientras TI da de alta los permisos: separa
 * "faltan credenciales", "falta permiso al sitio", "la carpeta está mal" y "el
 * archivo se llama distinto". En este último caso dice qué hay en la carpeta.
 */
async function probar(clave) {
  const config = await configDe(clave);
  try {
    const { item, ruta } = await localizar(config);
    const modificado = new Date(item.lastModifiedDateTime);
    const quien = item.lastModifiedBy?.user?.displayName;
    return {
      ok: true,
      ruta,
      tamanoBytes: item.size,
      modificado,
      modificadoPor: quien || null,
      mensaje:
        `Se puede leer. ${(item.size / 1048576).toFixed(1)} MB, modificado el ` +
        `${modificado.toLocaleString("es-MX")}${quien ? ` por ${quien}` : ""}.`,
    };
  } catch (e) {
    let mensaje = explicarError(e);
    if (e.noEncontrado) {
      try {
        const { driveId, carpeta } = e.resuelta;
        const hijos = await todas(
          carpeta
            ? `/drives/${driveId}/root:/${rutaGraph(carpeta)}:/children?$select=name,file`
            : `/drives/${driveId}/root/children?$select=name,file`,
        );
        const libros = hijos.filter((h) => h.file && /\.xls[xmb]?$/i.test(h.name));
        mensaje += libros.length
          ? ` En esa carpeta hay: ${libros.map((h) => h.name).join(", ")}.`
          : " En esa carpeta no hay ningún Excel.";
      } catch {
        // Si ni la carpeta se puede listar, el mensaje original basta
      }
    }
    return { ok: false, mensaje };
  }
}

// =============================================
// SINCRONIZACIÓN
// =============================================

/**
 * Sincroniza un archivo.
 *
 * @param {String} clave
 * @param {Object} opciones { forzar, usuarioId }
 *   `forzar` relee aunque no haya cambiado, aunque se esté editando y aunque
 *   ya haya fallado con ese mismo contenido.
 */
async function sincronizarArchivo(clave, opciones = {}) {
  const config = await configDe(clave);
  const importador = IMPORTADORES[config.importador];
  if (!importador) {
    return { clave, ok: false, mensaje: `No hay importador "${config.importador}" en el servidor` };
  }
  if (!config.activo && !opciones.forzar) {
    return { clave, omitido: true, motivo: "El archivo está marcado como inactivo" };
  }

  const arranque = Date.now();
  const { rows: bit } = await db.query(
    `INSERT INTO sp_sincronizaciones (clave, archivo, usuario_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [clave, config.archivo, opciones.usuarioId || null],
  );
  const corridaId = bit[0].id;

  const cerrar = async ({ exito, cambio = false, filas = 0, mensaje = null }) => {
    await db.query(
      `UPDATE sp_sincronizaciones
          SET terminada_en = now(), exito = $2, hubo_cambio = $3, filas_cargadas = $4,
              duracion_ms = $5, mensaje = $6
        WHERE id = $1`,
      [corridaId, exito, cambio, filas, Date.now() - arranque, mensaje],
    );
  };
  const anotarError = async (mensaje, huellaError) => {
    await cerrar({ exito: false, mensaje });
    await db.query(
      `UPDATE sp_archivos
          SET ultimo_error = $2, error_en = now(), actualizado_en = now(),
              huella_error = COALESCE($3, huella_error)
        WHERE clave = $1`,
      [clave, mensaje, huellaError || null],
    );
    return { clave, ok: false, mensaje };
  };

  // 1. Metadatos. Si falla aquí es acceso, red o ruta: nada que ver con el libro.
  let item;
  try {
    ({ item } = await localizar(config));
  } catch (e) {
    return anotarError(explicarError(e));
  }

  const huella = huellaDe(item);
  const modificado = new Date(item.lastModifiedDateTime);
  const quien = item.lastModifiedBy?.user?.displayName || null;

  if (!opciones.forzar) {
    if (huella && huella === config.huella) {
      await cerrar({ exito: true });
      await db.query(
        `UPDATE sp_archivos SET ultimo_error = NULL, error_en = NULL, actualizado_en = now()
          WHERE clave = $1`,
        [clave],
      );
      return { clave, ok: true, sinCambios: true };
    }
    if (huella && huella === config.huella_error) {
      await cerrar({ exito: false, mensaje: "Mismo contenido que ya falló; se espera a que lo corrijan" });
      return { clave, ok: false, mensaje: config.ultimo_error };
    }
    const quieto = (Date.now() - modificado.getTime()) / 60000;
    if (quieto < REPOSO_MINUTOS) {
      const mensaje =
        `Se modificó hace ${Math.max(0, Math.floor(quieto))} min` +
        (quien ? ` (${quien})` : "") +
        `; se lee cuando lleve ${REPOSO_MINUTOS} min sin cambios.`;
      await cerrar({ exito: true, mensaje });
      return { clave, ok: true, sinCambios: true, enEdicion: true, mensaje };
    }
  }

  if (item.size > MAXIMO_BYTES) {
    return anotarError(
      `El archivo pesa ${(item.size / 1048576).toFixed(1)} MB y el tope es ` +
        `${(MAXIMO_BYTES / 1048576).toFixed(0)} MB. Revisar que sea el correcto.`,
    );
  }

  // 2. Bajarlo
  let contenido;
  try {
    contenido = await graph.descargar(item.parentReference.driveId, item.id);
  } catch (e) {
    return anotarError(explicarError(e));
  }

  // 3. Cargarlo con el importador de su reporte
  let r;
  try {
    r = await importador.importar(contenido, {
      nombreArchivo: `${config.archivo} (SharePoint)`,
      usuarioId: opciones.usuarioId || null,
    });
  } catch (e) {
    return anotarError(`El importador de ${importador.reporte} rechazó el archivo: ${e.message}`, huella);
  }

  const resumen = resumir(r);
  const avisos = r.avisos || r.advertencias || [];
  await cerrar({
    exito: true,
    cambio: true,
    filas: r.insertadas,
    mensaje: avisos.length ? `${avisos.length} avisos del importador` : null,
  });
  await db.query(
    `UPDATE sp_archivos
        SET huella = $2, tamano_bytes = $3, modificado_en = $4, modificado_por = $5,
            leido_en = now(), filas = $6, resumen = $7,
            ultimo_error = NULL, error_en = NULL, huella_error = NULL, actualizado_en = now()
      WHERE clave = $1`,
    [clave, huella, item.size, modificado, quien, r.insertadas, resumen],
  );

  return {
    clave, ok: true, sinCambios: false,
    guardadas: r.insertadas,
    resumen,
    duracionMs: Date.now() - arranque,
  };
}

let corriendo = false;

/**
 * Sincroniza todos los activos, uno tras otro.
 *
 * El candado lo comparten la vuelta programada y el botón de la pantalla: dos
 * cargas de Inyección encimadas se pelearían por el mismo rango de fechas.
 */
async function sincronizar(opciones = {}) {
  if (corriendo) {
    const e = new Error("Ya hay una revisión de SharePoint en curso. Esperar a que termine.");
    e.statusCode = 409;
    throw e;
  }
  corriendo = true;
  try {
    const claves = opciones.clave
      ? [opciones.clave]
      : (await listarArchivos({ soloActivos: !opciones.forzar })).map((a) => a.clave);
    const resultados = [];
    for (const clave of claves) {
      resultados.push(await sincronizarArchivo(clave, opciones));
    }
    return resultados;
  } finally {
    corriendo = false;
  }
}

/** Estado de los archivos y de las últimas corridas, para la pantalla. */
async function estado() {
  const [archivos, corridas] = await Promise.all([
    listarArchivos(),
    db.query(
      `SELECT id, clave, archivo, exito, hubo_cambio, filas_cargadas, duracion_ms, mensaje,
              to_char(iniciada_en, 'YYYY-MM-DD HH24:MI:SS') AS iniciada_texto
         FROM sp_sincronizaciones ORDER BY iniciada_en DESC LIMIT 30`,
    ),
  ]);
  return {
    archivos,
    corridas: corridas.rows,
    cadaMinutos: CADA_MINUTOS,
    reposoMinutos: REPOSO_MINUTOS,
    configurado: graph.configurado(),
    enCurso: corriendo,
  };
}

/** Cambia la ubicación, el nombre o si se vigila. */
async function guardarConfiguracion(clave, { ubicacion, archivo, activo }) {
  if (ubicacion) interpretarUbicacion(ubicacion); // que falle aquí y no a las 3 a.m.

  const campos = [];
  const params = [clave];
  const add = (sql, valor) => {
    params.push(valor);
    campos.push(sql.replace("?", `$${params.length}`));
  };
  if (ubicacion !== undefined) add("ubicacion = ?", String(ubicacion).trim());
  if (archivo !== undefined) add("archivo = ?", String(archivo).trim());
  if (activo !== undefined) add("activo = ?", Boolean(activo));
  if (campos.length === 0) return null;

  // Otro archivo: la huella vieja ya no significa nada
  const limpia =
    ubicacion !== undefined || archivo !== undefined
      ? ", huella = NULL, huella_error = NULL, ultimo_error = NULL, error_en = NULL"
      : "";

  const { rows } = await db.query(
    `UPDATE sp_archivos SET ${campos.join(", ")}${limpia}, actualizado_en = now()
      WHERE clave = $1 RETURNING *`,
    params,
  );
  if (rows[0]) resueltas.delete(rows[0].ubicacion);
  return rows[0] || null;
}

// =============================================
// PROGRAMACIÓN
// =============================================

let tarea = null;

function iniciarProgramado() {
  if (tarea) return;

  if (!graph.configurado()) {
    console.log("☁️  SharePoint: sin credenciales en el .env, no se programa la revisión");
    return;
  }

  tarea = cron.schedule(`*/${CADA_MINUTOS} * * * *`, async () => {
    if (corriendo) {
      console.warn("⏭️  SharePoint: se omite la vuelta, la anterior sigue en curso");
      return;
    }
    try {
      const r = await sincronizar();
      for (const x of r.filter((x) => x.ok && !x.sinCambios)) {
        console.log(`🔄 SharePoint (${x.clave}): ${x.resumen}`);
      }
      for (const f of r.filter((x) => x.ok === false)) {
        console.warn(`⚠️  SharePoint (${f.clave}): ${f.mensaje}`);
      }
    } catch (e) {
      console.error("⚠️  SharePoint: falló la vuelta —", e.message);
    }
  });

  console.log(`🕒 SharePoint: se revisan los archivos cada ${CADA_MINUTOS} min`);
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
  interpretarUbicacion,
  IMPORTADORES,
};
