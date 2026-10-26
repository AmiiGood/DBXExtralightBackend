const fs = require("fs");
const Reporte = require("../models/ChecadasReporte");
const {
  analizarArchivo,
  importarArchivo,
  historialCargas,
} = require("../services/importarChecadas.service");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const { registrarLog, obtenerIP, obtenerUserAgent } = require("../utils/logger");

/** Lista separada por comas → arreglo, o undefined si no vino. */
function lista(v) {
  if (!v) return undefined;
  const a = String(v).split(",").map((s) => s.trim()).filter(Boolean);
  return a.length ? a : undefined;
}

const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const esHora = (s) => /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(s || ""));

// =============================================
// REPORTE
// =============================================

/**
 * GET /api/checadas/reportes/filtros
 */
const getFiltros = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await Reporte.filtros());
});

/**
 * GET /api/checadas/reportes
 *
 * @query desde, hasta   fechas del TURNO (AAAA-MM-DD); obligatorias
 * @query turno          C,A,B
 * @query departamento   lista separada por comas
 * @query estado         A_TIEMPO,TOLERANCIA,RETARDO (cómo llegó)
 * @query salida         ANTES (salió antes del fin del turno) | SIN (sin salida)
 * @query horaDesde, horaHasta  HH:MM, sobre la hora de entrada; si desde > hasta
 *                       cruza la medianoche (23:30 a 00:20)
 * @query q              nómina exacta (solo dígitos) o nombre, sin importar acentos
 */
const getReporte = catchAsync(async (req, res) => {
  const { desde, hasta } = req.query;
  if (!esFecha(desde) || !esFecha(hasta)) throw new AppError("Falta el rango de fechas", 400);
  if (desde > hasta) throw new AppError("La fecha inicial es mayor que la final", 400);
  const horaDesde = esHora(req.query.horaDesde) ? req.query.horaDesde.slice(0, 5) : undefined;
  const horaHasta = esHora(req.query.horaHasta) ? req.query.horaHasta.slice(0, 5) : undefined;

  sendSuccess(
    res,
    200,
    await Reporte.reporte({
      desde,
      hasta,
      horaDesde,
      horaHasta,
      turnos: lista(req.query.turno),
      departamentos: lista(req.query.departamento),
      estados: lista(req.query.estado),
      salida: ["ANTES", "SIN"].includes(req.query.salida) ? req.query.salida : undefined,
      q: req.query.q,
    }),
  );
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
 * POST /api/checadas/carga/analizar
 * Lo que trae el archivo, sin escribir nada.
 */
const analizarCarga = catchAsync(async (req, res) => {
  if (!req.file) throw new AppError("No se recibió ningún archivo", 400);
  try {
    sendSuccess(res, 200, { ...(await analizarArchivo(req.file.path)), archivo: nombreOriginal(req.file) });
  } catch (e) {
    throw e instanceof AppError ? e : new AppError(e.message, e.statusCode || 400);
  } finally {
    limpiarTemporal(req.file);
  }
});

/**
 * POST /api/checadas/carga/importar
 * Carga las checadas nuevas; las que ya estaban se ignoran.
 */
const importarCarga = catchAsync(async (req, res) => {
  if (!req.file) throw new AppError("No se recibió ningún archivo", 400);
  try {
    const nombre = nombreOriginal(req.file);
    const r = await importarArchivo(req.file.path, { usuarioId: req.usuario?.id, nombreArchivo: nombre });

    await registrarLog({
      usuarioId: req.usuario?.id,
      accion: "IMPORT",
      modulo: "Carga de Checadas",
      tablaAfectada: "chk_transacciones",
      descripcion:
        `Carga de "${nombre}": ${r.nuevas} checadas nuevas, ${r.yaCargadas} ya estaban ` +
        `(${r.periodoDesde} a ${r.periodoHasta}). Carga ${r.cargaId}`,
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
 * GET /api/checadas/carga/historial
 */
const getHistorialCargas = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await historialCargas());
});

module.exports = { getFiltros, getReporte, analizarCarga, importarCarga, getHistorialCargas };
