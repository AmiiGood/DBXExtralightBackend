const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const os = require("os");
const shippingController = require("../controllers/shippingController");
const { authenticate, isAdmin } = require("../middlewares/auth");
const { validationResult } = require("express-validator");
const {
  getPOsValidation,
  getPoByIdValidation,
  getCartonesByPoValidation,
  getCartonInfoValidation,
  getHistorialValidation,
} = require("../validators/shippingValidator");

// Configuración de multer para subida de Excel
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, os.tmpdir());
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `shipping-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".xlsx", ".xls"].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten archivos Excel (.xlsx, .xls)"), false);
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
// DASHBOARD
// =============================================

/**
 * @route   GET /api/shipping/dashboard
 * @desc    Obtener resumen general del módulo de embarque
 * @access  Private
 */
router.get("/dashboard", shippingController.getDashboard);

// =============================================
// IMPORTACIÓN
// =============================================

/**
 * @route   POST /api/shipping/import
 * @desc    Importar POs y Cartones desde Excel
 * @access  Private (Admin)
 */
router.post(
  "/import",
  isAdmin,
  upload.single("archivo"),
  shippingController.importarExcel,
);

/**
 * @route   GET /api/shipping/import/historial
 * @desc    Obtener historial de importaciones
 * @access  Private (Admin)
 */
router.get(
  "/import/historial",
  isAdmin,
  getHistorialValidation,
  handleValidationErrors,
  shippingController.getHistorialImportaciones,
);

/**
 * @route   GET /api/shipping/import/:id
 * @desc    Obtener detalles de una importación
 * @access  Private (Admin)
 */
router.get(
  "/import/:id",
  isAdmin,
  getPoByIdValidation,
  handleValidationErrors,
  shippingController.getImportacionById,
);

// =============================================
// POs
// =============================================

/**
 * @route   GET /api/shipping/pos
 * @desc    Obtener todas las POs con filtros
 * @query   ?estado=PENDIENTE&poNumber=4502&limit=50&offset=0
 * @access  Private
 */
router.get(
  "/pos",
  getPOsValidation,
  handleValidationErrors,
  shippingController.getPOs,
);

/**
 * @route   GET /api/shipping/pos/:id
 * @desc    Obtener una PO por ID con sus cartones
 * @access  Private
 */
router.get(
  "/pos/:id",
  getPoByIdValidation,
  handleValidationErrors,
  shippingController.getPoById,
);

/**
 * @route   GET /api/shipping/pos/:id/estadisticas
 * @desc    Obtener estadísticas de una PO
 * @access  Private
 */
router.get(
  "/pos/:id/estadisticas",
  getPoByIdValidation,
  handleValidationErrors,
  shippingController.getPoEstadisticas,
);

// =============================================
// CARTONES
// =============================================

/**
 * @route   GET /api/shipping/pos/:poId/cartones
 * @desc    Obtener cartones de una PO
 * @query   ?tipo=MONO&estado=PENDIENTE
 * @access  Private
 */
router.get(
  "/pos/:poId/cartones",
  getCartonesByPoValidation,
  handleValidationErrors,
  shippingController.getCartonesByPo,
);

/**
 * @route   GET /api/shipping/cartones/:cartonId
 * @desc    Obtener información completa de un cartón
 * @access  Private
 */
router.get(
  "/cartones/:cartonId",
  getCartonInfoValidation,
  handleValidationErrors,
  shippingController.getCartonInfo,
);

/**
 * @route   GET /api/shipping/cartones/:cartonId/tipo
 * @desc    Verificar si un cartón es MONO o MUSICAL
 * @access  Private
 */
router.get(
  "/cartones/:cartonId/tipo",
  getCartonInfoValidation,
  handleValidationErrors,
  shippingController.checkCartonTipo,
);

module.exports = router;
