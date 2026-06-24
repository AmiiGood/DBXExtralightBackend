const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const os = require("os");
const qrController = require("../controllers/qrController");
const { authenticate, verificarPermiso } = require("../middlewares/auth");
const { validationResult } = require("express-validator");
const {
  escanearQrValidation,
  sincronizarTusValidation,
  getEscaneosValidation,
  getEstadisticasValidation,
  getProductosValidation,
} = require("../validators/qrValidator");

// Configuración de multer para subida de Excel
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, os.tmpdir());
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `excel-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".xlsx", ".xls", ".csv"].includes(ext)) {
      cb(null, true);
    } else {
      cb(
        new Error("Solo se permiten archivos Excel (.xlsx, .xls) o CSV"),
        false,
      );
    }
  },
});

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

// Todas las rutas requieren autenticación
router.use(authenticate);

// =============================================
// DASHBOARD / RESUMEN
// =============================================

/**
 * @route   GET /api/qr/dashboard
 * @desc    Obtener resumen general del módulo QR
 * @access  Private (Validación QR - leer)
 */
router.get(
  "/dashboard",
  verificarPermiso("Validación QR", "leer"),
  qrController.getDashboard,
);

// =============================================
// ESCANEO QR (flujo principal)
// =============================================

/**
 * @route   POST /api/qr/escanear
 * @desc    Escanear y validar un código QR
 * @body    { qrCode: "httpsÑ--verify.crocs.com-Q-TN6AKYGBSEIW" }
 * @access  Private (Validación QR - crear)
 */
router.post(
  "/escanear",
  verificarPermiso("Validación QR", "crear"),
  escanearQrValidation,
  handleValidationErrors,
  qrController.escanearQr,
);

// =============================================
// SINCRONIZACIÓN CON API TUS
// =============================================

/**
 * @route   POST /api/qr/sincronizar
 * @desc    Sincronizar mapeos QR→UPC desde la API de TUS
 * @body    { lastGetTime?: "2025-01-01 00:00:00" } (opcional, usa última fecha si no se envía)
 * @access  Private (Admin - Validación QR - crear)
 */
router.post(
  "/sincronizar",
  verificarPermiso("Validación QR", "crear"),
  sincronizarTusValidation,
  handleValidationErrors,
  qrController.sincronizarTus,
);

/**
 * @route   GET /api/qr/sincronizaciones
 * @desc    Obtener historial de sincronizaciones
 * @access  Private (Validación QR - leer)
 */
router.get(
  "/sincronizaciones",
  verificarPermiso("Validación QR", "leer"),
  qrController.getHistorialSincronizaciones,
);

// =============================================
// CARGA DE EXCEL
// =============================================

/**
 * @route   POST /api/qr/cargar-excel
 * @desc    Cargar archivo Excel con catálogo de productos (SKU, UPC, StyleNo, StyleName, Color, Size)
 * @access  Private (Admin - Validación QR - crear)
 */
router.post(
  "/cargar-excel",
  verificarPermiso("Validación QR", "crear"),
  upload.single("archivo"),
  qrController.cargarExcel,
);

/**
 * @route   GET /api/qr/cargas-excel
 * @desc    Obtener historial de cargas de Excel
 * @access  Private (Validación QR - leer)
 */
router.get(
  "/cargas-excel",
  verificarPermiso("Validación QR", "leer"),
  qrController.getHistorialCargas,
);

// =============================================
// CONSULTAS
// =============================================

/**
 * @route   GET /api/qr/productos
 * @desc    Obtener catálogo de productos cargados
 * @query   ?search=crocs&upc=883503153356&limit=50&offset=0
 * @access  Private (Validación QR - leer)
 */
router.get(
  "/productos",
  verificarPermiso("Validación QR", "leer"),
  getProductosValidation,
  handleValidationErrors,
  qrController.getProductos,
);

/**
 * @route   GET /api/qr/mapeos
 * @desc    Obtener mapeos QR→UPC sincronizados
 * @query   ?search=&upc=883503153356&limit=50&offset=0
 * @access  Private (Validación QR - leer)
 */
router.get(
  "/mapeos",
  verificarPermiso("Validación QR", "leer"),
  qrController.getMapeos,
);

// =============================================
// HISTORIAL DE ESCANEOS
// =============================================

/**
 * @route   GET /api/qr/escaneos
 * @desc    Obtener historial de escaneos QR
 * @query   ?fechaInicio=...&fechaFin=...&productoEncontrado=true&limit=50&offset=0
 * @access  Private (Validación QR - leer)
 */
router.get(
  "/escaneos",
  verificarPermiso("Validación QR", "leer"),
  getEscaneosValidation,
  handleValidationErrors,
  qrController.getEscaneos,
);

/**
 * @route   GET /api/qr/estadisticas
 * @desc    Obtener estadísticas de escaneos
 * @query   ?fechaInicio=2025-01-01&fechaFin=2025-01-31
 * @access  Private (Validación QR - leer)
 */
router.get(
  "/estadisticas",
  verificarPermiso("Validación QR", "leer"),
  getEstadisticasValidation,
  handleValidationErrors,
  qrController.getEstadisticas,
);

module.exports = router;
