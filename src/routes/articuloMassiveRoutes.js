const express = require("express");
const router = express.Router();
const articuloMassiveController = require("../controllers/articuloMassiveController");
const { authenticate, verificarPermiso } = require("../middlewares/auth");

// Todas las rutas requieren autenticación
router.use(authenticate);

/**
 * @route   GET /api/articulos-massive/catalogos
 * @desc    Catálogos del módulo: colores, estilos, unfin, strap, tallas
 * @access  Private (Carga Masiva de Artículos - leer)
 */
router.get(
  "/catalogos",
  verificarPermiso("Carga Masiva de Artículos", "leer"),
  articuloMassiveController.getCatalogos,
);

/**
 * @route   POST /api/articulos-massive/productos/buscar
 * @desc    Buscar productos del Avery por SKUs o por estilo + color
 * @body    { skus: [...] } ó { estilo: "10001", color: "214" }
 * @access  Private (Carga Masiva de Artículos - leer)
 */
router.post(
  "/productos/buscar",
  verificarPermiso("Carga Masiva de Artículos", "leer"),
  articuloMassiveController.buscarProductos,
);

/**
 * @route   POST /api/articulos-massive/colores
 * @desc    Alta rápida de un color faltante en el catálogo
 * @body    { codigo: "30T", nombre: "Crocs Green" }
 * @access  Private (Carga Masiva de Artículos - crear)
 */
router.post(
  "/colores",
  verificarPermiso("Carga Masiva de Artículos", "crear"),
  articuloMassiveController.crearColor,
);

module.exports = router;
