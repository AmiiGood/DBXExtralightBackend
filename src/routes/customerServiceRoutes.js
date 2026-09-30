const express = require("express");
const router = express.Router();
const controller = require("../controllers/customerServiceController");
const { authenticate } = require("../middlewares/auth");
const { puedeLeer, puedeEditar } = require("../middlewares/permisos");

const REPORTES = "/customer-service/reportes";
const ARCHIVOS = "/customer-service/archivos";

// =============================================
// REPORTE
// =============================================

/**
 * @route   GET /api/customer-service/reportes/filtros
 * @desc    Años, indicadores y catálogos de las muestras
 * @access  Private
 */
router.get("/reportes/filtros", authenticate, puedeLeer(REPORTES), controller.getFiltros);

/**
 * @route   GET /api/customer-service/reportes/kpi
 * @desc    OTS, OTIF y SC: semana a semana, por unidad de negocio y por año
 * @access  Private
 */
router.get("/reportes/kpi", authenticate, puedeLeer(REPORTES), controller.getKpi);

/**
 * @route   GET /api/customer-service/reportes/muestras
 * @desc    Cumplimiento de muestras: por familia, cliente, periodo y desvío
 * @access  Private
 */
router.get("/reportes/muestras", authenticate, puedeLeer(REPORTES), controller.getMuestras);

/**
 * @route   GET /api/customer-service/reportes/muestras/detalle
 * @desc    El renglón a renglón, para la tabla y la exportación
 * @access  Private
 */
router.get(
  "/reportes/muestras/detalle",
  authenticate,
  puedeLeer(REPORTES),
  controller.getMuestrasDetalle,
);

// =============================================
// ARCHIVOS VIGILADOS
//
// Van con su propio módulo de permisos: una cosa es ver el reporte y otra
// cambiar de dónde sale el dato de toda el área.
// =============================================

/**
 * @route   GET /api/customer-service/archivos
 * @desc    Qué archivos se vigilan, cuándo se leyeron y con qué resultado
 * @access  Private
 */
router.get("/archivos", authenticate, puedeLeer(ARCHIVOS), controller.getArchivos);

/**
 * @route   PUT /api/customer-service/archivos/:clave
 * @desc    Cambia la carpeta, el nombre del archivo o si se vigila
 * @access  Private
 */
router.put("/archivos/:clave", authenticate, puedeEditar(ARCHIVOS), controller.putArchivo);

/**
 * @route   POST /api/customer-service/archivos/:clave/probar
 * @desc    Revisa que la ruta se alcance, sin cargar nada
 * @access  Private
 *
 * Solo lectura a propósito: no mueve un dato y es justo lo que hay que poder
 * correr mientras se gestionan los permisos del recurso compartido.
 */
router.post(
  "/archivos/:clave/probar",
  authenticate,
  puedeLeer(ARCHIVOS),
  controller.probarArchivo,
);

/**
 * @route   POST /api/customer-service/archivos/sincronizar
 * @desc    Lee ya, sin esperar a la vuelta programada
 * @access  Private
 */
router.post(
  "/archivos/sincronizar",
  authenticate,
  puedeEditar(ARCHIVOS),
  controller.sincronizar,
);

module.exports = router;
