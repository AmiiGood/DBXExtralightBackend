const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const os = require("os");
const staffController = require("../controllers/staffController");
const { authenticate } = require("../middlewares/auth");
const { puedeLeer, puedeCrear } = require("../middlewares/permisos");

const MODULO = "/staff/reportes";
// La carga va por separado, igual que en Compuestos: una cosa es ver la junta
// y otra reemplazar sus datos.
const MODULO_CARGA = "/staff/carga";

/**
 * Subida del Excel semanal de la junta.
 *
 * A disco y no a memoria, igual que en Inyección y Compuestos. El archivo pesa
 * menos de 1 MB, pero el límite se deja en 20 MB por si alguien manda el libro
 * completo con las hojas ocultas.
 */
const subida = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) =>
      cb(null, `staff-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
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
 * @route   GET /api/staff/reportes/filtros
 * @desc    Años, bloques y cortes de PO abierta disponibles
 * @access  Private
 */
router.get("/reportes/filtros", authenticate, puedeLeer(MODULO), staffController.getFiltros);

/**
 * @route   GET /api/staff/reportes/serie
 * @desc    Serie de un bloque contra su meta, lista para graficar
 * @access  Private
 */
router.get("/reportes/serie", authenticate, puedeLeer(MODULO), staffController.getSerie);

/**
 * @route   GET /api/staff/reportes/trimestres
 * @desc    Promedio diario por trimestre (las tablas de la presentación)
 * @access  Private
 */
router.get("/reportes/trimestres", authenticate, puedeLeer(MODULO), staffController.getTrimestres);

/**
 * @route   GET /api/staff/reportes/open-po
 * @desc    Foto de la PO abierta por BU y mes de entrega
 * @access  Private
 */
router.get("/reportes/open-po", authenticate, puedeLeer(MODULO), staffController.getOpenPo);

// =============================================
// CARGA
// =============================================

/**
 * @route   POST /api/staff/carga/analizar
 * @desc    Resumen de lo que trae el archivo, sin escribir en la base
 * @access  Private
 */
router.post("/carga/analizar", authenticate, puedeLeer(MODULO_CARGA), conArchivo("archivo"), staffController.analizarCarga);

/**
 * @route   POST /api/staff/carga/importar
 * @desc    Carga el archivo; actualiza las series y archiva la PO abierta
 * @access  Private
 */
router.post("/carga/importar", authenticate, puedeCrear(MODULO_CARGA), conArchivo("archivo"), staffController.importarCarga);

/**
 * @route   GET /api/staff/carga/historial
 * @desc    Últimas cargas realizadas
 * @access  Private
 */
router.get("/carga/historial", authenticate, puedeLeer(MODULO_CARGA), staffController.getHistorialCargas);

module.exports = router;
