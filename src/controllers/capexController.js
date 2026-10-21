const Reporte = require("../models/CapexReporte");
const sincronizador = require("../services/sincronizarCapex.service");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const { registrarLog, obtenerIP, obtenerUserAgent } = require("../utils/logger");

/** La frescura del dato viaja con el dato, igual que en Customer Service. */
async function estadoArchivo() {
  const c = await sincronizador.leerConfig();
  if (!c) return null;
  return {
    archivo: c.archivo,
    revision: c.revision,
    bloque: c.bloque,
    hoja: c.hoja,
    filas: c.filas,
    leido: c.leido_texto,
    modificado: c.modificado_texto,
    error: c.ultimo_error,
    errorEn: c.error_texto,
  };
}

/**
 * GET /api/capex/reportes
 */
const getReporte = catchAsync(async (req, res) => {
  const [resumen, proyectos, trimestres, avance, iniziative, archivo] = await Promise.all([
    Reporte.resumen(),
    Reporte.aprobados(),
    Reporte.trimestres(),
    Reporte.avance(),
    Reporte.iniziative(),
    estadoArchivo(),
  ]);
  sendSuccess(res, 200, { resumen, proyectos, trimestres, avance, iniziative, archivo });
});

/**
 * GET /api/capex/archivo
 */
const getArchivo = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await sincronizador.estado());
});

/**
 * PUT /api/capex/archivo
 *
 * Carpeta, principio del nombre, hoja, bloque o si se vigila. Es lo que se
 * cambia cuando arranca otro año de CAPEX.
 */
const putArchivo = catchAsync(async (req, res) => {
  const { carpeta, patron, hoja, bloque, hoja_iniziative, activo } = req.body || {};
  let actualizado;
  try {
    actualizado = await sincronizador.guardarConfiguracion({
      carpeta, patron, hoja, bloque, hoja_iniziative, activo,
    });
  } catch (e) {
    throw new AppError(e.message, 400);
  }
  if (!actualizado) throw new AppError("No se mandó ningún cambio", 400);

  await registrarLog({
    usuarioId: req.usuario?.id,
    accion: "ACTUALIZAR",
    modulo: "Archivo de CAPEX",
    tablaAfectada: "capex_archivo",
    descripcion:
      `CAPEX: ${actualizado.carpeta}\\${actualizado.patron}* · hoja "${actualizado.hoja}" · ` +
      `bloque "${actualizado.bloque}"` + (actualizado.activo ? "" : " (apagado)"),
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });

  sendSuccess(res, 200, actualizado, "Configuración guardada");
});

/**
 * POST /api/capex/archivo/probar
 *
 * Qué libro elegiría y qué trae el bloque, SIN cargar nada.
 */
const probarArchivo = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await sincronizador.probar());
});

/**
 * POST /api/capex/archivo/sincronizar
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
    modulo: "Archivo de CAPEX",
    tablaAfectada: "capex_proyectos",
    descripcion: !r.ok
      ? `CAPEX: no se pudo leer — ${r.mensaje}`
      : r.sinCambios
        ? "CAPEX: el libro no ha cambiado"
        : `CAPEX: ${r.archivo}, ${r.guardadas} renglones, ${r.aprobados} con firmas FOAM`,
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
