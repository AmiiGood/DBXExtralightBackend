const express = require("express");
const router = express.Router();
const produccionController = require("../controllers/produccionController");
const produccionValidator = require("../validators/produccionValidator");
const { authenticate } = require("../middlewares/auth");
const { validationResult } = require("express-validator");

// Middleware para manejar errores de validación
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      status: "error",
      message: "Errores de validación",
      errors: errors.array(),
    });
  }
  next();
};

// =============================================
// RUTAS DE PRODUCCIÓN
// =============================================

/**
 * @route   GET /api/produccion/dashboard
 * @desc    Obtener resumen del módulo de producción
 * @access  Private
 */
router.get("/dashboard", authenticate, produccionController.getDashboard);

/**
 * @route   POST /api/produccion/cajas
 * @desc    Escanear código de caja (iniciar proceso)
 * @access  Private
 */
router.post(
  "/cajas",
  authenticate,
  produccionValidator.escanearCajaValidation,
  handleValidationErrors,
  produccionController.escanearCaja,
);

/**
 * @route   GET /api/produccion/cajas
 * @desc    Listar cajas con filtros
 * @access  Private
 */
router.get(
  "/cajas",
  authenticate,
  produccionValidator.getCajasValidation,
  handleValidationErrors,
  produccionController.getCajas,
);

/**
 * @route   GET /api/produccion/cajas/en-proceso
 * @desc    Obtener cajas en proceso
 * @access  Private
 */
router.get(
  "/cajas/en-proceso",
  authenticate,
  produccionValidator.getCajasEnProcesoValidation,
  handleValidationErrors,
  produccionController.getCajasEnProceso,
);

/**
 * @route   GET /api/produccion/cajas/:cajaId
 * @desc    Obtener información de una caja específica
 * @access  Private
 */
router.get(
  "/cajas/:cajaId",
  authenticate,
  produccionValidator.getCajaValidation,
  handleValidationErrors,
  produccionController.getCaja,
);

/**
 * @route   POST /api/produccion/cajas/:cajaId/qrs
 * @desc    Agregar QR a una caja
 * @access  Private
 */
router.post(
  "/cajas/:cajaId/qrs",
  authenticate,
  produccionValidator.agregarQrValidation,
  handleValidationErrors,
  produccionController.agregarQrACaja,
);

/**
 * @route   GET /api/produccion/estadisticas
 * @desc    Obtener estadísticas de producción por rango de fechas
 * @access  Private
 */
router.get(
  "/estadisticas",
  authenticate,
  produccionValidator.getEstadisticasValidation,
  handleValidationErrors,
  produccionController.getEstadisticas,
);

module.exports = router;
