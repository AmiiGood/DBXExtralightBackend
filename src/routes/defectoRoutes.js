const express = require("express");
const router = express.Router();
const defectoController = require("../controllers/defectoController");
const { authenticate, verificarPermiso } = require("../middlewares/auth");
const { validationResult } = require("express-validator");
const {
  createRegistroValidation,
  updateRegistroValidation,
  getRegistrosValidation,
  getResumenValidation,
  getTopDefectosValidation,
} = require("../validators/defectoValidator");

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

/**
 * @route   GET /api/defectos/catalogos
 * @desc    Obtener catálogos necesarios para el formulario
 * @access  Private (Calidad puede leer)
 */
router.get(
  "/catalogos",
  verificarPermiso("FPG-QA-001 Ver.03 OBA ensamble", "leer"),
  defectoController.getCatalogos
);

/**
 * @route   GET /api/defectos/turno-actual
 * @desc    Obtener el turno actual
 * @access  Private (Calidad puede leer)
 */
router.get(
  "/turno-actual",
  verificarPermiso("FPG-QA-001 Ver.03 OBA ensamble", "leer"),
  defectoController.getTurnoActual
);

/**
 * @route   GET /api/defectos/resumen-turno
 * @desc    Obtener resumen de defectos por turno
 * @query   ?fechaInicio=2025-01-01&fechaFin=2025-01-31
 * @access  Private (Reportes de Calidad puede leer)
 */
router.get(
  "/resumen-turno",
  verificarPermiso("Reportes de Calidad", "leer"),
  getResumenValidation,
  handleValidationErrors,
  defectoController.getResumenPorTurno
);

/**
 * @route   GET /api/defectos/top-defectos
 * @desc    Obtener top defectos más frecuentes
 * @query   ?limit=10&fechaInicio=2025-01-01&fechaFin=2025-01-31
 * @access  Private (Reportes de Calidad puede leer)
 */
router.get(
  "/top-defectos",
  verificarPermiso("Reportes de Calidad", "leer"),
  getTopDefectosValidation,
  handleValidationErrors,
  defectoController.getTopDefectos
);

/**
 * @route   GET /api/defectos
 * @desc    Obtener todos los registros de defectos con filtros
 * @query   ?fechaInicio=2025-01-01&fechaFin=2025-01-31&turnoId=1&limit=50&offset=0
 * @access  Private (Calidad puede leer)
 */
router.get(
  "/",
  verificarPermiso("FPG-QA-001 Ver.03 OBA ensamble", "leer"),
  getRegistrosValidation,
  handleValidationErrors,
  defectoController.getRegistros
);

/**
 * @route   GET /api/defectos/:id
 * @desc    Obtener un registro de defecto por ID
 * @access  Private (Calidad puede leer)
 */
router.get(
  "/:id",
  verificarPermiso("FPG-QA-001 Ver.03 OBA ensamble", "leer"),
  defectoController.getRegistroById
);

/**
 * @route   POST /api/defectos
 * @desc    Crear un nuevo registro de defecto
 * @access  Private (Calidad puede crear)
 */
router.post(
  "/",
  verificarPermiso("FPG-QA-001 Ver.03 OBA ensamble", "crear"),
  createRegistroValidation,
  handleValidationErrors,
  defectoController.createRegistro
);

/**
 * @route   PUT /api/defectos/:id
 * @desc    Actualizar un registro de defecto
 * @access  Private (Calidad puede editar)
 */
router.put(
  "/:id",
  verificarPermiso("FPG-QA-001 Ver.03 OBA ensamble", "editar"),
  updateRegistroValidation,
  handleValidationErrors,
  defectoController.updateRegistro
);

/**
 * @route   DELETE /api/defectos/:id
 * @desc    Eliminar un registro de defecto
 * @access  Private (Admin puede eliminar)
 */
router.delete(
  "/:id",
  verificarPermiso("FPG-QA-001 Ver.03 OBA ensamble", "eliminar"),
  defectoController.deleteRegistro
);

module.exports = router;
