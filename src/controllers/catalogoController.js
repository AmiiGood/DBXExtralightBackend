const Turno = require("../models/Turno");
const AreaProduccion = require("../models/AreaProduccion");
const TipoDefecto = require("../models/TipoDefecto");
const Rol = require("../models/Rol");
const Area = require("../models/Area");
const db = require("../config/database");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const {
  registrarLog,
  obtenerIP,
  obtenerUserAgent,
} = require("../utils/logger");

// =====================
// TURNOS
// =====================

const getTurnos = catchAsync(async (req, res, next) => {
  const { activo } = req.query;
  const filters = {};
  if (activo !== undefined) filters.activo = activo === "true";

  const turnos = await Turno.findAll(filters);
  sendSuccess(res, 200, { turnos });
});

const getTurnoById = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const turno = await Turno.findById(id);

  if (!turno) {
    return next(new AppError("Turno no encontrado", 404));
  }

  sendSuccess(res, 200, { turno });
});

const createTurno = catchAsync(async (req, res, next) => {
  const { nombre, horaInicio, horaFin, descripcion } = req.body;

  const query = `
    INSERT INTO turnos (nombre, hora_inicio, hora_fin, descripcion)
    VALUES ($1, $2, $3, $4)
    RETURNING id, nombre, hora_inicio, hora_fin, descripcion, activo
  `;

  const result = await db.query(query, [
    nombre,
    horaInicio,
    horaFin,
    descripcion || null,
  ]);
  const turno = result.rows[0];

  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "CREATE",
    modulo: "Catálogos - Turnos",
    tablaAfectada: "turnos",
    registroId: turno.id,
    descripcion: `Turno creado: ${nombre}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosNuevos: { nombre, horaInicio, horaFin, descripcion },
  });

  sendSuccess(res, 201, { turno }, "Turno creado exitosamente");
});

const updateTurno = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { nombre, horaInicio, horaFin, descripcion, activo } = req.body;

  const turnoExistente = await Turno.findById(id);
  if (!turnoExistente) {
    return next(new AppError("Turno no encontrado", 404));
  }

  const datosAnteriores = { ...turnoExistente };

  const fields = [];
  const values = [];
  let paramCount = 1;

  if (nombre !== undefined) {
    fields.push(`nombre = $${paramCount}`);
    values.push(nombre);
    paramCount++;
  }
  if (horaInicio !== undefined) {
    fields.push(`hora_inicio = $${paramCount}`);
    values.push(horaInicio);
    paramCount++;
  }
  if (horaFin !== undefined) {
    fields.push(`hora_fin = $${paramCount}`);
    values.push(horaFin);
    paramCount++;
  }
  if (descripcion !== undefined) {
    fields.push(`descripcion = $${paramCount}`);
    values.push(descripcion);
    paramCount++;
  }
  if (activo !== undefined) {
    fields.push(`activo = $${paramCount}`);
    values.push(activo);
    paramCount++;
  }

  if (fields.length === 0) {
    return next(new AppError("No hay campos para actualizar", 400));
  }

  values.push(id);
  const query = `
    UPDATE turnos SET ${fields.join(", ")}
    WHERE id = $${paramCount}
    RETURNING id, nombre, hora_inicio, hora_fin, descripcion, activo
  `;

  const result = await db.query(query, values);
  const turno = result.rows[0];

  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "UPDATE",
    modulo: "Catálogos - Turnos",
    tablaAfectada: "turnos",
    registroId: parseInt(id),
    descripcion: `Turno actualizado: ${turno.nombre}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosAnteriores,
    datosNuevos: req.body,
  });

  sendSuccess(res, 200, { turno }, "Turno actualizado exitosamente");
});

// =====================
// ÁREAS DE PRODUCCIÓN
// =====================

const getAreasProduccion = catchAsync(async (req, res, next) => {
  const { activo } = req.query;
  const filters = {};
  if (activo !== undefined) filters.activo = activo === "true";

  const areasProduccion = await AreaProduccion.findAll(filters);
  sendSuccess(res, 200, { areasProduccion });
});

const getAreaProduccionById = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const areaProduccion = await AreaProduccion.findById(id);

  if (!areaProduccion) {
    return next(new AppError("Área de producción no encontrada", 404));
  }

  sendSuccess(res, 200, { areaProduccion });
});

