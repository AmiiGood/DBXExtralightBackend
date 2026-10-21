const express = require("express");
const router = express.Router();
const controller = require("../controllers/aimsController");
const { authenticate } = require("../middlewares/auth");
const { puedeLeer, puedeEditar } = require("../middlewares/permisos");

const REPORTES = "/aims/reportes";
const ARCHIVO = "/aims/archivo";

/**
 * @route   GET /api/aims/reportes
 * @desc    Los indicadores de AIMS del año, mes a mes, contra su meta
 * @access  Private
 */
router.get("/reportes", authenticate, puedeLeer(REPORTES), controller.getReporte);

// =============================================
// ARCHIVO VIGILADO
// =============================================

/**
 * @route   GET /api/aims/archivo
 * @desc    Configuración, último libro leído y bitácora
 * @access  Private
 */
router.get("/archivo", authenticate, puedeLeer(ARCHIVO), controller.getArchivo);

/**
 * @route   PUT /api/aims/archivo
 * @desc    Cambia carpeta, principio del nombre o si se vigila
 * @access  Private
 */
router.put("/archivo", authenticate, puedeEditar(ARCHIVO), controller.putArchivo);

/**
 * @route   POST /api/aims/archivo/probar
 * @desc    Qué libro se elegiría y qué trae, sin cargar nada
 * @access  Private
 */
router.post("/archivo/probar", authenticate, puedeLeer(ARCHIVO), controller.probarArchivo);

/**
 * @route   POST /api/aims/archivo/sincronizar
 * @desc    Lee ya, sin esperar a la vuelta programada
 * @access  Private
 */
router.post("/archivo/sincronizar", authenticate, puedeEditar(ARCHIVO), controller.sincronizar);

module.exports = router;
