const MoldesReporte = require("../models/MoldesReporte");
const sincronizador = require("../services/sincronizarMoldes.service");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const { registrarLog, obtenerIP, obtenerUserAgent } = require("../utils/logger");

/**
 * Convierte los query params a los filtros que espera el modelo.
 */
function leerFiltros(req) {
  const { fechaInicio, fechaFin, anio, mes, semana, trimestre, semestre, tema } =
    req.query;
  const entero = (v) => (v ? parseInt(v, 10) : undefined);

  return {
    fechaInicio: fechaInicio || undefined,
    fechaFin: fechaFin || undefined,
    anio: entero(anio),
    mes: entero(mes),
    semana: entero(semana),
    trimestre: entero(trimestre),
    semestre: entero(semestre),
    temas: tema
      ? String(tema)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
  };
}

/**
 * GET /api/moldes/reportes/filtros
 * Temas, años y meses disponibles para los selectores.
 */
const getFiltros = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await MoldesReporte.getFiltros());
});

/**
 * GET /api/moldes/reportes/dashboard
 *
 * @query tema         lista de temas separada por comas
 * @query anio, mes, semana, trimestre, semestre
 * @query fechaInicio, fechaFin   AAAA-MM-DD
 * @query agrupar      anio | mes | semana | fecha  (default: mes)
 */
const getDashboard = catchAsync(async (req, res) => {
  const datos = await MoldesReporte.getDashboard(
    leerFiltros(req),
    req.query.agrupar || "mes",
  );
  // La frescura del dato va junto con el dato: el reporte lee una réplica, y el
  // usuario tiene que poder ver de cuándo es sin ir a buscarlo a otro lado.
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
 * GET /api/moldes/reportes/comparar
 *
 * @query tipo          mes | trimestre | semestre | anio
 * @query aAnio, aNum   periodo A
 * @query bAnio, bNum   periodo B
 * @query tema          lista separada por comas (opcional)
 */
const getComparativo = catchAsync(async (req, res) => {
  const { tipo, aAnio, aNum, bAnio, bNum, tema } = req.query;

  if (!aAnio || !bAnio) {
    throw new AppError("Faltan los años de los periodos a comparar", 400);
  }

  const datos = await MoldesReporte.getComparativo(
    tipo || "mes",
    { anio: parseInt(aAnio, 10), numero: parseInt(aNum, 10) || 1 },
    { anio: parseInt(bAnio, 10), numero: parseInt(bNum, 10) || 1 },
    tema
      ? String(tema)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
  );
  sendSuccess(res, 200, datos);
});

/**
 * GET /api/moldes/sincronizacion
 * Qué tan fresca está la réplica.
 */
const getEstadoSincronizacion = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await sincronizador.estado());
});

/**
 * POST /api/moldes/sincronizacion
 * Fuerza una sincronización a mano, sin esperar a la programada.
 *
 * @body completa  true para volver a traer todo el histórico
 */
const sincronizar = catchAsync(async (req, res) => {
  const completa = req.body?.completa === true;
  const resultado = await sincronizador.sincronizar({ completa });

  await registrarLog({
    usuarioId: req.usuario?.id,
    accion: "SINCRONIZAR",
    modulo: "Reportes de Moldes",
    tablaAfectada: "moldes_tickets",
    registroId: resultado.id,
    descripcion:
      `Sincronización ${completa ? "completa" : "incremental"} de tickets: ` +
      `${resultado.nuevas} nuevos, ${resultado.modificadas} actualizados`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });

  sendSuccess(res, 200, resultado);
});

module.exports = {
  getFiltros,
  getDashboard,
  getComparativo,
  getEstadoSincronizacion,
  sincronizar,
};
