const RegistroDefecto = require("../models/RegistroDefecto");
const Turno = require("../models/Turno");
const AreaProduccion = require("../models/AreaProduccion");
const TipoDefecto = require("../models/TipoDefecto");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const {
  registrarLog,
  obtenerIP,
  obtenerUserAgent,
} = require("../utils/logger");

/**
 * Obtener catálogos necesarios para el formulario
 */
const getCatalogos = catchAsync(async (req, res, next) => {
  const [turnos, areasProduccion, tiposDefectos, turnoActual] =
    await Promise.all([
      Turno.findAll({ activo: true }),
      AreaProduccion.findAll({ activo: true }),
      TipoDefecto.findAll({ activo: true }),
      Turno.getCurrentShiftInfo(),
    ]);

  sendSuccess(res, 200, {
    turnos,
    areasProduccion,
    tiposDefectos,
    turnoActual,
  });
});

/**
 * Obtener turno actual
 */
const getTurnoActual = catchAsync(async (req, res, next) => {
  const turno = await Turno.getCurrentShiftInfo();

  if (!turno) {
    return next(new AppError("No se pudo determinar el turno actual", 500));
  }

  sendSuccess(res, 200, { turno });
});

/**
 * Crear un nuevo registro de defecto
 */
const createRegistro = catchAsync(async (req, res, next) => {
  let {
    turnoId,
    areaProduccionId,
    tipoDefectoId,
    paresRechazados,
    observaciones,
  } = req.body;

  // Si no se proporciona turnoId, obtener el turno actual automáticamente
  if (!turnoId) {
    turnoId = await Turno.getCurrentShift();
    if (!turnoId) {
      return next(new AppError("No se pudo determinar el turno actual", 500));
    }
  }

  // Validar que el turno existe
  const turno = await Turno.findById(turnoId);
  if (!turno) {
    return next(new AppError("El turno especificado no existe", 400));
  }

  // Validar que el área de producción existe
  const areaProduccion = await AreaProduccion.findById(areaProduccionId);
  if (!areaProduccion) {
    return next(
      new AppError("El área de producción especificada no existe", 400)
    );
  }

  // Validar que el tipo de defecto existe
  const tipoDefecto = await TipoDefecto.findById(tipoDefectoId);
  if (!tipoDefecto) {
    return next(new AppError("El tipo de defecto especificado no existe", 400));
  }

  // Crear el registro
  const nuevoRegistro = await RegistroDefecto.create({
    turnoId,
    areaProduccionId,
    tipoDefectoId,
    paresRechazados,
    observaciones,
    registradoPor: req.usuario.id,
  });

  // Registrar en logs
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "CREATE",
    modulo: "Calidad - Registro de Defectos",
    tablaAfectada: "registros_defectos",
    registroId: nuevoRegistro.id,
    descripcion: `Registro de defecto creado: ${tipoDefecto.nombre} - ${paresRechazados} pares`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosNuevos: {
      turno: turno.nombre,
      areaProduccion: areaProduccion.nombre,
      tipoDefecto: tipoDefecto.nombre,
      paresRechazados,
      observaciones,
    },
  });

  // Obtener el registro completo con información de las relaciones
  const registroCompleto = await RegistroDefecto.findById(nuevoRegistro.id);

  sendSuccess(
    res,
    201,
    { registro: registroCompleto },
    "Registro de defecto creado exitosamente"
  );
});

/**
 * Obtener todos los registros con filtros y paginación
 */
const getRegistros = catchAsync(async (req, res, next) => {
  const {
    fechaInicio,
    fechaFin,
    turnoId,
    areaProduccionId,
    tipoDefectoId,
    registradoPor,
    limit = 50,
    offset = 0,
    orderBy,
    orderDir,
  } = req.query;

  const filters = {
    fechaInicio,
    fechaFin,
    turnoId: turnoId ? parseInt(turnoId) : undefined,
    areaProduccionId: areaProduccionId ? parseInt(areaProduccionId) : undefined,
    tipoDefectoId: tipoDefectoId ? parseInt(tipoDefectoId) : undefined,
    registradoPor: registradoPor ? parseInt(registradoPor) : undefined,
    limit: parseInt(limit),
    offset: parseInt(offset),
    orderBy,
    orderDir,
  };

  const [registros, total] = await Promise.all([
    RegistroDefecto.findAll(filters),
    RegistroDefecto.count(filters),
  ]);

  sendSuccess(res, 200, {
    registros,
    pagination: {
      total,
      limit: filters.limit,
      offset: filters.offset,
      pages: Math.ceil(total / filters.limit),
    },
  });
});

/**
 * Obtener un registro por ID
 */
const getRegistroById = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const registro = await RegistroDefecto.findById(id);

  if (!registro) {
    return next(new AppError("Registro de defecto no encontrado", 404));
  }

  sendSuccess(res, 200, { registro });
});

/**
 * Actualizar un registro de defecto
 */