const createAreaProduccion = catchAsync(async (req, res, next) => {
  const { nombre, descripcion } = req.body;

  const query = `
    INSERT INTO areas_produccion (nombre, descripcion)
    VALUES ($1, $2)
    RETURNING id, nombre, descripcion, activo, creado_en
  `;

  const result = await db.query(query, [nombre, descripcion || null]);
  const areaProduccion = result.rows[0];

  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "CREATE",
    modulo: "Catálogos - Áreas de Producción",
    tablaAfectada: "areas_produccion",
    registroId: areaProduccion.id,
    descripcion: `Área de producción creada: ${nombre}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosNuevos: { nombre, descripcion },
  });

  sendSuccess(
    res,
    201,
    { areaProduccion },
    "Área de producción creada exitosamente",
  );
});

const updateAreaProduccion = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { nombre, descripcion, activo } = req.body;

  const areaExistente = await AreaProduccion.findById(id);
  if (!areaExistente) {
    return next(new AppError("Área de producción no encontrada", 404));
  }

  const datosAnteriores = { ...areaExistente };

  const fields = [];
  const values = [];
  let paramCount = 1;

  if (nombre !== undefined) {
    fields.push(`nombre = $${paramCount}`);
    values.push(nombre);
    paramCount++;
  }
  if (descripcion !== undefined) {
    fields.push(`descripcion = $${paramCount}`);
    values.push(descripcion);
    paramCount++;
  }
  if (activo !== undefined) {
    fields.push(`activo = $${paramCount}`);
    values.push(activo);
    paramCount++;
  }

  if (fields.length === 0) {
    return next(new AppError("No hay campos para actualizar", 400));
  }

  values.push(id);
  const query = `
    UPDATE areas_produccion SET ${fields.join(", ")}
    WHERE id = $${paramCount}
    RETURNING id, nombre, descripcion, activo
  `;

  const result = await db.query(query, values);
  const areaProduccion = result.rows[0];

  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "UPDATE",
    modulo: "Catálogos - Áreas de Producción",
    tablaAfectada: "areas_produccion",
    registroId: parseInt(id),
    descripcion: `Área de producción actualizada: ${areaProduccion.nombre}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosAnteriores,
    datosNuevos: req.body,
  });

  sendSuccess(
    res,
    200,
    { areaProduccion },
    "Área de producción actualizada exitosamente",
  );
});

// =====================
// TIPOS DE DEFECTOS
// =====================

const getTiposDefectos = catchAsync(async (req, res, next) => {
  const { activo, search } = req.query;
  const filters = {};
  if (activo !== undefined) filters.activo = activo === "true";
  if (search) filters.search = search;

  const tiposDefectos = await TipoDefecto.findAll(filters);
  sendSuccess(res, 200, { tiposDefectos });
});

const getTipoDefectoById = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const tipoDefecto = await TipoDefecto.findById(id);

  if (!tipoDefecto) {
    return next(new AppError("Tipo de defecto no encontrado", 404));
  }

  sendSuccess(res, 200, { tipoDefecto });
});

const createTipoDefecto = catchAsync(async (req, res, next) => {
  const { nombre, descripcion } = req.body;

  const tipoDefecto = await TipoDefecto.create({ nombre, descripcion });

  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "CREATE",
    modulo: "Catálogos - Tipos de Defectos",
    tablaAfectada: "tipos_defectos",
    registroId: tipoDefecto.id,
    descripcion: `Tipo de defecto creado: ${nombre}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosNuevos: { nombre, descripcion },
  });

  sendSuccess(res, 201, { tipoDefecto }, "Tipo de defecto creado exitosamente");
});

const updateTipoDefecto = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { nombre, descripcion, activo } = req.body;

  const tipoExistente = await TipoDefecto.findById(id);
  if (!tipoExistente) {
    return next(new AppError("Tipo de defecto no encontrado", 404));
  }

  const datosAnteriores = { ...tipoExistente };

  const tipoDefecto = await TipoDefecto.update(id, {
    nombre,
    descripcion,
    activo,
  });

  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "UPDATE",
    modulo: "Catálogos - Tipos de Defectos",
    tablaAfectada: "tipos_defectos",
    registroId: parseInt(id),
    descripcion: `Tipo de defecto actualizado: ${tipoDefecto.nombre}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosAnteriores,
    datosNuevos: req.body,
  });

  sendSuccess(
    res,
    200,
    { tipoDefecto },
    "Tipo de defecto actualizado exitosamente",
  );
});

// =====================
// ROLES
// =====================

const getRoles = catchAsync(async (req, res, next) => {
  const { activo } = req.query;
  const filters = {};
  if (activo !== undefined) filters.activo = activo === "true";

  const roles = await Rol.findAll(filters);
  sendSuccess(res, 200, { roles });
});

const getRolById = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const rol = await Rol.findById(id);

  if (!rol) {
    return next(new AppError("Rol no encontrado", 404));
  }

  // Obtener permisos del rol
  const permisos = await Rol.getPermissions(id);

  sendSuccess(res, 200, { rol, permisos });
});

