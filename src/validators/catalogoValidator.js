const { body, param, query } = require("express-validator");

// =====================
// TURNOS
// =====================

const createTurnoValidation = [
  body("nombre")
    .trim()
    .notEmpty()
    .withMessage("El nombre es requerido")
    .isLength({ max: 50 })
    .withMessage("El nombre no puede exceder 50 caracteres"),

  body("horaInicio")
    .notEmpty()
    .withMessage("La hora de inicio es requerida")
    .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/)
    .withMessage("Formato de hora inválido (HH:MM o HH:MM:SS)"),

  body("horaFin")
    .notEmpty()
    .withMessage("La hora de fin es requerida")
    .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/)
    .withMessage("Formato de hora inválido (HH:MM o HH:MM:SS)"),

  body("descripcion")
    .optional()
    .isString()
    .withMessage("La descripción debe ser texto")
    .isLength({ max: 255 })
    .withMessage("La descripción no puede exceder 255 caracteres"),
];

const updateTurnoValidation = [
  param("id")
    .isInt({ min: 1 })
    .withMessage("El ID debe ser un número entero positivo"),

  body("nombre")
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage("El nombre no puede exceder 50 caracteres"),

  body("horaInicio")
    .optional()
    .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/)
    .withMessage("Formato de hora inválido (HH:MM o HH:MM:SS)"),

  body("horaFin")
    .optional()
    .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/)
    .withMessage("Formato de hora inválido (HH:MM o HH:MM:SS)"),

  body("descripcion")
    .optional()
    .isString()
    .withMessage("La descripción debe ser texto")
    .isLength({ max: 255 })
    .withMessage("La descripción no puede exceder 255 caracteres"),

  body("activo").optional().isBoolean().withMessage("Activo debe ser booleano"),
];

// =====================
// ÁREAS DE PRODUCCIÓN
// =====================

const createAreaProduccionValidation = [
  body("nombre")
    .trim()
    .notEmpty()
    .withMessage("El nombre es requerido")
    .isLength({ max: 100 })
    .withMessage("El nombre no puede exceder 100 caracteres"),

  body("descripcion")
    .optional()
    .isString()
    .withMessage("La descripción debe ser texto")
    .isLength({ max: 255 })
    .withMessage("La descripción no puede exceder 255 caracteres"),
];

const updateAreaProduccionValidation = [
  param("id")
    .isInt({ min: 1 })
    .withMessage("El ID debe ser un número entero positivo"),

  body("nombre")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("El nombre no puede exceder 100 caracteres"),

  body("descripcion")
    .optional()
    .isString()
    .withMessage("La descripción debe ser texto")
    .isLength({ max: 255 })
    .withMessage("La descripción no puede exceder 255 caracteres"),

  body("activo").optional().isBoolean().withMessage("Activo debe ser booleano"),
];

// =====================
// TIPOS DE DEFECTOS
// =====================

const createTipoDefectoValidation = [
  body("nombre")
    .trim()
    .notEmpty()
    .withMessage("El nombre es requerido")
    .isLength({ max: 100 })
    .withMessage("El nombre no puede exceder 100 caracteres"),

  body("descripcion")
    .optional()
    .isString()
    .withMessage("La descripción debe ser texto")
    .isLength({ max: 500 })
    .withMessage("La descripción no puede exceder 500 caracteres"),
];

const updateTipoDefectoValidation = [
  param("id")
    .isInt({ min: 1 })
    .withMessage("El ID debe ser un número entero positivo"),

  body("nombre")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("El nombre no puede exceder 100 caracteres"),

  body("descripcion")
    .optional()
    .isString()
    .withMessage("La descripción debe ser texto")
    .isLength({ max: 500 })
    .withMessage("La descripción no puede exceder 500 caracteres"),

  body("activo").optional().isBoolean().withMessage("Activo debe ser booleano"),
];

// =====================
// ROLES
// =====================

const createRolValidation = [
  body("nombre")
    .trim()
    .notEmpty()
    .withMessage("El nombre es requerido")
    .isLength({ max: 50 })
    .withMessage("El nombre no puede exceder 50 caracteres"),

  body("descripcion")
    .optional()
    .isString()
    .withMessage("La descripción debe ser texto")
    .isLength({ max: 255 })
    .withMessage("La descripción no puede exceder 255 caracteres"),

  body("esAdmin")
    .optional()
    .isBoolean()
    .withMessage("esAdmin debe ser booleano"),
];

const updateRolValidation = [
  param("id")
    .isInt({ min: 1 })
    .withMessage("El ID debe ser un número entero positivo"),

  body("nombre")
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage("El nombre no puede exceder 50 caracteres"),

  body("descripcion")
    .optional()
    .isString()
    .withMessage("La descripción debe ser texto")
    .isLength({ max: 255 })
    .withMessage("La descripción no puede exceder 255 caracteres"),

  body("esAdmin")
    .optional()
    .isBoolean()
    .withMessage("esAdmin debe ser booleano"),

  body("activo").optional().isBoolean().withMessage("Activo debe ser booleano"),
];

// =====================
// ÁREAS (DEPARTAMENTOS)
// =====================

const createAreaValidation = [
  body("nombre")
    .trim()
    .notEmpty()
    .withMessage("El nombre es requerido")
    .isLength({ max: 100 })
    .withMessage("El nombre no puede exceder 100 caracteres"),

  body("descripcion")
    .optional()
    .isString()
    .withMessage("La descripción debe ser texto")
    .isLength({ max: 255 })
    .withMessage("La descripción no puede exceder 255 caracteres"),
];

const updateAreaValidation = [
  param("id")
    .isInt({ min: 1 })
    .withMessage("El ID debe ser un número entero positivo"),

  body("nombre")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("El nombre no puede exceder 100 caracteres"),

  body("descripcion")
    .optional()
    .isString()
    .withMessage("La descripción debe ser texto")
    .isLength({ max: 255 })
    .withMessage("La descripción no puede exceder 255 caracteres"),

  body("activo").optional().isBoolean().withMessage("Activo debe ser booleano"),
];

// =====================
// COMÚN
// =====================

const idParamValidation = [
  param("id")
    .isInt({ min: 1 })
    .withMessage("El ID debe ser un número entero positivo"),
];

module.exports = {
  // Turnos
  createTurnoValidation,
  updateTurnoValidation,
  // Áreas de Producción
  createAreaProduccionValidation,
  updateAreaProduccionValidation,
  // Tipos de Defectos
  createTipoDefectoValidation,
  updateTipoDefectoValidation,
  // Roles
  createRolValidation,
  updateRolValidation,
  // Áreas
  createAreaValidation,
  updateAreaValidation,
  // Común
  idParamValidation,
};
