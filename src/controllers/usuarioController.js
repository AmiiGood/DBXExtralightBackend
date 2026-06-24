const Usuario = require("../models/Usuario");
const Rol = require("../models/Rol");
const Area = require("../models/Area");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const {
  registrarLog,
  obtenerIP,
  obtenerUserAgent,
} = require("../utils/logger");

/**
 * Obtener todos los usuarios
 */
const getAllUsers = catchAsync(async (req, res, next) => {
  const { activo, rolId, areaId } = req.query;

  const filters = {};
  if (activo !== undefined) filters.activo = activo === "true";
  if (rolId) filters.rolId = parseInt(rolId);
  if (areaId) filters.areaId = parseInt(areaId);

  const usuarios = await Usuario.findAll(filters);

  // No enviar el password_hash
  const usuariosSinPassword = usuarios.map(
    ({ password_hash, ...usuario }) => usuario
  );

  sendSuccess(res, 200, { usuarios: usuariosSinPassword });
});

/**
 * Obtener un usuario por ID
 */
const getUserById = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const usuario = await Usuario.findById(id);

  if (!usuario) {
    return next(new AppError("Usuario no encontrado", 404));
  }

  // Eliminar el password_hash de la respuesta
  const { password_hash, ...usuarioSinPassword } = usuario;

  sendSuccess(res, 200, { usuario: usuarioSinPassword });
});

/**
 * Crear un nuevo usuario
 */
const createUser = catchAsync(async (req, res, next) => {
  const { nombreUsuario, email, password, nombreCompleto, rolId, areaId } =
    req.body;

  // Validar que el rol existe
  const rol = await Rol.findById(rolId);
  if (!rol) {
    return next(new AppError("El rol especificado no existe", 400));
  }

  // Validar que el área existe
  const area = await Area.findById(areaId);
  if (!area) {
    return next(new AppError("El área especificada no existe", 400));
  }

  // Verificar que el nombre de usuario no exista
  const usuarioExistente = await Usuario.findByUsername(nombreUsuario);
  if (usuarioExistente) {
    return next(new AppError("El nombre de usuario ya existe", 400));
  }

  // Verificar que el email no exista
  const emailExistente = await Usuario.findByEmail(email);
  if (emailExistente) {
    return next(new AppError("El email ya está registrado", 400));
  }

  // Crear el usuario
  const nuevoUsuario = await Usuario.create({
    nombreUsuario,
    email,
    password,
    nombreCompleto,
    rolId,
    areaId,
    creadoPor: req.usuario.id,
  });

  // Registrar en logs
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "CREATE",
    modulo: "Usuarios",
    tablaAfectada: "usuarios",
    registroId: nuevoUsuario.id,
    descripcion: `Usuario creado: ${nombreUsuario}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosNuevos: { nombreUsuario, email, nombreCompleto, rolId, areaId },
  });

  // Buscar el usuario completo con información de rol y área
  const usuarioCompleto = await Usuario.findById(nuevoUsuario.id);
  const { password_hash, ...usuarioSinPassword } = usuarioCompleto;

  sendSuccess(
    res,
    201,
    { usuario: usuarioSinPassword },
    "Usuario creado exitosamente"
  );
});

/**
 * Actualizar un usuario
 */
const updateUser = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { nombreUsuario, email, nombreCompleto, rolId, areaId, activo } =
    req.body;

  // Verificar que el usuario existe
  const usuarioExistente = await Usuario.findById(id);
  if (!usuarioExistente) {
    return next(new AppError("Usuario no encontrado", 404));
  }

  // Guardar datos anteriores para el log
  const datosAnteriores = {
    nombreUsuario: usuarioExistente.nombre_usuario,
    email: usuarioExistente.email,
    nombreCompleto: usuarioExistente.nombre_completo,
    rolId: usuarioExistente.rol_id,
    areaId: usuarioExistente.area_id,
    activo: usuarioExistente.activo,
  };

  // Preparar datos para actualizar
  const datosActualizar = {};

  if (nombreUsuario !== undefined) {
    // Verificar que el nuevo nombre de usuario no esté en uso por otro usuario
    const usuarioConNombre = await Usuario.findByUsername(nombreUsuario);
    if (usuarioConNombre && usuarioConNombre.id !== parseInt(id)) {
      return next(new AppError("El nombre de usuario ya existe", 400));
    }
    datosActualizar.nombreUsuario = nombreUsuario;
  }

  if (email !== undefined) {
    // Verificar que el nuevo email no esté en uso por otro usuario
    const usuarioConEmail = await Usuario.findByEmail(email);
    if (usuarioConEmail && usuarioConEmail.id !== parseInt(id)) {
      return next(new AppError("El email ya está registrado", 400));
    }
    datosActualizar.email = email;
  }

  if (nombreCompleto !== undefined) {
    datosActualizar.nombreCompleto = nombreCompleto;
  }

  if (rolId !== undefined) {
    // Validar que el rol existe
    const rol = await Rol.findById(rolId);
    if (!rol) {
      return next(new AppError("El rol especificado no existe", 400));
    }
    datosActualizar.rolId = rolId;
  }

  if (areaId !== undefined) {
    // Validar que el área existe
    const area = await Area.findById(areaId);
    if (!area) {
      return next(new AppError("El área especificada no existe", 400));
    }
    datosActualizar.areaId = areaId;
  }

  if (activo !== undefined) {
    datosActualizar.activo = activo;
  }

  // Actualizar el usuario
  const usuarioActualizado = await Usuario.update(id, datosActualizar);

  // Registrar en logs
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "UPDATE",
    modulo: "Usuarios",
    tablaAfectada: "usuarios",
    registroId: parseInt(id),
    descripcion: `Usuario actualizado: ${usuarioExistente.nombre_usuario}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosAnteriores,
    datosNuevos: datosActualizar,
  });

  // Buscar el usuario completo con información de rol y área
  const usuarioCompleto = await Usuario.findById(id);
  const { password_hash, ...usuarioSinPassword } = usuarioCompleto;

  sendSuccess(
    res,
    200,
    { usuario: usuarioSinPassword },
    "Usuario actualizado exitosamente"
  );
});

