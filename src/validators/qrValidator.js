const { body, query } = require("express-validator");

/**
 * Validación para escaneo de QR
 */
const escanearQrValidation = [
  body("qrCode")
    .trim()
    .notEmpty()
    .withMessage("El código QR es requerido")
    .isLength({ max: 1000 })
    .withMessage("El código QR es demasiado largo"),
];

/**
 * Validación para sincronización TUS
 */
const sincronizarTusValidation = [
  body("lastGetTime")
    .optional()
    .isString()
    .withMessage(
      "lastGetTime debe ser un string con formato 'YYYY-MM-DD HH:mm:ss'",
    ),
];

/**
 * Validación para consulta de escaneos
 */
const getEscaneosValidation = [
  query("fechaInicio")
    .optional()
    .isISO8601()
    .withMessage("fechaInicio debe ser una fecha válida en formato ISO8601"),

  query("fechaFin")
    .optional()
    .isISO8601()
    .withMessage("fechaFin debe ser una fecha válida en formato ISO8601"),

  query("escaneadoPor")
    .optional()
    .isInt({ min: 1 })
    .withMessage("escaneadoPor debe ser un entero positivo"),

  query("productoEncontrado")
    .optional()
    .isIn(["true", "false"])
    .withMessage("productoEncontrado debe ser true o false"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage("El límite debe estar entre 1 y 500"),

  query("offset")
    .optional()
    .isInt({ min: 0 })
    .withMessage("El offset debe ser un entero no negativo"),
];

/**
 * Validación para estadísticas
 */
const getEstadisticasValidation = [
  query("fechaInicio")
    .notEmpty()
    .withMessage("fechaInicio es requerida")
    .isISO8601()
    .withMessage("fechaInicio debe ser una fecha válida"),

  query("fechaFin")
    .notEmpty()
    .withMessage("fechaFin es requerida")
    .isISO8601()
    .withMessage("fechaFin debe ser una fecha válida"),
];

/**
 * Validación para consulta de productos
 */
const getProductosValidation = [
  query("search").optional().isString().withMessage("search debe ser texto"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage("El límite debe estar entre 1 y 500"),

  query("offset")
    .optional()
    .isInt({ min: 0 })
    .withMessage("El offset debe ser un entero no negativo"),
];

module.exports = {
  escanearQrValidation,
  sincronizarTusValidation,
  getEscaneosValidation,
  getEstadisticasValidation,
  getProductosValidation,
};
