const { body, query, param } = require("express-validator");

/**
 * Validación para escanear caja
 */
const escanearCajaValidation = [
  body("codigoCaja")
    .trim()
    .notEmpty()
    .withMessage("El código de caja es requerido")
    .isString()
    .withMessage("El código de caja debe ser texto"),
];

/**
 * Validación para agregar QR a caja
 */
const agregarQrValidation = [
  param("cajaId")
    .isInt({ min: 1 })
    .withMessage("El ID de la caja debe ser un número entero positivo"),

  body("qrCode")
    .trim()
    .notEmpty()
    .withMessage("El código QR es requerido")
    .isString()
    .withMessage("El código QR debe ser texto"),
];

/**
 * Validación para obtener caja por ID
 */
const getCajaValidation = [
  param("cajaId")
    .isInt({ min: 1 })
    .withMessage("El ID de la caja debe ser un número entero positivo"),
];

/**
 * Validación para listar cajas
 */
const getCajasValidation = [
  query("estado")
    .optional()
    .isIn(["EN_PROCESO", "COMPLETADA", "EMBARCADA"])
    .withMessage("Estado inválido"),

  query("sku").optional().isString().withMessage("SKU debe ser texto"),

  query("turnoId")
    .optional()
    .isInt({ min: 1 })
    .withMessage("turnoId debe ser un número entero positivo"),

  query("fechaInicio")
    .optional()
    .isISO8601()
    .withMessage("fechaInicio debe ser una fecha válida"),

  query("fechaFin")
    .optional()
    .isISO8601()
    .withMessage("fechaFin debe ser una fecha válida"),

  query("escaneadoPor")
    .optional()
    .isInt({ min: 1 })
    .withMessage("escaneadoPor debe ser un número entero positivo"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage("limit debe estar entre 1 y 500"),

  query("offset")
    .optional()
    .isInt({ min: 0 })
    .withMessage("offset debe ser un número entero no negativo"),
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
 * Validación para cajas en proceso
 */
const getCajasEnProcesoValidation = [
  query("turnoId")
    .optional()
    .isInt({ min: 1 })
    .withMessage("turnoId debe ser un número entero positivo"),

  query("escaneadoPor")
    .optional()
    .isInt({ min: 1 })
    .withMessage("escaneadoPor debe ser un número entero positivo"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit debe estar entre 1 y 100"),
];

module.exports = {
  escanearCajaValidation,
  agregarQrValidation,
  getCajaValidation,
  getCajasValidation,
  getEstadisticasValidation,
  getCajasEnProcesoValidation,
};
