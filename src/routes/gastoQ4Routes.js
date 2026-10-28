const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const os = require("os");
const controller = require("../controllers/gastoQ4Controller");
const { authenticate } = require("../middlewares/auth");
const { puedeLeer, puedeCrear } = require("../middlewares/permisos");

const MODULO = "/gasto-q4/reportes";
// La carga es un módulo aparte: quien consulta no necesariamente sube.
const MODULO_CARGA = "/gasto-q4/carga";

/** Subida del libro Budget Acumulado (unos 25 KB). A disco, como Checadas. */
const subida = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) =>
      cb(null, `gq4-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".xlsx" || ext === ".xls") return cb(null, true);
    cb(new Error("El archivo debe ser .xlsx o .xls"));
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

/**
 * @route   GET /api/gasto-q4/reportes
 * @desc    Conceptos de la carga vigente con su tipo de gasto, y el tipo de cambio
 * @access  Private
 */
router.get("/reportes", authenticate, puedeLeer(MODULO), controller.getReporte);

/**
 * @route   POST /api/gasto-q4/tipo-cambio/actualizar
 * @desc    Baja el FIX de Banxico en ese momento
 * @access  Private (quien puede cargar)
 */
router.post("/tipo-cambio/actualizar", authenticate, puedeCrear(MODULO_CARGA), controller.actualizarTipoCambio);

/**
 * @route   POST /api/gasto-q4/carga/analizar
 * @desc    Lo que trae el archivo, sin escribir en la base
 * @access  Private
 */
router.post("/carga/analizar", authenticate, puedeLeer(MODULO_CARGA), conArchivo("archivo"), controller.analizarCarga);

/**
 * @route   POST /api/gasto-q4/carga/importar
 * @desc    Carga el archivo y reemplaza la carga anterior
 * @access  Private
 */
router.post("/carga/importar", authenticate, puedeCrear(MODULO_CARGA), conArchivo("archivo"), controller.importarCarga);

/**
 * @route   GET /api/gasto-q4/carga/historial
 * @desc    Últimas cargas
 * @access  Private
 */
router.get("/carga/historial", authenticate, puedeLeer(MODULO_CARGA), controller.getHistorialCargas);

module.exports = router;
