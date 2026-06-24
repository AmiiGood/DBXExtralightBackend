const Log = require("../models/Log");
const Usuario = require("../models/Usuario");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");

/**
 * Obtener catálogos para filtros de logs
 */
const getCatalogos = catchAsync(async (req, res, next) => {
  const [acciones, modulos, tablas, usuarios] = await Promise.all([
    Log.getAcciones(),
    Log.getModulos(),
    Log.getTablas(),
    Usuario.findAll({ activo: true }),
  ]);

  sendSuccess(res, 200, {
    acciones,
    modulos,
    tablas,
    usuarios: usuarios.map((u) => ({
      id: u.id,
      nombre_usuario: u.nombre_usuario,
      nombre_completo: u.nombre_completo,
    })),
  });
});

/**
 * Obtener todos los logs con filtros y paginación
 */
const getLogs = catchAsync(async (req, res, next) => {
  const {
    fechaInicio,
    fechaFin,
    usuarioId,
    accion,
    modulo,
    tablaAfectada,
    search,
    limit = 50,
    offset = 0,
    orderBy,
    orderDir,
  } = req.query;

  const filters = {
    fechaInicio,
    fechaFin,
    usuarioId: usuarioId ? parseInt(usuarioId) : undefined,
    accion,
    modulo,
    tablaAfectada,
    search,
    limit: parseInt(limit),
    offset: parseInt(offset),
    orderBy,
    orderDir,
  };

  const [logs, total] = await Promise.all([
    Log.findAll(filters),
    Log.count(filters),
  ]);

  sendSuccess(res, 200, {
    logs,
    pagination: {
      total,
      limit: filters.limit,
      offset: filters.offset,
      pages: Math.ceil(total / filters.limit),
    },
  });
});

/**
 * Obtener un log por ID
 */
const getLogById = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const log = await Log.findById(id);

  if (!log) {
    return next(new AppError("Registro de log no encontrado", 404));
  }

  sendSuccess(res, 200, { log });
});

/**
 * Obtener estadísticas de logs
 */
const getEstadisticas = catchAsync(async (req, res, next) => {
  const { fechaInicio, fechaFin } = req.query;

  if (!fechaInicio || !fechaFin) {
    return next(new AppError("Se requieren fechaInicio y fechaFin", 400));
  }

  const [estadisticas, actividadUsuarios] = await Promise.all([
    Log.getEstadisticas(fechaInicio, fechaFin),
    Log.getActividadPorUsuario(fechaInicio, fechaFin, 10),
  ]);

  sendSuccess(res, 200, {
    estadisticas,
    actividadUsuarios,
  });
});

module.exports = {
  getCatalogos,
  getLogs,
  getLogById,
  getEstadisticas,
};
