const CompoundReporte = require("../models/CompoundReporte");
const {
  analizarArchivo,
  importarArchivo,
  historialCargas,
} = require("../services/importarCompound.service");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const { registrarLog, obtenerIP, obtenerUserAgent } = require("../utils/logger");
const fs = require("fs");

/** Convierte los query params a los filtros que espera el modelo. */
function leerFiltros(req) {
  const { fechaInicio, fechaFin, anio, mes, trimestre, semestre,
          linea, turno, supervisor, bu } = req.query;
  const entero = (v) => (v ? parseInt(v, 10) : undefined);
  const lista = (v) =>
    v ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : undefined;

  return {
    fechaInicio: fechaInicio || undefined,
    fechaFin: fechaFin || undefined,
    anio: entero(anio),
    mes: entero(mes),
    trimestre: entero(trimestre),
    semestre: entero(semestre),
    lineas: lista(linea),
    turnos: lista(turno),
    supervisores: lista(supervisor),
    bus: lista(bu),
  };
}

/**
 * GET /api/compound/reportes/filtros
 */
const getFiltros = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await CompoundReporte.getFiltros());
});

/**
 * GET /api/compound/reportes/dashboard
 *
 * @query linea, turno, supervisor   listas separadas por comas
 * @query anio, mes, trimestre, semestre
 * @query fechaInicio, fechaFin      AAAA-MM-DD
 * @query agrupar                    anio | mes | semana | fecha  (default: mes)
 */
const getDashboard = catchAsync(async (req, res) => {
  const datos = await CompoundReporte.getDashboard(
    leerFiltros(req),
    req.query.agrupar || "mes",
  );
  sendSuccess(res, 200, datos);
});

/**
 * GET /api/compound/reportes/recuperacion
 * Recuperación de polvo por BU. Es otro archivo y otra granularidad, por eso
 * va en su propio endpoint y no dentro del dashboard.
 */
const getRecuperacion = catchAsync(async (req, res) => {
  const datos = await CompoundReporte.getRecuperacion(
    leerFiltros(req),
    req.query.agrupar || "anio",
  );
  sendSuccess(res, 200, datos);
});

/**
 * GET /api/compound/reportes/comparar
 */
const getComparativo = catchAsync(async (req, res) => {
  const { tipo, aAnio, aNum, bAnio, bNum } = req.query;
  if (!aAnio || !bAnio) {
    throw new AppError("Faltan los años de los periodos a comparar", 400);
  }
  const datos = await CompoundReporte.getComparativo(
    tipo || "mes",
    { anio: parseInt(aAnio, 10), numero: parseInt(aNum, 10) || 1 },
    { anio: parseInt(bAnio, 10), numero: parseInt(bNum, 10) || 1 },
    leerFiltros(req),
  );
  sendSuccess(res, 200, datos);
});

// =============================================
// CARGA DE LOS EXCEL
// =============================================

/** Borra el temporal de multer pase lo que pase. */
function limpiarTemporal(file) {
  if (file?.path) fs.unlink(file.path, () => {});
}

/**
 * multer decodifica el nombre como latin1; sin esto un archivo con acentos
 * llega como "Producciรณn Diaria.xlsx".
 */
const nombreOriginal = (file) =>
  file ? Buffer.from(file.originalname, "latin1").toString("utf8") : null;

/** El destino sale de la hoja que trae el archivo, no de lo que diga el usuario. */
function deducirDestino(ruta) {
  const XLSX = require("xlsx");
  const libro = XLSX.read(fs.readFileSync(ruta), { type: "buffer", bookSheets: true });
  if (libro.SheetNames.includes("Powder recovery")) return "RECUPERACION";
  if (libro.SheetNames.includes("Producción compuestos")) return "PRODUCCION";
  throw new AppError(
    `No reconozco el archivo. Sus hojas son: ${libro.SheetNames.join(", ")}. ` +
      'Se espera "Producción compuestos" o "Powder recovery".',
    400,
  );
}

/**
 * POST /api/compound/carga/analizar
 * Describe lo que trae el archivo sin escribir nada.
 */
const analizarCarga = catchAsync(async (req, res) => {
  if (!req.file) throw new AppError("No se recibió ningún archivo", 400);
  try {
    const destino = deducirDestino(req.file.path);
    const resumen = await analizarArchivo(req.file.path, destino);
    sendSuccess(res, 200, { ...resumen, archivo: nombreOriginal(req.file) });
  } finally {
    limpiarTemporal(req.file);
  }
});

/**
 * POST /api/compound/carga/importar
 * Carga el archivo reemplazando su rango de fechas.
 */
const importarCarga = catchAsync(async (req, res) => {
  if (!req.file) throw new AppError("No se recibió ningún archivo", 400);
  try {
    const destino = deducirDestino(req.file.path);
    const nombre = nombreOriginal(req.file);
    const resultado = await importarArchivo(req.file.path, destino, {
      usuarioId: req.usuario?.id,
      nombreArchivo: nombre,
    });

    await registrarLog({
      usuarioId: req.usuario?.id,
      accion: "IMPORT",
      modulo: "Reportes de Compuestos",
      tablaAfectada: destino === "RECUPERACION" ? "comp_recuperacion" : "comp_produccion",
      registroId: resultado.cargaId,
      descripcion:
        `Carga de "${nombre}": ${resultado.insertadas} renglones ` +
        `(${resultado.fechaMin} a ${resultado.fechaMax}), ` +
        `${resultado.borradas} reemplazados`,
      ipAddress: obtenerIP(req),
      userAgent: obtenerUserAgent(req),
    });

    sendSuccess(res, 200, { ...resultado, archivo: nombre });
  } finally {
    limpiarTemporal(req.file);
  }
});

/**
 * GET /api/compound/carga/historial
 */
const getHistorialCargas = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await historialCargas());
});

module.exports = {
  getFiltros,
  getDashboard,
  getRecuperacion,
  getComparativo,
  analizarCarga,
  importarCarga,
  getHistorialCargas,
};
