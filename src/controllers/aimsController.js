const Reporte = require("../models/AimsReporte");
const sincronizador = require("../services/sincronizarAims.service");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const { registrarLog, obtenerIP, obtenerUserAgent } = require("../utils/logger");

/** La frescura del dato viaja con el dato, igual que en CAPEX. */
async function estadoArchivo() {
  const c = await sincronizador.leerConfig();
  if (!c) return null;
  return {
    archivo: c.archivo,
    revision: c.revision,
    carpeta: c.carpeta,
    activo: c.activo,
    leido: c.leido_texto,
    modificado: c.modificado_texto,
    error: c.ultimo_error,
    errorEn: c.error_texto,
    avisos: c.avisos,
  };
}

/**
 * GET /api/aims/reportes
 *
 * @query anio  opcional; por omisión el más reciente con datos
 */
const getReporte = catchAsync(async (req, res) => {
  const anios = await Reporte.anios();
  const anio = req.query.anio ? parseInt(req.query.anio, 10) : anios[0];
  const [indicadores, archivo] = await Promise.all([
    anio ? Reporte.indicadores(anio) : [],
    estadoArchivo(),
  ]);
  sendSuccess(res, 200, { anio: anio || null, anios, indicadores, archivo });
});

/**
 * GET /api/aims/archivo
 */
const getArchivo = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await sincronizador.estado());
});

/**
 * PUT /api/aims/archivo
 *
 * Carpeta, principio del nombre o si se vigila.
 */
const putArchivo = catchAsync(async (req, res) => {
  const { carpeta, patron, activo } = req.body || {};
  let actualizado;
  try {
    actualizado = await sincronizador.guardarConfiguracion({ carpeta, patron, activo });
  } catch (e) {
    throw new AppError(e.message, 400);
  }
  if (!actualizado) throw new AppError("No se mandó ningún cambio", 400);

  await registrarLog({
    usuarioId: req.usuario?.id,
    accion: "ACTUALIZAR",
    modulo: "Archivo de AIMS",
    tablaAfectada: "aims_archivo",
    descripcion:
      `AIMS: ${actualizado.carpeta || "(sin carpeta)"}\\${actualizado.patron}*` +
      (actualizado.activo ? "" : " (apagado)"),
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });

  sendSuccess(res, 200, actualizado, "Configuración guardada");
});

/**
 * POST /api/aims/archivo/probar
 */
const probarArchivo = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await sincronizador.probar());
});

/**
 * POST /api/aims/archivo/sincronizar
 *
 * @body forzar  relee aunque el libro no haya cambiado
 */
const sincronizar = catchAsync(async (req, res) => {
  const r = await sincronizador.sincronizar({
    forzar: Boolean(req.body?.forzar),
    usuarioId: req.usuario?.id,
  });

  await registrarLog({
    usuarioId: req.usuario?.id,
    accion: "SYNC",
    modulo: "Archivo de AIMS",
    tablaAfectada: "aims_valores",
    descripcion: !r.ok
      ? `AIMS: no se pudo leer — ${r.mensaje}`
      : r.omitido
        ? `AIMS: ${r.motivo}`
        : r.sinCambios
          ? "AIMS: el libro no ha cambiado"
          : `AIMS: ${r.archivo}, ${r.kpis} indicadores, ${r.meses} meses`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });

  sendSuccess(
    res,
    200,
    { resultado: r, estado: await sincronizador.estado() },
    !r.ok
      ? `No se pudo leer: ${r.mensaje}`
      : r.omitido
        ? r.motivo
        : r.sinCambios
          ? "El libro no ha cambiado desde la última lectura"
          : "Libro actualizado",
  );
});

module.exports = { getReporte, getArchivo, putArchivo, probarArchivo, sincronizar };
