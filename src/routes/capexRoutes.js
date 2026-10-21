const express = require("express");
const router = express.Router();
const controller = require("../controllers/capexController");
const { authenticate } = require("../middlewares/auth");
const { puedeLeer, puedeEditar } = require("../middlewares/permisos");

const REPORTES = "/capex/reportes";
const ARCHIVO = "/capex/archivo";

/**
 * @route   GET /api/capex/reportes
 * @desc    Proyectos con firmas FOAM: totales, detalle y gasto por trimestre
 * @access  Private
 */
router.get("/reportes", authenticate, puedeLeer(REPORTES), controller.getReporte);

// =============================================
// ARCHIVO VIGILADO
//
// Con su propio módulo de permisos: una cosa es ver el reporte y otra cambiar
// de dónde sale el dato.
// =============================================

/**
 * @route   GET /api/capex/archivo
 * @desc    Configuración, último libro leído y bitácora
 * @access  Private
 */
router.get("/archivo", authenticate, puedeLeer(ARCHIVO), controller.getArchivo);

/**
 * @route   PUT /api/capex/archivo
 * @desc    Cambia carpeta, principio del nombre, hoja, bloque o si se vigila
 * @access  Private
 */
router.put("/archivo", authenticate, puedeEditar(ARCHIVO), controller.putArchivo);

/**
 * @route   POST /api/capex/archivo/probar
 * @desc    Qué libro se elegiría y qué trae el bloque, sin cargar nada
 * @access  Private
 */
router.post("/archivo/probar", authenticate, puedeLeer(ARCHIVO), controller.probarArchivo);

/**
 * @route   POST /api/capex/archivo/sincronizar
 * @desc    Lee ya, sin esperar a la vuelta programada
 * @access  Private
 */
router.post("/archivo/sincronizar", authenticate, puedeEditar(ARCHIVO), controller.sincronizar);

module.exports = router;
