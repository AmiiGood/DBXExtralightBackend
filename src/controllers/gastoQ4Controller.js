const fs = require("fs");
const Reporte = require("../models/GastoQ4Reporte");
const { analizarArchivo, importarArchivo, historialCargas } = require("../services/importarGastoQ4.service");
const tipoCambio = require("../services/tipoCambio.service");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const { registrarLog, obtenerIP, obtenerUserAgent } = require("../utils/logger");

// =============================================
// REPORTE
// =============================================

/**
 * GET /api/gasto-q4/reportes
 *
 * Todos los conceptos de la carga vigente, con su tipo de gasto, y el último
 * tipo de cambio FIX para la vista en dólares.
 */
const getReporte = catchAsync(async (req, res) => {
  const [datos, tc] = await Promise.all([Reporte.reporte(), tipoCambio.resumen()]);
  sendSuccess(res, 200, { ...datos, tipoCambio: tc });
});

/**
 * POST /api/gasto-q4/tipo-cambio/actualizar
 * Baja el FIX de Banxico en ese momento, sin esperar a la siguiente vuelta.
 */
const actualizarTipoCambio = catchAsync(async (req, res) => {
  try {
    await tipoCambio.actualizar();
  } catch (e) {
    throw new AppError(e.message, 502);
  }
  sendSuccess(res, 200, await tipoCambio.resumen());
});

// =============================================
// CARGA
// =============================================

/** Borra el temporal de multer pase lo que pase. */
function limpiarTemporal(file) {
  if (file?.path) fs.unlink(file.path, () => {});
}

/** multer decodifica el nombre como latin1; sin esto los acentos llegan rotos. */
const nombreOriginal = (file) =>
  file ? Buffer.from(file.originalname, "latin1").toString("utf8") : null;

/**
 * POST /api/gasto-q4/carga/analizar
 * Lo que trae el archivo y lo que reemplazaría, sin escribir nada.
 */
const analizarCarga = catchAsync(async (req, res) => {
  if (!req.file) throw new AppError("No se recibió ningún archivo", 400);
  try {
    const nombre = nombreOriginal(req.file);
    sendSuccess(res, 200, { ...(await analizarArchivo(req.file.path, { nombreArchivo: nombre })), archivo: nombre });
  } catch (e) {
    throw e instanceof AppError ? e : new AppError(e.message, e.statusCode || 400);
  } finally {
    limpiarTemporal(req.file);
  }
});

/**
 * POST /api/gasto-q4/carga/importar
 * Carga el archivo y reemplaza la carga anterior.
 */
const importarCarga = catchAsync(async (req, res) => {
  if (!req.file) throw new AppError("No se recibió ningún archivo", 400);
  try {
    const nombre = nombreOriginal(req.file);
    const r = await importarArchivo(req.file.path, { usuarioId: req.usuario?.id, nombreArchivo: nombre });

    await registrarLog({
      usuarioId: req.usuario?.id,
      accion: "IMPORT",
      modulo: "Carga de Gasto Q4",
      tablaAfectada: "gq4_conceptos",
      descripcion:
        `Carga de "${nombre}" (hoja ${r.hoja}): ${r.conceptos} conceptos de ${r.areas} áreas, ` +
        `$${r.total.toLocaleString("es-MX")}. Reemplazó ${r.reemplazados} conceptos. Carga ${r.cargaId}`,
      ipAddress: obtenerIP(req),
      userAgent: obtenerUserAgent(req),
    });

    sendSuccess(res, 200, { ...r, archivo: nombre });
  } catch (e) {
    throw e instanceof AppError ? e : new AppError(e.message, e.statusCode || 400);
  } finally {
    limpiarTemporal(req.file);
  }
});

/**
 * GET /api/gasto-q4/carga/historial
 */
const getHistorialCargas = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await historialCargas());
});

module.exports = { getReporte, actualizarTipoCambio, analizarCarga, importarCarga, getHistorialCargas };
