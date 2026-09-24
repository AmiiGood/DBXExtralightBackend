const ResultadosReporte = require("../models/ResultadosReporte");
const {
  analizarArchivo,
  importarArchivo,
  historialCargas,
} = require("../services/importarResultados.service");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const { registrarLog, obtenerIP, obtenerUserAgent } = require("../utils/logger");
const fs = require("fs");

/** Año pedido, validado para dar un 400 y no un resultado vacío sin explicación. */
function leerAnio(req) {
  const anio = parseInt(req.query.anio, 10);
  if (!anio || anio < 2000 || anio > 2100) {
    throw new AppError("Falta el año o está fuera de rango (2000-2100)", 400);
  }
  return anio;
}

// =============================================
// REPORTES
// =============================================

/**
 * GET /api/resultados/reportes/filtros
 */
const getFiltros = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await ResultadosReporte.getFiltros());
});

/**
 * GET /api/resultados/reportes/dashboard?anio=AAAA
 * Todo el tablero de un año en una llamada: son siete bloques que siempre se
 * ven juntos y partirlos solo multiplicaría los viajes.
 */
const getDashboard = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await ResultadosReporte.getDashboard(leerAnio(req)));
});

/**
 * GET /api/resultados/reportes/mensual?serie=qty|usd|precio|scrap
 * Los doce meses con una columna por año: la gráfica principal del libro.
 */
const getComparativoMensual = catchAsync(async (req, res) => {
  const serie = String(req.query.serie || "qty");
  if (!["qty", "usd", "precio", "scrap"].includes(serie)) {
    throw new AppError(`Serie desconocida: "${serie}". Se espera qty, usd, precio o scrap.`, 400);
  }
  sendSuccess(res, 200, await ResultadosReporte.getComparativoMensual(serie));
});

/**
 * GET /api/resultados/reportes/historico
 * Un renglón por año, para las gráficas que comparan la historia completa.
 */
const getHistorico = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await ResultadosReporte.getHistorico());
});

// =============================================
// CARGA DEL EXCEL
// =============================================

/** Borra el temporal de multer pase lo que pase. */
function limpiarTemporal(file) {
  if (file?.path) fs.unlink(file.path, () => {});
}

/**
 * multer decodifica el nombre como latin1.
 *
 * Aquí importa de más: del nombre del archivo salen el año y el mes de corte,
 * que es lo único que fecha la foto de carga de PO y el bloque del estado de
 * resultados que viene sin año escrito en la hoja.
 */
const nombreOriginal = (file) =>
  file ? Buffer.from(file.originalname, "latin1").toString("utf8") : null;

/**
 * POST /api/resultados/carga/analizar
 */
const analizarCarga = catchAsync(async (req, res) => {
  if (!req.file) throw new AppError("No se recibió ningún archivo", 400);
  try {
    const nombre = nombreOriginal(req.file);
    const resumen = await analizarArchivo(req.file.path, nombre);
    sendSuccess(res, 200, { ...resumen, archivo: nombre });
  } finally {
    limpiarTemporal(req.file);
  }
});

/**
 * POST /api/resultados/carga/importar
 */
const importarCarga = catchAsync(async (req, res) => {
  if (!req.file) throw new AppError("No se recibió ningún archivo", 400);
  try {
    const nombre = nombreOriginal(req.file);
    const resultado = await importarArchivo(req.file.path, {
      usuarioId: req.usuario?.id,
      nombreArchivo: nombre,
    });

    await registrarLog({
      usuarioId: req.usuario?.id,
      accion: "IMPORT",
      modulo: "Reportes de Resultados",
      tablaAfectada: "res_valores",
      // El id de carga es un uuid y logs_sistema.registro_id es integer:
      // pasarlo ahí hacía fallar el INSERT del log y la importación se quedaba
      // sin registrar. Va en la descripción, que es texto.
      descripcion:
        `Carga de "${nombre}": ${resultado.valores} valores ` +
        `de ${resultado.anioMin} a ${resultado.anioMax}. Carga ${resultado.cargaId}`,
      ipAddress: obtenerIP(req),
      userAgent: obtenerUserAgent(req),
    });

    sendSuccess(res, 200, { ...resultado, archivo: nombre });
  } finally {
    limpiarTemporal(req.file);
  }
});

/**
 * GET /api/resultados/carga/historial
 */
const getHistorialCargas = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await historialCargas());
});

module.exports = {
  getFiltros,
  getDashboard,
  getComparativoMensual,
  getHistorico,
  analizarCarga,
  importarCarga,
  getHistorialCargas,
};
