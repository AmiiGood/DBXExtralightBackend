const { query, param } = require("express-validator");

/**
 * Validación para obtener POs
 */
const getPOsValidation = [
  query("estado")
    .optional()
    .isIn([
      "PENDIENTE",
      "EN_PRODUCCION",
      "EN_EMBARQUE",
      "COMPLETADA",
      "ENVIADA",
      "CANCELADA",
    ])
    .withMessage("Estado inválido"),

  query("poNumber")
    .optional()
    .isString()
    .withMessage("poNumber debe ser texto"),

  query("fechaInicio")
    .optional()
    .isISO8601()
    .withMessage("fechaInicio debe ser una fecha válida"),

  query("fechaFin")
    .optional()
    .isISO8601()
    .withMessage("fechaFin debe ser una fecha válida"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage("El límite debe estar entre 1 y 500"),

  query("offset")
    .optional()
    .isInt({ min: 0 })
    .withMessage("El offset debe ser un número entero no negativo"),
];

/**
 * Validación para obtener PO por ID
 */
const getPoByIdValidation = [
  param("id")
    .isInt({ min: 1 })
    .withMessage("El ID debe ser un número entero positivo"),
];

/**
 * Validación para obtener cartones por PO
 */
const getCartonesByPoValidation = [
  param("poId")
    .isInt({ min: 1 })
    .withMessage("El ID de la PO debe ser un número entero positivo"),

  query("tipo")
    .optional()
    .isIn(["MONO", "MUSICAL"])
    .withMessage("Tipo debe ser MONO o MUSICAL"),

  query("estado")
    .optional()
    .isIn(["PENDIENTE", "COMPLETADO", "LIGADO"])
    .withMessage("Estado inválido"),
];

/**
 * Validación para obtener info de cartón
 */
const getCartonInfoValidation = [
  param("cartonId")
    .notEmpty()
    .withMessage("CartonID es requerido")
    .isString()
    .withMessage("CartonID debe ser texto"),
];

/**
 * Validación para historial de importaciones
 */
const getHistorialValidation = [
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("El límite debe estar entre 1 y 100"),
];

module.exports = {
  getPOsValidation,
  getPoByIdValidation,
  getCartonesByPoValidation,
  getCartonInfoValidation,
  getHistorialValidation,
};
