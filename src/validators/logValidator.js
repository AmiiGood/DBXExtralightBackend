const { query, param } = require("express-validator");

/**
 * Validación para filtros de consulta de logs
 */
const getLogsValidation = [
  query("fechaInicio")
    .optional()
    .isISO8601()
    .withMessage("fechaInicio debe ser una fecha válida en formato ISO8601"),

  query("fechaFin")
    .optional()
    .isISO8601()
    .withMessage("fechaFin debe ser una fecha válida en formato ISO8601"),

  query("usuarioId")
    .optional()
    .isInt({ min: 1 })
    .withMessage("El ID del usuario debe ser un número entero positivo"),

  query("accion").optional().isString().withMessage("La acción debe ser texto"),

  query("modulo").optional().isString().withMessage("El módulo debe ser texto"),

  query("tablaAfectada")
    .optional()
    .isString()
    .withMessage("La tabla afectada debe ser texto"),

  query("search")
    .optional()
    .isString()
    .withMessage("El término de búsqueda debe ser texto"),

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
    .isIn(["creado_en", "accion", "modulo", "usuario_id"])
    .withMessage(
      "orderBy debe ser uno de: creado_en, accion, modulo, usuario_id",
    ),

  query("orderDir")
    .optional()
    .isIn(["ASC", "DESC"])
    .withMessage("orderDir debe ser ASC o DESC"),
];

/**
 * Validación para obtener estadísticas
 */
const getEstadisticasValidation = [
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
 * Validación para obtener log por ID
 */
const getLogByIdValidation = [
  param("id")
    .isInt({ min: 1 })
    .withMessage("El ID debe ser un número entero positivo"),
];

module.exports = {
  getLogsValidation,
  getEstadisticasValidation,
  getLogByIdValidation,
};
