const TiReporte = require("../models/TiReporte");
const sincronizador = require("../services/sincronizarTi.service");
const { catchAsync, sendSuccess } = require("../utils/errorHandler");
const { registrarLog, obtenerIP, obtenerUserAgent } = require("../utils/logger");

/** Convierte los query params a los filtros que espera el modelo. */
function leerFiltros(req) {
  const { fechaInicio, fechaFin, anio, tema } = req.query;
  return {
    fechaInicio: fechaInicio || undefined,
    fechaFin: fechaFin || undefined,
    anio: anio ? parseInt(anio, 10) : undefined,
    temas: tema
      ? String(tema)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
  };
}

/**
 * GET /api/ti/reportes/filtros
 */
const getFiltros = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await TiReporte.getFiltros());
});

/**
 * GET /api/ti/reportes/dashboard
 *
 * @query tema                     lista de temas separada por comas
 * @query anio
 * @query fechaInicio, fechaFin    AAAA-MM-DD
 * @query agrupar                  anio | trimestre | mes  (default: mes)
 */
const getDashboard = catchAsync(async (req, res) => {
  const datos = await TiReporte.getDashboard(
    leerFiltros(req),
    req.query.agrupar || "mes",
  );

  // La frescura del dato viaja junto con el dato: el reporte lee una réplica y
  // el usuario tiene que poder ver de cuándo es sin buscarlo en otro lado.
  const sinc = await sincronizador.ultimaSincronizacion();
  sendSuccess(res, 200, {
    ...datos,
    // Las versiones en texto, no las columnas crudas: son `timestamp` sin zona
    // y el driver las convertiría a UTC al serializarlas.
    sincronizacion: sinc
      ? { fecha: sinc.iniciada_texto, corte: sinc.corte_texto }
      : null,
  });
});

/**
 * GET /api/ti/sincronizacion
 * Estado de la réplica, para la pantalla.
 */
const getEstadoSincronizacion = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await sincronizador.estado());
});

/**
 * POST /api/ti/sincronizacion
 * Fuerza una sincronización a mano; el servidor ya la corre cada 15 minutos.
 *
 * @body completa  true para volver a traer todo el histórico
 */
const sincronizar = catchAsync(async (req, res) => {
  const completa = req.body?.completa === true;
  const resultado = await sincronizador.sincronizar({ completa });

  await registrarLog({
    usuarioId: req.usuario?.id,
    accion: "SYNC",
    modulo: "Reportes de TI",
    tablaAfectada: "ti_tickets",
    descripcion:
      `Sincronización ${completa ? "completa" : "incremental"} con osTicket: ` +
      `${resultado.nuevas} nuevos, ${resultado.modificadas} actualizados ` +
      `(${resultado.duracionMs} ms)`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });

  sendSuccess(res, 200, resultado);
});

module.exports = {
  getFiltros,
  getDashboard,
  getEstadoSincronizacion,
  sincronizar,
};
