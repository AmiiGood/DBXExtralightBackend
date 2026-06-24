const RolModulo = require("../models/RolModulo");
const { AppError } = require("../utils/errorHandler");

/**
 * Middleware para verificar permisos en módulos
 *
 * @param {string} moduloRuta - Ruta del módulo (ej: '/admin/usuarios')
 * @param {string} tipoPermiso - Tipo de permiso a verificar: puede_leer, puede_crear, puede_editar, puede_eliminar
 */
const verificarPermiso = (moduloRuta, tipoPermiso = "puede_leer") => {
  return async (req, res, next) => {
    try {
      const usuario = req.usuario;

      // Si no hay usuario autenticado
      if (!usuario) {
        return next(new AppError("No autorizado", 401));
      }

      // Si es administrador, tiene acceso total
      if (usuario.rol?.esAdmin || usuario.rol?.es_admin) {
        return next();
      }

      // Obtener el rol del usuario
      const rolId = usuario.rol?.id || usuario.rolId;

      if (!rolId) {
        return next(new AppError("Usuario sin rol asignado", 403));
      }

      // Verificar el permiso
      const tienePermiso = await RolModulo.verificarPermiso(
        rolId,
        moduloRuta,
        tipoPermiso,
      );

      if (!tienePermiso) {
        const mensajes = {
          puede_leer: "No tienes permiso para ver este módulo",
          puede_crear: "No tienes permiso para crear en este módulo",
          puede_editar: "No tienes permiso para editar en este módulo",
          puede_eliminar: "No tienes permiso para eliminar en este módulo",
        };

        return next(new AppError(mensajes[tipoPermiso] || "Sin permiso", 403));
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Middleware para verificar permiso de lectura
 */
const puedeLeer = (moduloRuta) => verificarPermiso(moduloRuta, "puede_leer");

/**
 * Middleware para verificar permiso de creación
 */
const puedeCrear = (moduloRuta) => verificarPermiso(moduloRuta, "puede_crear");

/**
 * Middleware para verificar permiso de edición
 */
const puedeEditar = (moduloRuta) =>
  verificarPermiso(moduloRuta, "puede_editar");

/**
 * Middleware para verificar permiso de eliminación
 */
const puedeEliminar = (moduloRuta) =>
  verificarPermiso(moduloRuta, "puede_eliminar");

/**
 * Middleware dinámico que determina el permiso según el método HTTP
 *
 * GET -> puede_leer
 * POST -> puede_crear
 * PUT/PATCH -> puede_editar
 * DELETE -> puede_eliminar
 */
const verificarPermisoAutomatico = (moduloRuta) => {
  return async (req, res, next) => {
    const metodoPermiso = {
      GET: "puede_leer",
      POST: "puede_crear",
      PUT: "puede_editar",
      PATCH: "puede_editar",
      DELETE: "puede_eliminar",
    };

    const tipoPermiso = metodoPermiso[req.method] || "puede_leer";

    return verificarPermiso(moduloRuta, tipoPermiso)(req, res, next);
  };
};

module.exports = {
  verificarPermiso,
  puedeLeer,
  puedeCrear,
  puedeEditar,
  puedeEliminar,
  verificarPermisoAutomatico,
};
