const express = require("express");
const router = express.Router();
const tiController = require("../controllers/tiController");
const { authenticate } = require("../middlewares/auth");
const { puedeLeer, puedeEditar } = require("../middlewares/permisos");

const MODULO = "/ti/reportes";

// =============================================
// REPORTES
// =============================================

/**
 * @route   GET /api/ti/reportes/filtros
 * @desc    Temas y años disponibles para los selectores
 * @access  Private
 */
router.get("/reportes/filtros", authenticate, puedeLeer(MODULO), tiController.getFiltros);

/**
 * @route   GET /api/ti/reportes/dashboard
 * @desc    Tiempos de resolución y de primera respuesta, por tema y periodo,
 *          más el reparto del equipo y el backlog
 * @access  Private
 */
router.get("/reportes/dashboard", authenticate, puedeLeer(MODULO), tiController.getDashboard);

// =============================================
// SINCRONIZACIÓN CON osTicket
// =============================================

/**
 * @route   GET /api/ti/sincronizacion
 * @desc    Qué tan fresca está la réplica local
 * @access  Private
 */
router.get(
  "/sincronizacion",
  authenticate,
  puedeLeer(MODULO),
  tiController.getEstadoSincronizacion,
);

/**
 * @route   POST /api/ti/sincronizacion
 * @desc    Fuerza una sincronización sin esperar a la programada
 * @access  Private
 *
 * Pide permiso de edición y no solo de lectura: aunque no cambia ningún
 * indicador, sí escribe en la réplica y le pega al servidor de osTicket, que es
 * la mesa de ayuda de toda la planta.
 */
router.post(
  "/sincronizacion",
  authenticate,
  puedeEditar(MODULO),
  tiController.sincronizar,
);

module.exports = router;
