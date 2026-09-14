const express = require("express");
const router = express.Router();
const moldesController = require("../controllers/moldesController");
const { authenticate } = require("../middlewares/auth");
const { puedeLeer, puedeEditar } = require("../middlewares/permisos");

const MODULO = "/moldes/reportes";

// =============================================
// REPORTES DE MOLDES
// =============================================

/**
 * @route   GET /api/moldes/reportes/filtros
 * @desc    Temas, años y meses disponibles para los selectores
 * @access  Private
 */
router.get(
  "/reportes/filtros",
  authenticate,
  puedeLeer(MODULO),
  moldesController.getFiltros,
);

/**
 * @route   GET /api/moldes/reportes/dashboard
 * @desc    Tiempos de atención del área: tarjetas, series, distribución y detalle
 * @access  Private
 */
router.get(
  "/reportes/dashboard",
  authenticate,
  puedeLeer(MODULO),
  moldesController.getDashboard,
);

/**
 * @route   GET /api/moldes/reportes/comparar
 * @desc    Compara dos periodos del mismo tipo (mes, trimestre, semestre, año)
 * @access  Private
 */
router.get(
  "/reportes/comparar",
  authenticate,
  puedeLeer(MODULO),
  moldesController.getComparativo,
);

// =============================================
// SINCRONIZACIÓN CON osTicket
// =============================================

/**
 * @route   GET /api/moldes/sincronizacion
 * @desc    Qué tan fresca está la réplica local
 * @access  Private
 */
router.get(
  "/sincronizacion",
  authenticate,
  puedeLeer(MODULO),
  moldesController.getEstadoSincronizacion,
);

/**
 * @route   POST /api/moldes/sincronizacion
 * @desc    Fuerza una sincronización sin esperar a la programada
 * @access  Private
 *
 * Pide permiso de edición y no solo de lectura: aunque no cambia ningún
 * indicador, sí escribe en la réplica y le pega al servidor de osTicket, que
 * es de la mesa de ayuda de toda la planta.
 */
router.post(
  "/sincronizacion",
  authenticate,
  puedeEditar(MODULO),
  moldesController.sincronizar,
);

module.exports = router;
