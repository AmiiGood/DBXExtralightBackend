const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const os = require("os");
const inyeccionController = require("../controllers/inyeccionController");
const inyeccionValidator = require("../validators/inyeccionValidator");
const { authenticate } = require("../middlewares/auth");
const { puedeLeer, puedeCrear } = require("../middlewares/permisos");
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

const MODULO = "/produccion/reportes";
const MODULO_CAPTURA = "/produccion/inyeccion";
const MODULO_CARGA = "/produccion/carga-produccion";

/**
 * Subida del Excel de producción.
 *
 * Va a disco y no a memoria: el archivo ronda los 30 MB y crece, así que no
 * conviene tenerlo en el heap de Node mientras se procesa. El controlador borra
 * el temporal al terminar, salga bien o mal.
 */
const subida = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) =>
      cb(null, `iny-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 80 * 1024 * 1024 },
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
        ? "El archivo pasa de 80 MB"
        : err.message || "No se pudo recibir el archivo";
    return res.status(400).json({ status: "error", message: msg });
  });

// =============================================
// REPORTES DE PRODUCCIÓN INYECCIÓN
// =============================================

/**
 * @route   GET /api/inyeccion/reportes/filtros
 * @desc    Valores disponibles para los slicers (años, meses, semanas, BUs)
 * @access  Private
 */
router.get(
  "/reportes/filtros",
  authenticate,
  puedeLeer(MODULO),
  inyeccionController.getFiltros,
);

/**
 * @route   GET /api/inyeccion/reportes/dashboard
 * @desc    Series de las páginas Inj e Inj 2 (producción, scrap, %scrap)
 * @access  Private
 */
router.get(
  "/reportes/dashboard",
  authenticate,
  puedeLeer(MODULO),
  inyeccionValidator.getDashboardValidation,
  handleValidationErrors,
  inyeccionController.getDashboard,
);

/**
 * @route   GET /api/inyeccion/reportes/comparar
 * @desc    Compara dos periodos del mismo tipo (mes, trimestre, semestre, año)
 * @access  Private
 */
router.get(
  "/reportes/comparar",
  authenticate,
  puedeLeer(MODULO),
  inyeccionValidator.compararValidation,
  handleValidationErrors,
  inyeccionController.getComparativo,
);

// =============================================
// CARGA DEL EXCEL DE PRODUCCIÓN
// =============================================

/**
 * @route   POST /api/inyeccion/carga/analizar
 * @desc    Resumen de lo que trae el archivo, sin escribir en la base
 * @access  Private
 */
router.post(
  "/carga/analizar",
  authenticate,
  puedeLeer(MODULO_CARGA),
  conArchivo("archivo"),
  inyeccionController.analizarCarga,
);

/**
 * @route   POST /api/inyeccion/carga/importar
 * @desc    Carga el archivo reemplazando su rango de fechas
 * @access  Private
 */
router.post(
  "/carga/importar",
  authenticate,
  puedeCrear(MODULO_CARGA),
  conArchivo("archivo"),
  inyeccionController.importarCarga,
);

/**
 * @route   GET /api/inyeccion/carga/historial
 * @desc    Últimas cargas realizadas
 * @access  Private
 */
router.get(
  "/carga/historial",
  authenticate,
  puedeLeer(MODULO_CARGA),
  inyeccionController.getHistorialCargas,
);

// =============================================
// CAPTURA DE PRODUCCIÓN
// =============================================

/**
 * @route   GET /api/inyeccion/captura/catalogos
 * @desc    Máquinas activas con sus estaciones, y turnos
 * @access  Private
 */
router.get(
  "/captura/catalogos",
  authenticate,
  puedeLeer(MODULO_CAPTURA),
  inyeccionController.getCatalogosCaptura,
);

/**
 * @route   GET /api/inyeccion/captura/avance
 * @desc    Qué máquinas y turnos ya tienen captura ese día
 * @access  Private
 */
router.get(
  "/captura/avance",
  authenticate,
  puedeLeer(MODULO_CAPTURA),
  inyeccionValidator.getAvanceValidation,
  handleValidationErrors,
  inyeccionController.getAvanceDelDia,
);

/**
 * @route   GET /api/inyeccion/captura
 * @desc    Renglones ya capturados de una fecha + máquina + turno
 * @access  Private
 */
router.get(
  "/captura",
  authenticate,
  puedeLeer(MODULO_CAPTURA),
  inyeccionValidator.getCapturaValidation,
  handleValidationErrors,
  inyeccionController.getCaptura,
);

/**
 * @route   POST /api/inyeccion/captura
 * @desc    Guardar el turno completo (inserta, actualiza y borra en una transacción)
 * @access  Private
 */
router.post(
  "/captura",
  authenticate,
  puedeCrear(MODULO_CAPTURA),
  inyeccionValidator.guardarCapturaValidation,
  handleValidationErrors,
  inyeccionController.guardarCaptura,
);

/**
 * @route   GET /api/inyeccion/productos
 * @desc    Autocompletar de producto semiterminado por SKU o descripción
 * @access  Private
 */
router.get(
  "/productos",
  authenticate,
  puedeLeer(MODULO_CAPTURA),
  inyeccionController.buscarProductos,
);

module.exports = router;