const updateRegistro = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const {
    turnoId,
    areaProduccionId,
    tipoDefectoId,
    paresRechazados,
    observaciones,
  } = req.body;

  // Verificar que el registro existe
  const registroExistente = await RegistroDefecto.findById(id);
  if (!registroExistente) {
    return next(new AppError("Registro de defecto no encontrado", 404));
  }

  // Guardar datos anteriores para el log
  const datosAnteriores = {
    turno: registroExistente.turno_nombre,
    areaProduccion: registroExistente.area_produccion_nombre,
    tipoDefecto: registroExistente.tipo_defecto_nombre,
    paresRechazados: registroExistente.pares_rechazados,
    observaciones: registroExistente.observaciones,
  };

  // Preparar datos para actualizar
  const datosActualizar = {};
  const datosNuevos = {};

  if (turnoId !== undefined) {
    const turno = await Turno.findById(turnoId);
    if (!turno) {
      return next(new AppError("El turno especificado no existe", 400));
    }
    datosActualizar.turnoId = turnoId;
    datosNuevos.turno = turno.nombre;
  }

  if (areaProduccionId !== undefined) {
    const areaProduccion = await AreaProduccion.findById(areaProduccionId);
    if (!areaProduccion) {
      return next(
        new AppError("El área de producción especificada no existe", 400)
      );
    }
    datosActualizar.areaProduccionId = areaProduccionId;
    datosNuevos.areaProduccion = areaProduccion.nombre;
  }

  if (tipoDefectoId !== undefined) {
    const tipoDefecto = await TipoDefecto.findById(tipoDefectoId);
    if (!tipoDefecto) {
      return next(
        new AppError("El tipo de defecto especificado no existe", 400)
      );
    }
    datosActualizar.tipoDefectoId = tipoDefectoId;
    datosNuevos.tipoDefecto = tipoDefecto.nombre;
  }

  if (paresRechazados !== undefined) {
    datosActualizar.paresRechazados = paresRechazados;
    datosNuevos.paresRechazados = paresRechazados;
  }

  if (observaciones !== undefined) {
    datosActualizar.observaciones = observaciones;
    datosNuevos.observaciones = observaciones;
  }

  // Actualizar el registro
  await RegistroDefecto.update(id, datosActualizar);

  // Registrar en logs
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "UPDATE",
    modulo: "Calidad - Registro de Defectos",
    tablaAfectada: "registros_defectos",
    registroId: parseInt(id),
    descripcion: `Registro de defecto actualizado: ID ${id}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosAnteriores,
    datosNuevos,
  });

  // Obtener el registro actualizado completo
  const registroActualizado = await RegistroDefecto.findById(id);

  sendSuccess(
    res,
    200,
    { registro: registroActualizado },
    "Registro actualizado exitosamente"
  );
});

/**
 * Eliminar un registro de defecto
 */
const deleteRegistro = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  // Verificar que el registro existe
  const registro = await RegistroDefecto.findById(id);
  if (!registro) {
    return next(new AppError("Registro de defecto no encontrado", 404));
  }

  // Eliminar el registro
  await RegistroDefecto.delete(id);

  // Registrar en logs
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "DELETE",
    modulo: "Calidad - Registro de Defectos",
    tablaAfectada: "registros_defectos",
    registroId: parseInt(id),
    descripcion: `Registro de defecto eliminado: ${registro.tipo_defecto_nombre} - ${registro.pares_rechazados} pares`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosAnteriores: {
      turno: registro.turno_nombre,
      areaProduccion: registro.area_produccion_nombre,
      tipoDefecto: registro.tipo_defecto_nombre,
      paresRechazados: registro.pares_rechazados,
      observaciones: registro.observaciones,
    },
  });

  sendSuccess(res, 200, null, "Registro eliminado exitosamente");
});

/**
 * Obtener resumen por turno
 */
const getResumenPorTurno = catchAsync(async (req, res, next) => {
  const { fechaInicio, fechaFin } = req.query;

  if (!fechaInicio || !fechaFin) {
    return next(new AppError("Se requieren fechaInicio y fechaFin", 400));
  }

  const resumen = await RegistroDefecto.getResumenPorTurno(
    fechaInicio,
    fechaFin
  );

  sendSuccess(res, 200, { resumen });
});

/**
 * Obtener top defectos más frecuentes
 */
const getTopDefectos = catchAsync(async (req, res, next) => {
  const { limit = 10, fechaInicio, fechaFin } = req.query;

  const topDefectos = await RegistroDefecto.getTopDefectos(
    parseInt(limit),
    fechaInicio,
    fechaFin
  );

  sendSuccess(res, 200, { topDefectos });
});

module.exports = {
  getCatalogos,
  getTurnoActual,
  createRegistro,
  getRegistros,
  getRegistroById,
  updateRegistro,
  deleteRegistro,
  getResumenPorTurno,
  getTopDefectos,
};
