const { body, query } = require("express-validator");

/**
 * Validación para crear registro de defecto
 */
const createRegistroValidation = [
  body("turnoId")
    .optional()
    .isInt({ min: 1 })
    .withMessage("El ID del turno debe ser un número entero positivo"),

  body("areaProduccionId")
    .notEmpty()
    .withMessage("El área de producción es requerida")
    .isInt({ min: 1 })
    .withMessage(
      "El ID del área de producción debe ser un número entero positivo"
    ),

  body("tipoDefectoId")
    .notEmpty()
    .withMessage("El tipo de defecto es requerido")
    .isInt({ min: 1 })
    .withMessage(
      "El ID del tipo de defecto debe ser un número entero positivo"
    ),

  body("paresRechazados")
    .notEmpty()
    .withMessage("La cantidad de pares rechazados es requerida")
    .isInt({ min: 1 })
    .withMessage("Los pares rechazados deben ser un número entero positivo"),

  body("observaciones")
    .optional()
    .isString()
    .withMessage("Las observaciones deben ser texto")
    .isLength({ max: 500 })
    .withMessage("Las observaciones no pueden exceder 500 caracteres"),
];

/**
 * Validación para actualizar registro de defecto
 */
const updateRegistroValidation = [
  body("turnoId")
    .optional()
    .isInt({ min: 1 })
    .withMessage("El ID del turno debe ser un número entero positivo"),

  body("areaProduccionId")
    .optional()
    .isInt({ min: 1 })
    .withMessage(
      "El ID del área de producción debe ser un número entero positivo"
    ),

  body("tipoDefectoId")
    .optional()
    .isInt({ min: 1 })
    .withMessage(
      "El ID del tipo de defecto debe ser un número entero positivo"
    ),

  body("paresRechazados")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Los pares rechazados deben ser un número entero positivo"),

  body("observaciones")
    .optional()
    .isString()
    .withMessage("Las observaciones deben ser texto")
    .isLength({ max: 500 })
    .withMessage("Las observaciones no pueden exceder 500 caracteres"),
];

/**
 * Validación para filtros de consulta
 */
const getRegistrosValidation = [
  query("fechaInicio")
    .optional()
    .isISO8601()
    .withMessage("fechaInicio debe ser una fecha válida en formato ISO8601"),

  query("fechaFin")
    .optional()
    .isISO8601()
    .withMessage("fechaFin debe ser una fecha válida en formato ISO8601"),

  query("turnoId")
    .optional()
    .isInt({ min: 1 })
    .withMessage("El ID del turno debe ser un número entero positivo"),

  query("areaProduccionId")
    .optional()
    .isInt({ min: 1 })
    .withMessage(
      "El ID del área de producción debe ser un número entero positivo"
    ),

  query("tipoDefectoId")
    .optional()
    .isInt({ min: 1 })
    .withMessage(
      "El ID del tipo de defecto debe ser un número entero positivo"
    ),

  query("registradoPor")
    .optional()
    .isInt({ min: 1 })
    .withMessage("El ID del usuario debe ser un número entero positivo"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage("El límite debe estar entre 1 y 500"),

  query("offset")
    .optional()
    .isInt({ min: 0 })
    .withMessage("El offset debe ser un número entero no negativo"),

  query("orderBy")
    .optional()
    .isIn([
      "fecha_registro",
      "pares_rechazados",
      "turno_nombre",
      "tipo_defecto_nombre",
    ])
    .withMessage(
      "orderBy debe ser uno de: fecha_registro, pares_rechazados, turno_nombre, tipo_defecto_nombre"
    ),

  query("orderDir")
    .optional()
    .isIn(["ASC", "DESC"])
    .withMessage("orderDir debe ser ASC o DESC"),
];

/**
 * Validación para resumen por turno
 */
const getResumenValidation = [
  query("fechaInicio")
    .notEmpty()
    .withMessage("fechaInicio es requerida")
    .isISO8601()
    .withMessage("fechaInicio debe ser una fecha válida en formato ISO8601"),

  query("fechaFin")
    .notEmpty()
    .withMessage("fechaFin es requerida")
    .isISO8601()
    .withMessage("fechaFin debe ser una fecha válida en formato ISO8601"),
];

/**
 * Validación para top defectos
 */
const getTopDefectosValidation = [
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("El límite debe estar entre 1 y 100"),

  query("fechaInicio")
    .optional()
    .isISO8601()
    .withMessage("fechaInicio debe ser una fecha válida en formato ISO8601"),

  query("fechaFin")
    .optional()
    .isISO8601()
    .withMessage("fechaFin debe ser una fecha válida en formato ISO8601"),
];

module.exports = {
  createRegistroValidation,
  updateRegistroValidation,
  getRegistrosValidation,
  getResumenValidation,
  getTopDefectosValidation,
};
