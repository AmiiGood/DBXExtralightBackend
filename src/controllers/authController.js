const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Usuario = require("../models/Usuario");
const RolModulo = require("../models/RolModulo");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const {
  registrarLog,
  obtenerIP,
  obtenerUserAgent,
} = require("../utils/logger");

/**
 * Login de usuario
 */
const login = catchAsync(async (req, res, next) => {
  const { nombreUsuario, password } = req.body;

  // Buscar usuario por nombre de usuario
  const usuario = await Usuario.findByUsername(nombreUsuario);

  if (!usuario) {
    // Registrar intento fallido
    await registrarLog({
      usuarioId: null,
      accion: "LOGIN_FAILED",
      modulo: "Autenticación",
      descripcion: `Intento de login fallido: usuario "${nombreUsuario}" no encontrado`,
      ipAddress: obtenerIP(req),
      userAgent: obtenerUserAgent(req),
    });

    return next(new AppError("Credenciales inválidas", 401));
  }

  // Verificar si el usuario está activo
  if (!usuario.activo) {
    await registrarLog({
      usuarioId: usuario.id,
      accion: "LOGIN_FAILED",
      modulo: "Autenticación",
      descripcion: "Intento de login con cuenta desactivada",
      ipAddress: obtenerIP(req),
      userAgent: obtenerUserAgent(req),
    });

    return next(new AppError("Tu cuenta está desactivada", 401));
  }

  // Verificar contraseña
  const passwordValido = await bcrypt.compare(password, usuario.password_hash);

  if (!passwordValido) {
    await registrarLog({
      usuarioId: usuario.id,
      accion: "LOGIN_FAILED",
      modulo: "Autenticación",
      descripcion: "Intento de login con contraseña incorrecta",
      ipAddress: obtenerIP(req),
      userAgent: obtenerUserAgent(req),
    });

    return next(new AppError("Credenciales inválidas", 401));
  }

  // Actualizar último acceso
  await Usuario.updateLastAccess(usuario.id);

  // Generar token JWT
  const token = jwt.sign(
    {
      id: usuario.id,
      uuid: usuario.uuid,
      nombreUsuario: usuario.nombre_usuario,
      rolId: usuario.rol_id,
      esAdmin: usuario.es_admin,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" },
  );

  // Registrar login exitoso
  await registrarLog({
    usuarioId: usuario.id,
    accion: "LOGIN_SUCCESS",
    modulo: "Autenticación",
    descripcion: "Inicio de sesión exitoso",
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });

  // Preparar datos del usuario para la respuesta
  const usuarioResponse = {
    id: usuario.id,
    uuid: usuario.uuid,
    nombreUsuario: usuario.nombre_usuario,
    email: usuario.email,
    nombreCompleto: usuario.nombre_completo,
    rol: {
      id: usuario.rol_id,
      nombre: usuario.rol_nombre,
      esAdmin: usuario.es_admin,
    },
    area: {
      id: usuario.area_id,
      nombre: usuario.area_nombre,
    },
  };

  sendSuccess(res, 200, { token, usuario: usuarioResponse }, "Login exitoso");
});

/**
 * Obtener módulos accesibles para el usuario actual
 */
const getModulos = catchAsync(async (req, res, next) => {
  const usuario = req.usuario;

  // Obtener módulos según el rol y permisos
  const modulos = await RolModulo.getModulosAccesibles(
    usuario.rol?.id || usuario.rolId,
    usuario.rol?.esAdmin || usuario.esAdmin,
  );

  sendSuccess(res, 200, { modulos });
});

/**
 * Obtener perfil del usuario actual
 */
const getProfile = catchAsync(async (req, res, next) => {
  const usuario = await Usuario.findById(req.usuario.id);

  if (!usuario) {
    return next(new AppError("Usuario no encontrado", 404));
  }

  const usuarioResponse = {
    id: usuario.id,
    uuid: usuario.uuid,
    nombreUsuario: usuario.nombre_usuario,
    email: usuario.email,
    nombreCompleto: usuario.nombre_completo,
    rol: {
      id: usuario.rol_id,
      nombre: usuario.rol_nombre,
      esAdmin: usuario.es_admin,
    },
    area: {
      id: usuario.area_id,
      nombre: usuario.area_nombre,
    },
    ultimoAcceso: usuario.ultimo_acceso,
  };

  sendSuccess(res, 200, { usuario: usuarioResponse });
});

/**
 * Cambiar contraseña del usuario actual
 */
const changePassword = catchAsync(async (req, res, next) => {
  const { passwordActual, nuevaPassword } = req.body;
  const usuarioId = req.usuario.id;

  // Obtener usuario con password
  const usuario = await Usuario.findById(usuarioId);

  if (!usuario) {
    return next(new AppError("Usuario no encontrado", 404));
  }

  // Verificar contraseña actual
  const passwordValido = await bcrypt.compare(
    passwordActual,
    usuario.password_hash,
  );

  if (!passwordValido) {
    await registrarLog({
      usuarioId,
      accion: "CHANGE_PASSWORD_FAILED",
      modulo: "Autenticación",
      descripcion:
        "Intento de cambio de contraseña con contraseña actual incorrecta",
      ipAddress: obtenerIP(req),
      userAgent: obtenerUserAgent(req),
    });

    return next(new AppError("La contraseña actual es incorrecta", 400));
  }

  // Hashear nueva contraseña
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(nuevaPassword, salt);

  // Actualizar contraseña
  await Usuario.updatePassword(usuarioId, passwordHash);

  await registrarLog({
    usuarioId,
    accion: "CHANGE_PASSWORD",
    modulo: "Autenticación",
    descripcion: "Contraseña cambiada exitosamente",
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });

  sendSuccess(res, 200, null, "Contraseña actualizada exitosamente");
});

/**
 * Logout (para registro en logs)
 */
const logout = catchAsync(async (req, res, next) => {
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "LOGOUT",
    modulo: "Autenticación",
    descripcion: "Cierre de sesión",
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });

  sendSuccess(res, 200, null, "Sesión cerrada exitosamente");
});

module.exports = {
  login,
  getModulos,
  getProfile,
  changePassword,
  logout,
};