const createRol = catchAsync(async (req, res, next) => {
  const { nombre, descripcion, esAdmin } = req.body;

  const query = `
    INSERT INTO roles (nombre, descripcion, es_admin)
    VALUES ($1, $2, $3)
    RETURNING id, nombre, descripcion, es_admin, activo, creado_en
  `;

  const result = await db.query(query, [
    nombre,
    descripcion || null,
    esAdmin || false,
  ]);
  const rol = result.rows[0];

  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "CREATE",
    modulo: "Catálogos - Roles",
    tablaAfectada: "roles",
    registroId: rol.id,
    descripcion: `Rol creado: ${nombre}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosNuevos: { nombre, descripcion, esAdmin },
  });

  sendSuccess(res, 201, { rol }, "Rol creado exitosamente");
});

const updateRol = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { nombre, descripcion, esAdmin, activo } = req.body;

  const rolExistente = await Rol.findById(id);
  if (!rolExistente) {
    return next(new AppError("Rol no encontrado", 404));
  }

  const datosAnteriores = { ...rolExistente };

  const fields = [];
  const values = [];
  let paramCount = 1;

  if (nombre !== undefined) {
    fields.push(`nombre = $${paramCount}`);
    values.push(nombre);
    paramCount++;
  }
  if (descripcion !== undefined) {
    fields.push(`descripcion = $${paramCount}`);
    values.push(descripcion);
    paramCount++;
  }
  if (esAdmin !== undefined) {
    fields.push(`es_admin = $${paramCount}`);
    values.push(esAdmin);
    paramCount++;
  }
  if (activo !== undefined) {
    fields.push(`activo = $${paramCount}`);
    values.push(activo);
    paramCount++;
  }

  if (fields.length === 0) {
    return next(new AppError("No hay campos para actualizar", 400));
  }

  values.push(id);
  const query = `
    UPDATE roles SET ${fields.join(", ")}
    WHERE id = $${paramCount}
    RETURNING id, nombre, descripcion, es_admin, activo
  `;

  const result = await db.query(query, values);
  const rol = result.rows[0];

  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "UPDATE",
    modulo: "Catálogos - Roles",
    tablaAfectada: "roles",
    registroId: parseInt(id),
    descripcion: `Rol actualizado: ${rol.nombre}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosAnteriores,
    datosNuevos: req.body,
  });

  sendSuccess(res, 200, { rol }, "Rol actualizado exitosamente");
});

// =====================
// ÁREAS (DEPARTAMENTOS)
// =====================

const getAreas = catchAsync(async (req, res, next) => {
  const { activo } = req.query;
  const filters = {};
  if (activo !== undefined) filters.activo = activo === "true";

  const areas = await Area.findAll(filters);
  sendSuccess(res, 200, { areas });
});

const getAreaById = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const area = await Area.findById(id);

  if (!area) {
    return next(new AppError("Área no encontrada", 404));
  }

  sendSuccess(res, 200, { area });
});

const createArea = catchAsync(async (req, res, next) => {
  const { nombre, descripcion } = req.body;

  const query = `
    INSERT INTO areas (nombre, descripcion)
    VALUES ($1, $2)
    RETURNING id, nombre, descripcion, activo, creado_en
  `;

  const result = await db.query(query, [nombre, descripcion || null]);
  const area = result.rows[0];

  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "CREATE",
    modulo: "Catálogos - Áreas",
    tablaAfectada: "areas",
    registroId: area.id,
    descripcion: `Área creada: ${nombre}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosNuevos: { nombre, descripcion },
  });

  sendSuccess(res, 201, { area }, "Área creada exitosamente");
});

const updateArea = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { nombre, descripcion, activo } = req.body;

  const areaExistente = await Area.findById(id);
  if (!areaExistente) {
    return next(new AppError("Área no encontrada", 404));
  }

  const datosAnteriores = { ...areaExistente };

  const fields = [];
  const values = [];
  let paramCount = 1;

  if (nombre !== undefined) {
    fields.push(`nombre = $${paramCount}`);
    values.push(nombre);
    paramCount++;
  }
  if (descripcion !== undefined) {
    fields.push(`descripcion = $${paramCount}`);
    values.push(descripcion);
    paramCount++;
  }
  if (activo !== undefined) {
    fields.push(`activo = $${paramCount}`);
    values.push(activo);
    paramCount++;
  }

  if (fields.length === 0) {
    return next(new AppError("No hay campos para actualizar", 400));
  }

  values.push(id);
  const query = `
    UPDATE areas SET ${fields.join(", ")}
    WHERE id = $${paramCount}
    RETURNING id, nombre, descripcion, activo
  `;

  const result = await db.query(query, values);
  const area = result.rows[0];

  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "UPDATE",
    modulo: "Catálogos - Áreas",
    tablaAfectada: "areas",
    registroId: parseInt(id),
    descripcion: `Área actualizada: ${area.nombre}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosAnteriores,
    datosNuevos: req.body,
  });

  sendSuccess(res, 200, { area }, "Área actualizada exitosamente");
});

module.exports = {
  // Turnos
  getTurnos,
  getTurnoById,
  createTurno,
  updateTurno,
  // Áreas de Producción
  getAreasProduccion,
  getAreaProduccionById,
  createAreaProduccion,
  updateAreaProduccion,
  // Tipos de Defectos
  getTiposDefectos,
  getTipoDefectoById,
  createTipoDefecto,
  updateTipoDefecto,
  // Roles
  getRoles,
  getRolById,
  createRol,
  updateRol,
  // Áreas
  getAreas,
  getAreaById,
  createArea,
  updateArea,
};