/**
 * Desactivar usuario (soft delete)
 */
const deactivateUser = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  // Verificar que el usuario existe
  const usuario = await Usuario.findById(id);
  if (!usuario) {
    return next(new AppError("Usuario no encontrado", 404));
  }

  // No permitir desactivar el propio usuario
  if (parseInt(id) === req.usuario.id) {
    return next(new AppError("No puedes desactivar tu propia cuenta", 400));
  }

  // Desactivar el usuario
  await Usuario.softDelete(id);

  // Registrar en logs
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "DEACTIVATE",
    modulo: "Usuarios",
    tablaAfectada: "usuarios",
    registroId: parseInt(id),
    descripcion: `Usuario desactivado: ${usuario.nombre_usuario}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });

  sendSuccess(res, 200, null, "Usuario desactivado exitosamente");
});

/**
 * Activar usuario
 */
const activateUser = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  // Verificar que el usuario existe
  const usuario = await Usuario.findById(id);
  if (!usuario) {
    return next(new AppError("Usuario no encontrado", 404));
  }

  // Activar el usuario
  await Usuario.update(id, { activo: true });

  // Registrar en logs
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "ACTIVATE",
    modulo: "Usuarios",
    tablaAfectada: "usuarios",
    registroId: parseInt(id),
    descripcion: `Usuario activado: ${usuario.nombre_usuario}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });

  sendSuccess(res, 200, null, "Usuario activado exitosamente");
});

/**
 * Resetear contraseña de un usuario
 */
const resetPassword = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { nuevaPassword } = req.body;

  if (!nuevaPassword || nuevaPassword.length < 6) {
    return next(
      new AppError("La contraseña debe tener al menos 6 caracteres", 400)
    );
  }

  // Verificar que el usuario existe
  const usuario = await Usuario.findById(id);
  if (!usuario) {
    return next(new AppError("Usuario no encontrado", 404));
  }

  // Actualizar contraseña
  await Usuario.update(id, { password: nuevaPassword });

  // Registrar en logs
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "RESET_PASSWORD",
    modulo: "Usuarios",
    tablaAfectada: "usuarios",
    registroId: parseInt(id),
    descripcion: `Contraseña reseteada para usuario: ${usuario.nombre_usuario}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });

  sendSuccess(res, 200, null, "Contraseña actualizada exitosamente");
});

/**
 * Obtener roles disponibles
 */
const getRoles = catchAsync(async (req, res, next) => {
  const roles = await Rol.findAll({ activo: true });
  sendSuccess(res, 200, { roles });
});

/**
 * Obtener áreas disponibles
 */
const getAreas = catchAsync(async (req, res, next) => {
  const areas = await Area.findAll({ activo: true });
  sendSuccess(res, 200, { areas });
});

module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deactivateUser,
  activateUser,
  resetPassword,
  getRoles,
  getAreas,
};
