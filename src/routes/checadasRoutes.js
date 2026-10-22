const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const os = require("os");
const controller = require("../controllers/checadasController");
const { authenticate } = require("../middlewares/auth");
const { puedeLeer, puedeCrear } = require("../middlewares/permisos");

const MODULO = "/checadas/reportes";
// La carga es un módulo aparte, como en Compound: quien consulta no
// necesariamente sube, y al revés.
const MODULO_CARGA = "/checadas/carga";

/** Subida del Excel de Transacciones (unos 30 KB por corte). A disco, como Compound. */
const subida = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) =>
      cb(null, `chk-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
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
 * @route   GET /api/checadas/reportes/filtros
 * @desc    Fechas con checadas, departamentos y turnos
 * @access  Private
 */
router.get("/reportes/filtros", authenticate, puedeLeer(MODULO), controller.getFiltros);

/**
 * @route   GET /api/checadas/reportes
 * @desc    Quién checó por turno: a tiempo, en tolerancia o con retardo
 * @access  Private
 */
router.get("/reportes", authenticate, puedeLeer(MODULO), controller.getReporte);

/**
 * @route   POST /api/checadas/carga/analizar
 * @desc    Lo que trae el archivo, sin escribir en la base
 * @access  Private
 */
router.post("/carga/analizar", authenticate, puedeLeer(MODULO_CARGA), conArchivo("archivo"), controller.analizarCarga);

/**
 * @route   POST /api/checadas/carga/importar
 * @desc    Carga las checadas nuevas del archivo
 * @access  Private
 */
router.post("/carga/importar", authenticate, puedeCrear(MODULO_CARGA), conArchivo("archivo"), controller.importarCarga);

/**
 * @route   GET /api/checadas/carga/historial
 * @desc    Últimas cargas
 * @access  Private
 */
router.get("/carga/historial", authenticate, puedeLeer(MODULO_CARGA), controller.getHistorialCargas);

module.exports = router;
