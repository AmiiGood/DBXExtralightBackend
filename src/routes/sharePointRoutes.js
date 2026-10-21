const express = require("express");
const router = express.Router();
const controller = require("../controllers/sharePointController");
const { authenticate } = require("../middlewares/auth");
const { puedeLeer, puedeEditar } = require("../middlewares/permisos");

const MODULO = "/admin/sharepoint";

/**
 * @route   GET /api/sharepoint/archivos
 * @desc    Qué archivos se vigilan, cuándo se leyeron y con qué resultado
 * @access  Private
 */
router.get("/archivos", authenticate, puedeLeer(MODULO), controller.getArchivos);

/**
 * @route   PUT /api/sharepoint/archivos/:clave
 * @desc    Cambia la carpeta, el nombre del archivo o si se vigila
 * @access  Private
 */
router.put("/archivos/:clave", authenticate, puedeEditar(MODULO), controller.putArchivo);

/**
 * @route   POST /api/sharepoint/archivos/:clave/probar
 * @desc    Revisa que el archivo se alcance, sin bajarlo ni cargarlo
 * @access  Private
 */
router.post(
  "/archivos/:clave/probar",
  authenticate,
  puedeLeer(MODULO),
  controller.probarArchivo,
);

/**
 * @route   POST /api/sharepoint/archivos/sincronizar
 * @desc    Lee ya, sin esperar a la vuelta programada
 * @access  Private
 */
router.post(
  "/archivos/sincronizar",
  authenticate,
  puedeEditar(MODULO),
  controller.sincronizar,
);

module.exports = router;
