const RolModulo = require("../models/RolModulo");
const Modulo = require("../models/Modulo");
const Rol = require("../models/Rol");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const {
  registrarLog,
  obtenerIP,
  obtenerUserAgent,
} = require("../utils/logger");

/**
 * Obtener todos los módulos del sistema
 */
const getModulos = catchAsync(async (req, res, next) => {
  const { activo } = req.query;
  const filters = {};
  if (activo !== undefined) filters.activo = activo === "true";

  const modulos = await Modulo.findAll(filters);
  sendSuccess(res, 200, { modulos });
});

/**
 * Obtener permisos de un rol específico
 */
const getPermisosRol = catchAsync(async (req, res, next) => {
  const { rolId } = req.params;

  // Verificar que el rol existe
  const rol = await Rol.findById(rolId);
  if (!rol) {
    return next(new AppError("Rol no encontrado", 404));
  }

  // Obtener todos los módulos con los permisos del rol
  const permisos = await RolModulo.findAllModulosWithPermisos(rolId);

  sendSuccess(res, 200, {
    rol: {
      id: rol.id,
      nombre: rol.nombre,
      esAdmin: rol.es_admin,
    },
    permisos,
  });
});

/**
 * Actualizar permisos de un rol
 */
const updatePermisosRol = catchAsync(async (req, res, next) => {
  const { rolId } = req.params;
  const { permisos } = req.body;

  // Verificar que el rol existe
  const rol = await Rol.findById(rolId);
  if (!rol) {
    return next(new AppError("Rol no encontrado", 404));
  }

  // No permitir modificar permisos de roles admin
  if (rol.es_admin) {
    return next(
      new AppError(
        "No se pueden modificar los permisos de un rol administrador",
        400,
      ),
    );
  }

  // Obtener permisos anteriores para el log
  const permisosAnteriores = await RolModulo.findByRolId(rolId);

  // Actualizar permisos
  await RolModulo.actualizarPermisosRol(rolId, permisos);

  // Obtener permisos actualizados
  const permisosNuevos = await RolModulo.findAllModulosWithPermisos(rolId);

  // Registrar en log
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "UPDATE",
    modulo: "Administración - Permisos",
    tablaAfectada: "roles_modulos",
    registroId: parseInt(rolId),
    descripcion: `Permisos actualizados para el rol: ${rol.nombre}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosAnteriores: { permisos: permisosAnteriores },
    datosNuevos: { permisos },
  });

  sendSuccess(
    res,
    200,
    {
      rol: {
        id: rol.id,
        nombre: rol.nombre,
      },
      permisos: permisosNuevos,
    },
    "Permisos actualizados exitosamente",
  );
});

/**
 * Actualizar un permiso específico de un rol para un módulo
 */
const updatePermisoModulo = catchAsync(async (req, res, next) => {
  const { rolId, moduloId } = req.params;
  const { puedeLeer, puedeCrear, puedeEditar, puedeEliminar } = req.body;

  // Verificar que el rol existe
  const rol = await Rol.findById(rolId);
  if (!rol) {
    return next(new AppError("Rol no encontrado", 404));
  }

  // No permitir modificar permisos de roles admin
  if (rol.es_admin) {
    return next(
      new AppError(
        "No se pueden modificar los permisos de un rol administrador",
        400,
      ),
    );
  }

  // Verificar que el módulo existe
  const modulo = await Modulo.findById(moduloId);
  if (!modulo) {
    return next(new AppError("Módulo no encontrado", 404));
  }

  // Actualizar permiso
  const resultado = await RolModulo.upsertPermiso(rolId, moduloId, {
    puedeLeer,
    puedeCrear,
    puedeEditar,
    puedeEliminar,
  });

  // Registrar en log
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "UPDATE",
    modulo: "Administración - Permisos",
    tablaAfectada: "roles_modulos",
    registroId: parseInt(rolId),
    descripcion: `Permiso actualizado: Rol "${rol.nombre}" - Módulo "${modulo.nombre}"`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosNuevos: { puedeLeer, puedeCrear, puedeEditar, puedeEliminar },
  });

  sendSuccess(res, 200, { permiso: resultado }, "Permiso actualizado");
});

/**
 * Copiar permisos de un rol a otro
 */
const copiarPermisosRol = catchAsync(async (req, res, next) => {
  const { rolOrigenId, rolDestinoId } = req.body;

  // Verificar que ambos roles existen
  const rolOrigen = await Rol.findById(rolOrigenId);
  const rolDestino = await Rol.findById(rolDestinoId);

  if (!rolOrigen) {
    return next(new AppError("Rol de origen no encontrado", 404));
  }
  if (!rolDestino) {
    return next(new AppError("Rol de destino no encontrado", 404));
  }

  // No permitir copiar a un rol admin
  if (rolDestino.es_admin) {
    return next(
      new AppError(
        "No se pueden modificar los permisos de un rol administrador",
        400,
      ),
    );
  }

  // Copiar permisos
  await RolModulo.copiarPermisos(rolOrigenId, rolDestinoId);

  // Registrar en log
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "UPDATE",
    modulo: "Administración - Permisos",
    tablaAfectada: "roles_modulos",
    registroId: parseInt(rolDestinoId),
    descripcion: `Permisos copiados de "${rolOrigen.nombre}" a "${rolDestino.nombre}"`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosNuevos: { rolOrigenId, rolDestinoId },
  });

  // Obtener permisos actualizados
  const permisos = await RolModulo.findAllModulosWithPermisos(rolDestinoId);

  sendSuccess(
    res,
    200,
    {
      rol: {
        id: rolDestino.id,
        nombre: rolDestino.nombre,
      },
      permisos,
    },
    `Permisos copiados de "${rolOrigen.nombre}" exitosamente`,
  );
});

/**
 * Verificar permiso de usuario actual
 */
const verificarMiPermiso = catchAsync(async (req, res, next) => {
  const { ruta, permiso } = req.query;

  if (!ruta) {
    return next(new AppError("Se requiere la ruta del módulo", 400));
  }

  const tipoPermiso = permiso || "puede_leer";
  const usuario = req.usuario;

  // Si es admin, tiene todos los permisos
  if (usuario.rol?.esAdmin || usuario.rol?.es_admin) {
    return sendSuccess(res, 200, { tienePermiso: true });
  }

  const tienePermiso = await RolModulo.verificarPermiso(
    usuario.rol?.id || usuario.rolId,
    ruta,
    tipoPermiso,
  );

  sendSuccess(res, 200, { tienePermiso });
});

module.exports = {
  getModulos,
  getPermisosRol,
  updatePermisosRol,
  updatePermisoModulo,
  copiarPermisosRol,
  verificarMiPermiso,
};
