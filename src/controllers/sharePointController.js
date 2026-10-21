const sincronizador = require("../services/sincronizarSharePoint.service");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const { registrarLog, obtenerIP, obtenerUserAgent } = require("../utils/logger");

/**
 * GET /api/sharepoint/archivos
 */
const getArchivos = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await sincronizador.estado());
});

/**
 * PUT /api/sharepoint/archivos/:clave
 *
 * Cambia la URL de la carpeta, el nombre del archivo o si se vigila.
 */
const putArchivo = catchAsync(async (req, res) => {
  const { ubicacion, archivo, activo } = req.body;
  if (ubicacion === undefined && archivo === undefined && activo === undefined) {
    throw new AppError("No se mandó ningún cambio", 400);
  }

  let actualizado;
  try {
    actualizado = await sincronizador.guardarConfiguracion(req.params.clave, {
      ubicacion,
      archivo,
      activo,
    });
  } catch (e) {
    // La URL no se pudo interpretar
    throw new AppError(e.message, 400);
  }
  if (!actualizado) throw new AppError("No existe ese archivo configurado", 404);

  await registrarLog({
    usuarioId: req.usuario?.id,
    accion: "ACTUALIZAR",
    modulo: "Archivos de SharePoint",
    tablaAfectada: "sp_archivos",
    descripcion:
      `Archivo de SharePoint "${req.params.clave}": ` +
      `${actualizado.ubicacion} / ${actualizado.archivo}` +
      (activo === undefined ? "" : activo ? " (activo)" : " (inactivo)"),
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });

  sendSuccess(res, 200, actualizado, "Archivo actualizado");
});

/**
 * POST /api/sharepoint/archivos/:clave/probar
 *
 * Revisa que el archivo se alcance SIN bajarlo. Es lo que se usa mientras TI
 * da de alta la aplicación y sus permisos.
 */
const probarArchivo = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await sincronizador.probar(req.params.clave));
});

/**
 * POST /api/sharepoint/archivos/sincronizar
 *
 * @body clave    opcional, para sincronizar solo uno
 * @body forzar   relee aunque no haya cambiado o se esté editando
 */
const sincronizar = catchAsync(async (req, res) => {
  const { clave, forzar } = req.body || {};
  const opciones = {
    clave: clave ? String(clave).toUpperCase() : undefined,
    forzar: Boolean(forzar),
    usuarioId: req.usuario?.id,
  };

  let resultado;
  try {
    resultado = await sincronizador.sincronizar(opciones);
  } catch (e) {
    throw new AppError(e.message, e.statusCode || 500);
  }

  const cambiaron = resultado.filter((r) => r.ok && !r.sinCambios);
  await registrarLog({
    usuarioId: req.usuario?.id,
    accion: "SYNC",
    modulo: "Archivos de SharePoint",
    tablaAfectada: "sp_archivos",
    descripcion:
      cambiaron.length === 0
        ? "SharePoint: sin cambios en los archivos"
        : "SharePoint: " + cambiaron.map((r) => `${r.clave} ${r.resumen}`).join("; "),
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });

  const fallaron = resultado.filter((r) => r.ok === false);
  sendSuccess(
    res,
    200,
    { resultado, estado: await sincronizador.estado() },
    fallaron.length
      ? `No se pudo leer: ${fallaron.map((r) => r.clave).join(", ")}`
      : cambiaron.length
        ? "Archivos actualizados"
        : "Los archivos no han cambiado desde la última lectura",
  );
});

module.exports = { getArchivos, putArchivo, probarArchivo, sincronizar };
