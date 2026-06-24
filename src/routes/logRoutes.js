const express = require("express");
const router = express.Router();
const logController = require("../controllers/logController");
const { authenticate, isAdmin } = require("../middlewares/auth");
const { validationResult } = require("express-validator");
const {
  getLogsValidation,
  getEstadisticasValidation,
  getLogByIdValidation,
} = require("../validators/logValidator");

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

// Todas las rutas requieren autenticación y ser administrador
router.use(authenticate);
router.use(isAdmin);

/**
 * @route   GET /api/logs/catalogos
 * @desc    Obtener catálogos para filtros (acciones, módulos, tablas, usuarios)
 * @access  Private (Admin)
 */
router.get("/catalogos", logController.getCatalogos);

/**
 * @route   GET /api/logs/estadisticas
 * @desc    Obtener estadísticas de logs
 * @query   ?fechaInicio=2025-01-01&fechaFin=2025-01-31
 * @access  Private (Admin)
 */
router.get(
  "/estadisticas",
  getEstadisticasValidation,
  handleValidationErrors,
  logController.getEstadisticas,
);

/**
 * @route   GET /api/logs
 * @desc    Obtener todos los logs con filtros y paginación
 * @query   ?fechaInicio=2025-01-01&fechaFin=2025-01-31&usuarioId=1&accion=LOGIN&limit=50&offset=0
 * @access  Private (Admin)
 */
router.get(
  "/",
  getLogsValidation,
  handleValidationErrors,
  logController.getLogs,
);

/**
 * @route   GET /api/logs/:id
 * @desc    Obtener un log por ID
 * @access  Private (Admin)
 */
router.get(
  "/:id",
  getLogByIdValidation,
  handleValidationErrors,
  logController.getLogById,
);

module.exports = router;
