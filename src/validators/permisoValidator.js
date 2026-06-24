const { body, param, query } = require("express-validator");

/**
 * Validación para obtener permisos de un rol
 */
const getPermisosRolValidation = [
  param("rolId")
    .isInt({ min: 1 })
    .withMessage("El ID del rol debe ser un número entero positivo"),
];

/**
 * Validación para actualizar permisos de un rol
 */
const updatePermisosRolValidation = [
  param("rolId")
    .isInt({ min: 1 })
    .withMessage("El ID del rol debe ser un número entero positivo"),

  body("permisos")
    .isArray({ min: 1 })
    .withMessage("Se requiere un array de permisos"),

  body("permisos.*.moduloId")
    .isInt({ min: 1 })
    .withMessage("Cada permiso debe tener un moduloId válido"),

  body("permisos.*.puedeLeer")
    .optional()
    .isBoolean()
    .withMessage("puedeLeer debe ser booleano"),

  body("permisos.*.puedeCrear")
    .optional()
    .isBoolean()
    .withMessage("puedeCrear debe ser booleano"),

  body("permisos.*.puedeEditar")
    .optional()
    .isBoolean()
    .withMessage("puedeEditar debe ser booleano"),

  body("permisos.*.puedeEliminar")
    .optional()
    .isBoolean()
    .withMessage("puedeEliminar debe ser booleano"),
];

/**
 * Validación para actualizar un permiso específico
 */
const updatePermisoModuloValidation = [
  param("rolId")
    .isInt({ min: 1 })
    .withMessage("El ID del rol debe ser un número entero positivo"),

  param("moduloId")
    .isInt({ min: 1 })
    .withMessage("El ID del módulo debe ser un número entero positivo"),

  body("puedeLeer")
    .optional()
    .isBoolean()
    .withMessage("puedeLeer debe ser booleano"),

  body("puedeCrear")
    .optional()
    .isBoolean()
    .withMessage("puedeCrear debe ser booleano"),

  body("puedeEditar")
    .optional()
    .isBoolean()
    .withMessage("puedeEditar debe ser booleano"),

  body("puedeEliminar")
    .optional()
    .isBoolean()
    .withMessage("puedeEliminar debe ser booleano"),
];

/**
 * Validación para copiar permisos
 */
const copiarPermisosValidation = [
  body("rolOrigenId")
    .isInt({ min: 1 })
    .withMessage("El ID del rol de origen debe ser un número entero positivo"),

  body("rolDestinoId")
    .isInt({ min: 1 })
    .withMessage("El ID del rol de destino debe ser un número entero positivo"),
];

/**
 * Validación para verificar permiso
 */
const verificarPermisoValidation = [
  query("ruta").notEmpty().withMessage("Se requiere la ruta del módulo"),

  query("permiso")
    .optional()
    .isIn(["puede_leer", "puede_crear", "puede_editar", "puede_eliminar"])
    .withMessage("Permiso inválido"),
];

module.exports = {
  getPermisosRolValidation,
  updatePermisosRolValidation,
  updatePermisoModuloValidation,
  copiarPermisosValidation,
  verificarPermisoValidation,
};
