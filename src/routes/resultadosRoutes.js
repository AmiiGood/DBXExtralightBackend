const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const os = require("os");
const resultadosController = require("../controllers/resultadosController");
const { authenticate } = require("../middlewares/auth");
const { puedeLeer, puedeCrear } = require("../middlewares/permisos");

const MODULO = "/resultados/reportes";
// La carga va por separado, igual que en Compuestos y STAFF: una cosa es ver
// los resultados y otra reemplazarlos.
const MODULO_CARGA = "/resultados/carga";

/** Subida del Excel mensual. A disco, igual que en los demás módulos. */
const subida = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) =>
      cb(null, `res-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
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
 * @route   GET /api/resultados/reportes/filtros
 * @desc    Años con dato, unidades de negocio y último corte cargado
 * @access  Private
 */
router.get("/reportes/filtros", authenticate, puedeLeer(MODULO), resultadosController.getFiltros);

/**
 * @route   GET /api/resultados/reportes/dashboard
 * @desc    Los siete bloques del año: facturación, scrap, capacidad, personal,
 *          energía, compound y estado de resultados
 * @access  Private
 */
router.get("/reportes/dashboard", authenticate, puedeLeer(MODULO), resultadosController.getDashboard);

/**
 * @route   GET /api/resultados/reportes/mensual
 * @desc    Doce meses con una columna por año (la gráfica principal del libro)
 * @access  Private
 */
router.get("/reportes/mensual", authenticate, puedeLeer(MODULO), resultadosController.getComparativoMensual);

/**
 * @route   GET /api/resultados/reportes/historico
 * @desc    Un renglón por año, para comparar la historia completa
 * @access  Private
 */
router.get("/reportes/historico", authenticate, puedeLeer(MODULO), resultadosController.getHistorico);

// =============================================
// CARGA
// =============================================

/**
 * @route   POST /api/resultados/carga/analizar
 * @desc    Resumen de lo que trae el archivo, sin escribir en la base
 * @access  Private
 */
router.post("/carga/analizar", authenticate, puedeLeer(MODULO_CARGA), conArchivo("archivo"), resultadosController.analizarCarga);

/**
 * @route   POST /api/resultados/carga/importar
 * @desc    Carga el archivo actualizando lo que cambió
 * @access  Private
 */
router.post("/carga/importar", authenticate, puedeCrear(MODULO_CARGA), conArchivo("archivo"), resultadosController.importarCarga);

/**
 * @route   GET /api/resultados/carga/historial
 * @desc    Últimas cargas realizadas
 * @access  Private
 */
router.get("/carga/historial", authenticate, puedeLeer(MODULO_CARGA), resultadosController.getHistorialCargas);

module.exports = router;
