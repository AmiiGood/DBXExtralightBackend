const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const os = require("os");
const compoundController = require("../controllers/compoundController");
const { authenticate } = require("../middlewares/auth");
const { puedeLeer, puedeCrear } = require("../middlewares/permisos");

const MODULO = "/compound/reportes";
// La carga es un módulo aparte, igual que "Carga de Producción": así se
// conceden por separado el ver el reporte y el reemplazar sus datos.
const MODULO_CARGA = "/compound/carga";

/**
 * Subida de los Excel de Compound.
 *
 * A disco y no a memoria, igual que en Inyección: aunque estos archivos son
 * chicos (menos de 1 MB), el controlador ya sabe limpiar el temporal y no vale
 * la pena tener dos caminos distintos.
 */
const subida = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) =>
      cb(null, `comp-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".xlsx" || ext === ".xlsm") return cb(null, true);
    cb(new Error("El archivo debe ser .xlsx o .xlsm"));
  },
});

/** Convierte los errores de multer en respuestas entendibles. */
const conArchivo = (campo) => (req, res, next) =>
  subida.single(campo)(req, res, (err) => {
    if (!err) return next();
    const msg =
      err.code === "LIMIT_FILE_SIZE"
        ? "El archivo pasa de 20 MB"
        : err.message || "No se pudo recibir el archivo";
    return res.status(400).json({ status: "error", message: msg });
  });

// =============================================
// REPORTES
// =============================================

/**
 * @route   GET /api/compound/reportes/filtros
 * @desc    Años, líneas, turnos, supervisores y BU disponibles
 * @access  Private
 */
router.get("/reportes/filtros", authenticate, puedeLeer(MODULO), compoundController.getFiltros);

/**
 * @route   GET /api/compound/reportes/dashboard
 * @desc    Producción, tiempo muerto por causa, y cortes por línea/turno/supervisor
 * @access  Private
 */
router.get("/reportes/dashboard", authenticate, puedeLeer(MODULO), compoundController.getDashboard);

/**
 * @route   GET /api/compound/reportes/recuperacion
 * @desc    Recuperación de polvo por BU, contra su meta
 * @access  Private
 */
router.get("/reportes/recuperacion", authenticate, puedeLeer(MODULO), compoundController.getRecuperacion);

/**
 * @route   GET /api/compound/reportes/comparar
 * @desc    Compara dos periodos, incluido el delta por causa de paro
 * @access  Private
 */
router.get("/reportes/comparar", authenticate, puedeLeer(MODULO), compoundController.getComparativo);

// =============================================
// CARGA
// =============================================

/**
 * @route   POST /api/compound/carga/analizar
 * @desc    Resumen de lo que trae el archivo, sin escribir en la base
 * @access  Private
 */
router.post("/carga/analizar", authenticate, puedeLeer(MODULO_CARGA), conArchivo("archivo"), compoundController.analizarCarga);

/**
 * @route   POST /api/compound/carga/importar
 * @desc    Carga el archivo reemplazando su rango de fechas
 * @access  Private
 */
router.post("/carga/importar", authenticate, puedeCrear(MODULO_CARGA), conArchivo("archivo"), compoundController.importarCarga);

/**
 * @route   GET /api/compound/carga/historial
 * @desc    Últimas cargas realizadas
 * @access  Private
 */
router.get("/carga/historial", authenticate, puedeLeer(MODULO_CARGA), compoundController.getHistorialCargas);

module.exports = router;
